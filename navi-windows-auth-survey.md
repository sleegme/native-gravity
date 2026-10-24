# Windows agy authentication storage survey

Date: 2026-10-24. Branch: `feat/navi-cross-platform`.
Starting commit: `c2a9442`.

## Result and limits

OBSERVED: `agy` was not resolvable in native PowerShell 7.6.8 with
`-NoLogo -NoProfile -NonInteractive`. Both requested isolated command
attempts failed with `CommandNotFoundException`; no agy process started.
This is not a successful agy smoke test and does not establish that
`ANTIGRAVITY_HOME` or `GEMINI_CLI_HOME` redirects agy authentication.

OBSERVED: Gemini desktop folders exist. Their ownership by agy, their
authentication mechanism, and any usable authentication state are UNKNOWN.
File names alone do not establish any of those facts.

No application code was changed, no installation or login was performed,
and no settings/authentication file contents or credential values were read
or printed. Credential Manager enumeration was filtered to relevant target
names; unrelated entries and account names were not printed. All personal
paths below use `%USERPROFILE%`.

## 1. Storage and installation names

Only directory enumeration and filesystem metadata were used.
`%APPDATA%` was `%USERPROFILE%\AppData\Roaming`; `%LOCALAPPDATA%` was
`%USERPROFILE%\AppData\Local`.

### Home and direct application-data candidates

OBSERVED absent:

```text
%USERPROFILE%\.gemini
%USERPROFILE%\.antigravity
%USERPROFILE%\AppData\Roaming\agy
%USERPROFILE%\AppData\Roaming\.gemini
%USERPROFILE%\AppData\Roaming\Antigravity
%USERPROFILE%\AppData\Local\agy
%USERPROFILE%\AppData\Local\gemini
%USERPROFILE%\AppData\Local\.gemini
%USERPROFILE%\AppData\Local\Antigravity
%USERPROFILE%\AppData\Local\Programs\Antigravity
```

Windows case variants of `Antigravity` were also checked and absent.
The related top-level names found by enumerating `%APPDATA%` and
`%LOCALAPPDATA%` were `gemini` and `Google`, respectively.

### Existing desktop data directory

OBSERVED: `%USERPROFILE%\AppData\Roaming\gemini` contained these direct
children. Trailing slashes denote directories.

```text
blob_storage/
Cache/
Code Cache/
DawnGraphiteCache/
DawnWebGPUCache/
Dictionaries/
flags/
GPUCache/
GPUPersistentCache/
GrShaderCache/
Local Storage/
Network/
Session Storage/
ShaderCache/
Shared Dictionary/
declarative_performance_observer.db
declarative_performance_observer.db-journal
DIPS
Local State
Preferences
settings.json
```

Additional observed names under that directory, without opening any file:

```text
flags/active_account.json
flags/default.json
Local Storage/leveldb/
Local Storage/leveldb/000003.log
Local Storage/leveldb/CURRENT
Local Storage/leveldb/LOCK
Local Storage/leveldb/LOG
Local Storage/leveldb/MANIFEST-000001
Network/Cookies
Network/Cookies-journal
Network/Device Bound Sessions
Network/Device Bound Sessions-journal
Network/Network Persistent State
Network/NetworkDataMigrated
Network/TransportSecurity
Network/Trust Tokens
Network/Trust Tokens-journal
Session Storage/000003.log
Session Storage/CURRENT
Session Storage/LOCK
Session Storage/LOG
Session Storage/MANIFEST-000001
```

These are storage candidates, not evidence that agy uses desktop cookies,
LevelDB, `settings.json`, or `active_account.json`.

### Existing desktop installation directory

OBSERVED: `%USERPROFILE%\AppData\Local\Google\Gemini` contained:

```text
app-1.16.0/
Crashpad/
logs/
Gemini.exe
GeminiAppLauncher.exe
Uninstall Gemini.exe
```

Other direct children of `%USERPROFILE%\AppData\Local\Google` were
`Chrome/`, `CrashReports/`, `DriveFS/`, `GoogleUpdater/`, `Nearby/`,
`Software Reporter Tool/`, and `Update/`. They were not treated as agy
authentication directories or recursively inspected for authentication.

### CLI lookup scope

OBSERVED: `Get-Command agy -All` failed. `Get-Command gemini,antigravity
-All` found no commands. Name checks found no agy/gemini/antigravity
launcher candidates in the 19 existing process-PATH directories or at
the directly inspected installation locations:

```text
%USERPROFILE%\AppData\Roaming\npm
%USERPROFILE%\AppData\Local\Programs
%USERPROFILE%\AppData\Local\Microsoft\WindowsApps
%USERPROFILE%\.local\bin
%USERPROFILE%\scoop\shims
%USERPROFILE%\.antigravity
%ProgramFiles%
%ProgramFiles(x86)%
```

Missing candidate directories were skipped. These were name-based checks,
not an exhaustive disk/package inventory. PowerShell profiles were not
loaded or read; profile-only functions/aliases, WSL installations, and
installations outside these locations remain UNKNOWN. The desktop
executables were not launched as substitutes for agy.

## 2. Windows Credential Manager

OBSERVED: `cmdkey.exe /list` exited 0. Its output was filtered in memory
case-insensitively for `agy|gemini|antigravity`.

- Matching lines: 0.
- Matching credential target names: none.
- No credential was retrieved, changed, or deleted.

This result is limited to names visible to `cmdkey /list` for the current
Windows user/session. It does not exclude differently named entries,
other credential stores, or another user's credentials.

## 3. Empty-home command attempts and before/after comparison

A fresh directory was created and its initial child count verified as 0:

```text
%USERPROFILE%\AppData\Local\Temp\navi-auth-survey-5b457796-f6e4-48ef-a553-a4ac4aa78265
```

Only the child PowerShell process set both variables to that directory:

```powershell
$env:ANTIGRAVITY_HOME = $runRoot
$env:GEMINI_CLI_HOME = $runRoot
Set-Location -LiteralPath $runRoot
agy --help
agy --version
```

`$runRoot` above denotes the verified empty directory. Output from the
attempted CLI invocations was suppressed; only result classifications
were emitted. `--version` was selected as a non-login, read-only candidate;
its availability in agy could not be confirmed because agy was unavailable.

| Attempt | Observed outcome |
| --- | --- |
| `agy --help` | `CommandNotFoundException`; agy did not start |
| `agy --version` | `CommandNotFoundException`; agy did not start |
| Survey PowerShell wrapper | Exit 0, indicating capture completed, not CLI success |
| New files/directories in temporary home | None; final recursive child count 0 |
| Login window | No agy process started; no agy login window to cancel |

No browser or desktop application was launched by the survey.
No user/machine environment setting was changed. Neither variable was
present in the parent agent process before or after these child-only sets.

The storage candidates listed above, including the existing Roaming
`gemini` tree and Local `Google\Gemini` installation tree, were recursively
snapshotted before and after the attempts. The in-memory comparison used
names, entry types, sizes, last-write/change times, file identifiers, and
mode metadata; file contents and content hashes were not read.
Symbolic links were not followed.

| Comparison | Observed result |
| --- | --- |
| Before, UTC | `2026-10-24T04:20:42.072Z` |
| After, UTC | `2026-10-24T04:21:05.280Z` |
| Existing files | 579 before / 579 after |
| Existing directories | 175 before / 175 after |
| Snapshot records, including absent-path markers | 766 before / 766 after |
| Added/removed/metadata-changed names | 0 |
| Enumeration errors | 0 before / 0 after |
| Originally absent candidates | Remained absent |

OBSERVED: no change was detected in the surveyed original trees.
This is a metadata comparison, not a byte-for-byte integrity proof.
It also cannot demonstrate agy isolation, because neither CLI invocation
reached agy. The empty temporary directory was then removed and its
absence independently confirmed.

## Conclusion

The requested filename-only inventory, credential-name check, isolated
command attempts, and metadata comparison were completed without login.
Successful execution of agy and actual Windows authentication-home
isolation remain UNVERIFIED because the native command was unavailable.
No authentication path should be implemented or claimed from this survey
alone. A repeat with an existing native agy executable is needed to answer
that remaining question; this survey did not install or configure one.
