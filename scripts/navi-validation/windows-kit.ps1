param(
    [string]$Output,
    [string]$Backend,
    [string]$Steps,
    [string]$SchemaOutput
)
$ErrorActionPreference = 'Stop'
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$report = [ordered]@{
    schema_version = 1
    scope = 'navi_windows_validation_kit'
    status = 'PENDING'
    production_windows_support = 'PENDING'
    os = [Environment]::OSVersion.VersionString
    powershell = $PSVersionTable.PSVersion.ToString()
    baseline_sha = $null
    checks = @()
    native_pending = @(
        'Real AGY private-profile authentication and no owner-keyring fallback',
        'Original credential protection during real AGY calls',
        'Production Navi Windows runtime, confirmation and ledger invariants',
        'Timeout/cancellation descendant cleanup during real AGY calls',
        'Packaged installation in spaces and non-ASCII paths'
    )
}
if (-not $Output) {
    $Output = Join-Path (Get-Location) ('navi-windows-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')
}
if (Test-Path -LiteralPath $Output) { throw 'OUTPUT_ALREADY_EXISTS' }
$exitCode = 2
$fixture = $null
$guard = $null
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        $report.status = 'UNSUPPORTED'
        $report.checks += @{ name = 'native_windows'; status = 'UNSUPPORTED' }
    } else {
        $report.checks += @{ name = 'native_windows'; status = 'PASS' }
        $node = Get-Command node -CommandType Application -ErrorAction Stop
        $nodeVersion = & $node.Source --version
        if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 18) {
            throw 'NODE_18_REQUIRED'
        }
        $report.node = $nodeVersion.Trim()
        $sha = & git -C $repo rev-parse HEAD
        if ($LASTEXITCODE -ne 0) { throw 'BASELINE_SHA_UNAVAILABLE' }
        $report.baseline_sha = $sha.Trim()
        $report.checks += @{ name = 'node_and_baseline'; status = 'PASS' }

        # Fixture data ONLY. This script never reads the owner's OAuth token.
        $fixture = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
        [void][System.IO.Directory]::CreateDirectory($fixture)
        $original = Join-Path $fixture 'original.fixture'
        $alias = Join-Path $fixture 'alias.fixture'
        [System.IO.File]::WriteAllText($original, 'NTG_FIXTURE_NOT_A_CREDENTIAL')
        [void](New-Item -ItemType HardLink -Path $alias -Target $original)
        $guard = [System.IO.File]::Open($original, [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        foreach ($path in @($original, $alias)) {
            $label = if ($path -eq $original) { 'original' } else { 'alias' }
            foreach ($operation in @('write', 'truncate', 'replace', 'delete', 'rename')) {
                $replacement = Join-Path $fixture ([Guid]::NewGuid().ToString('N'))
                [System.IO.File]::WriteAllText($replacement, 'REPLACEMENT_FIXTURE')
                $blocked = $false
                try {
                    switch ($operation) {
                        'write' { [System.IO.File]::WriteAllText($path, 'CHANGED') }
                        'truncate' {
                            $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Truncate,
                                [System.IO.FileAccess]::Write)
                            $stream.Dispose()
                        }
                        'replace' { [System.IO.File]::Replace($replacement, $path, $null) }
                        'delete' { [System.IO.File]::Delete($path) }
                        'rename' { [System.IO.File]::Move($path, ($path + '.moved')) }
                    }
                } catch {
                    $exception = $_.Exception
                    while ($exception.InnerException) { $exception = $exception.InnerException }
                    $code = $exception.HResult -band 0xffff
                    $blocked = $code -eq 32 -or $code -eq 33
                }
                $report.checks += @{
                    name = ('fixture_guard_' + $label + '_' + $operation)
                    status = $(if ($blocked) { 'PASS' } else { 'FAIL' })
                }
                if (-not $blocked) { throw 'FIXTURE_SHARE_GUARD_FAILED' }
            }
        }
        if ([System.IO.File]::ReadAllText($alias) -ne 'NTG_FIXTURE_NOT_A_CREDENTIAL') {
            throw 'FIXTURE_CONTENT_CHANGED'
        }
        $guard.Dispose()
        $guard = $null
        [System.IO.File]::WriteAllText($alias, 'WRITABLE_AFTER_RELEASE')
        if ([System.IO.File]::ReadAllText($original) -ne 'WRITABLE_AFTER_RELEASE') {
            throw 'FIXTURE_ALIAS_IDENTITY_FAILED'
        }
        $report.checks += @{ name = 'fixture_alias_identity_and_release'; status = 'PASS' }
        if ($Backend) {
            $application = Get-Command $Backend -CommandType Application -ErrorAction Stop
            if ([System.IO.Path]::GetExtension($application.Source) -ine '.exe') {
                throw 'BACKEND_NATIVE_EXE_REQUIRED'
            }
            $backendOutput = Join-Path $fixture 'backend.json'
            $probe = Join-Path $PSScriptRoot 'probe.mjs'
            $arguments = @($probe, '--backend', $application.Source, '--output', $backendOutput)
            if (-not $SchemaOutput) {
                $SchemaOutput = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetFullPath($Output), 'schemas.local.json')
            }
            $arguments += @('--schemas', [System.IO.Path]::GetFullPath($SchemaOutput))
            if ($Steps) { $arguments += @('--steps', [System.IO.Path]::GetFullPath($Steps)) }
            & $node.Source @arguments
            $backendExit = $LASTEXITCODE
            if (Test-Path -LiteralPath $backendOutput) {
                $report.backend_probe = Get-Content -LiteralPath $backendOutput -Raw -Encoding UTF8 | ConvertFrom-Json
            }
            if ($backendExit -ne 0) { throw 'BACKEND_PROBE_FAILED' }
        } else {
            $report.checks += @{ name = 'backend_protocol'; status = 'PENDING' }
        }
        # A green fixture/protocol probe does not satisfy the production gates.
        $report.status = 'PENDING'
        $exitCode = 2
    }
} catch {
    $report.status = 'FAIL'
    $report.checks += @{ name = 'kit_execution'; status = 'FAIL' }
    # Do not serialize exception messages: they may contain owner paths.
    $report.error_type = $_.Exception.GetType().Name
    $exitCode = 1
} finally {
    if ($guard) { $guard.Dispose() }
    if ($fixture -and (Test-Path -LiteralPath $fixture)) {
        try { Remove-Item -LiteralPath $fixture -Recurse -Force } catch {
            $report.status = 'FAIL'
            $report.checks += @{ name = 'fixture_cleanup'; status = 'FAIL' }
            $exitCode = 1
        }
    }
}
$json = $report | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($Output), $json,
    (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('NAVI_WINDOWS_KIT_' + $report.status)
exit $exitCode
