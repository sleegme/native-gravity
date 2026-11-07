# Native Gravity installer (PowerShell)
#
# Versioned installation (pinned release):
#   irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.2/scripts/install.ps1 | iex
#
# Latest main branch:
#   irm https://raw.githubusercontent.com/sleegme/native-gravity/main/scripts/install.ps1 | iex
#
# Forwarding arguments:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.2/scripts/install.ps1))) --help
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.1.2/scripts/install.ps1))) reinstall

$ErrorActionPreference = 'Stop'

# Prerequisites
$runner = $null
if (Get-Command node -ErrorAction SilentlyContinue) {
    $runner = 'node'
} elseif (Get-Command bun -ErrorAction SilentlyContinue) {
    $runner = 'bun'
} else {
    [Console]::Error.WriteLine("Native Gravity requires Node.js (>=18) or Bun on PATH to run the installer.")
    [Console]::Error.WriteLine("Please install Node.js: https://nodejs.org/ or Bun: https://bun.sh/")
    exit 1
}

# Target & Release configuration
$ref = if ($env:NATIVE_GRAVITY_REF) { $env:NATIVE_GRAVITY_REF } else { 'v1.1.2' }
$hasTar = [bool](Get-Command tar -ErrorAction SilentlyContinue)
$defaultArchive = if ($hasTar) {
    "https://codeload.github.com/sleegme/native-gravity/tar.gz/$ref"
} else {
    "https://codeload.github.com/sleegme/native-gravity/zip/$ref"
}
$archiveUrl = if ($env:NATIVE_GRAVITY_ARCHIVE_URL) { $env:NATIVE_GRAVITY_ARCHIVE_URL } else { $defaultArchive }

$baseData = if ($env:LOCALAPPDATA) {
    $env:LOCALAPPDATA
} elseif ($env:XDG_DATA_HOME) {
    $env:XDG_DATA_HOME
} elseif ($env:HOME) {
    Join-Path $env:HOME '.local/share'
} else {
    $HOME
}

$targetParent = Join-Path $baseData 'native-gravity'
$targetDir = Join-Path $targetParent $ref

if (-not (Test-Path $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
}

$pidStr = $PID.ToString()
$isTarGz = $archiveUrl.EndsWith('.tar.gz') -or $archiveUrl.Contains('/tar.gz/')
$ext = if ($isTarGz) { '.tar.gz' } else { '.zip' }
$tmpArchive = Join-Path $targetParent (".download.$ref.$pidStr$ext")
$tmpExtract = Join-Path $targetParent (".${ref}.tmp.$pidStr")
$backupDir = Join-Path $targetParent (".${ref}.old.$pidStr")

# Download
try {
    if ($archiveUrl.StartsWith('file://')) {
        $filePath = $archiveUrl.Substring(7)
        Copy-Item -Path $filePath -Destination $tmpArchive -Force
    } else {
        Invoke-WebRequest -Uri $archiveUrl -OutFile $tmpArchive
    }
} catch {
    [Console]::Error.WriteLine("Failed to download Native Gravity archive from $archiveUrl : $_")
    if (Test-Path $tmpArchive) { Remove-Item -Path $tmpArchive -Force -ErrorAction SilentlyContinue }
    exit 1
}

# Extract
try {
    New-Item -ItemType Directory -Path $tmpExtract -Force | Out-Null
    if ($isTarGz -and $hasTar) {
        & tar -xzf $tmpArchive -C $tmpExtract --strip-components=1
        if ($LASTEXITCODE -ne 0) {
            throw "tar extraction failed with exit code $LASTEXITCODE"
        }
    } else {
        Expand-Archive -Path $tmpArchive -DestinationPath $tmpExtract -Force
        $children = Get-ChildItem -Path $tmpExtract
        if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
            $inner = $children[0].FullName
            $innerItems = Get-ChildItem -Path $inner
            foreach ($item in $innerItems) {
                Move-Item -Path $item.FullName -Destination $tmpExtract -Force
            }
            Remove-Item -Path $inner -Force -Recurse
        }
    }
} catch {
    [Console]::Error.WriteLine("Failed to extract Native Gravity archive: $_")
    if (Test-Path $tmpArchive) { Remove-Item -Path $tmpArchive -Force -ErrorAction SilentlyContinue }
    if (Test-Path $tmpExtract) { Remove-Item -Path $tmpExtract -Force -Recurse -ErrorAction SilentlyContinue }
    exit 1
}

# Atomic swap
try {
    if (Test-Path $targetDir) {
        Move-Item -Path $targetDir -Destination $backupDir -Force
    }
    Move-Item -Path $tmpExtract -Destination $targetDir -Force
    if (Test-Path $backupDir) {
        Remove-Item -Path $backupDir -Force -Recurse -ErrorAction SilentlyContinue
    }
    if (Test-Path $tmpArchive) {
        Remove-Item -Path $tmpArchive -Force -ErrorAction SilentlyContinue
    }
} catch {
    [Console]::Error.WriteLine("Failed to finalize Native Gravity installation directory: $_")
    if ((Test-Path $backupDir) -and -not (Test-Path $targetDir)) {
        Move-Item -Path $backupDir -Destination $targetDir -Force -ErrorAction SilentlyContinue
    }
    exit 1
}

# Hand off
$npmInstallScript = Join-Path $targetDir (Join-Path 'scripts' 'npm-install.mjs')
& $runner $npmInstallScript @args
exit $LASTEXITCODE
