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

## 2026-10-24 follow-up: real prompt with the installed Windows CLI

This follow-up supersedes the earlier unavailable-CLI conclusion for the
current installation. The earlier observations remain a historical record.
Starting repository commit: `fa965c7`, branch `feat/navi-cross-platform`;
the working tree was clean.

### Outcome

Requested classification: **키링 공유** (shared keyring).

OBSERVED: the Flash prompt returned `OK`, exit 0, without a login request
or login input while both home variables pointed at an empty temporary
directory. No login/logout command was run. No new login window was
observed during or after the monitored attempts, so none needed cancellation.

INFERRED: those two environment variables did not establish authentication
isolation in this environment. The requested classification describes the
successful no-login response, not proof of the precise authentication
source. The survey cannot distinguish Windows Credential Manager reuse
from existing file-backed state or another inherited authentication source.
No credential value or authentication/settings file content was retrieved
or printed.

### Credential target names, before and after

`cmdkey.exe /list` exited 0 on both enumerations. Only target-name fields
matching `agy|gemini|antigravity|google`, case-insensitively, were retained:

| Before | After |
| --- | --- |
| `LegacyGeneric:target=gemini:antigravity` | `LegacyGeneric:target=gemini:antigravity` |

Added target names: none. Removed target names: none. No other matching
target name was found. Account/value fields were not printed. An unchanged
target-name set does not prove that credential values stayed unchanged;
values were deliberately not inspected.

### Commands and process-only homes

PowerShell 7.6.8 resolved the supplied executable:

```text
%USERPROFILE%\AppData\Local\agy\bin\agy.exe
```

The temporary directory was:

```text
%USERPROFILE%\AppData\Local\Temp\navi-auth-prompt-cffdcac7-525d-4303-a799-5c36967742da
```

It was created empty, and emptiness was checked before each monitored
prompt attempt. Only the child PowerShell process set:

```powershell
$env:ANTIGRAVITY_HOME = $runRoot
$env:GEMINI_CLI_HOME = $runRoot
Set-Location -LiteralPath $runRoot
agy -p "reply OK"
agy models
agy -p "reply OK" --model gemini-3.8-flash --effort low
```

These commands show the sequence of operations, not a single successful
default-model run. Neither home variable was present in the parent agent
process before or after the investigation. No user/machine environment
setting was changed by this follow-up.

| Operation | Observed result |
| --- | --- |
| Default-model `agy -p "reply OK"` | Exit 3, no `OK`, no detected login requirement |
| Controlled default-model reproduction | Exit 3 again; stderr matched the fixed terms `quota`, `HTTP`, `error`; no raw error text or credential values printed |
| `agy models` | Exit 0; listed `gemini-3.8-flash` / `Gemini 3.8 Flash` |
| Explicit Flash prompt with `--effort low` | Exit 0; `OK` response; no stderr, detected login requirement, or timeout |

The listed Flash model was selected with the lowest documented effort
value shown by this installed CLI's help, `low`. No smaller Flash model
name was observed in the model-name extraction; this is not a claim about
models outside this account's listing.

The initial quota/HTTP failure was not classified as either successful
sharing or isolation. The classification above comes from the subsequent
successful Flash response.

Survey wrappers subscribed to process/output events before starting the
monitored CLI, closed stdin rather than supplying login input, and imposed
a bounded timeout. Only fixed result markers were emitted. Several long
PowerShell transport attempts failed before agy started; a separate private
capture wrapper also failed without recoverable output and was not used as
authentication evidence. The working monitored wrapper then reproduced the
default-model failure and tested Flash. All filenames below cover the
entire observation interval, including retries and model lookup; they are
not attributed individually to the successful prompt.

### Filename and metadata comparison

No authentication/settings/log/database contents or content hashes were
read. Filesystem names and metadata were compared; symbolic links were
not followed. Credential enumeration was separate from the filesystem
comparison.

| Observation | Result |
| --- | --- |
| Baseline, UTC | `2026-10-24T04:42:05.368Z` |
| After, UTC | `2026-10-24T04:51:18.963Z` |
| Temporary-home initial entries | 0 |
| Temporary-home final entries / created filenames | 0 / none |
| Original-tree snapshot records | 832 before / 888 after |
| New original-tree entries | 30 files and 26 directories |
| Removed original-tree entries | 0 |
| Changed existing metadata entries | 3 files, 1 symbolic link, 8 directories |
| Enumeration errors | 0 before / 0 after |

The surveyed roots were `%USERPROFILE%\.gemini`, `%USERPROFILE%\.antigravity`,
`%USERPROFILE%\AppData\Roaming\{agy,gemini,antigravity,.gemini}`,
`%USERPROFILE%\AppData\Local\{agy,gemini,antigravity,.gemini}`,
`%USERPROFILE%\AppData\Local\Google\Gemini`, and
`%USERPROFILE%\AppData\Local\Programs\Antigravity`.
Brace notation denotes separately checked paths, with Windows case
variants deduplicated. Snapshot counts include absent-path markers.

All 30 new files were below
`%USERPROFILE%\.gemini\antigravity-cli`; exact relative names:

```text
annotations\2eb0b031-808f-4285-a1ef-062ca33bfeb4.pbtxt
annotations\a5db2303-a7e4-44f3-971e-910c249b7a64.pbtxt
annotations\ac371ba0-5ba3-4e72-9a92-d412cc279f12.pbtxt
brain\2eb0b031-808f-4285-a1ef-062ca33bfeb4\.system_generated\logs\chunks\transcript\00000000.jsonl
brain\2eb0b031-808f-4285-a1ef-062ca33bfeb4\.system_generated\logs\chunks\transcript_full\00000000.jsonl
brain\2eb0b031-808f-4285-a1ef-062ca33bfeb4\.system_generated\logs\transcript.jsonl
brain\2eb0b031-808f-4285-a1ef-062ca33bfeb4\.system_generated\logs\transcript_full.jsonl
brain\a5db2303-a7e4-44f3-971e-910c249b7a64\.system_generated\logs\chunks\transcript\00000000.jsonl
brain\a5db2303-a7e4-44f3-971e-910c249b7a64\.system_generated\logs\chunks\transcript_full\00000000.jsonl
brain\a5db2303-a7e4-44f3-971e-910c249b7a64\.system_generated\logs\transcript.jsonl
brain\a5db2303-a7e4-44f3-971e-910c249b7a64\.system_generated\logs\transcript_full.jsonl
brain\ac371ba0-5ba3-4e72-9a92-d412cc279f12\.system_generated\logs\chunks\transcript\00000000.jsonl
brain\ac371ba0-5ba3-4e72-9a92-d412cc279f12\.system_generated\logs\chunks\transcript_full\00000000.jsonl
brain\ac371ba0-5ba3-4e72-9a92-d412cc279f12\.system_generated\logs\transcript.jsonl
brain\ac371ba0-5ba3-4e72-9a92-d412cc279f12\.system_generated\logs\transcript_full.jsonl
cache\last_conversations.json
conversations\2eb0b031-808f-4285-a1ef-062ca33bfeb4.db
conversations\a5db2303-a7e4-44f3-971e-910c249b7a64.db
conversations\ac371ba0-5ba3-4e72-9a92-d412cc279f12.db
crashes\crash_25412_9058722e-cdc8-4a8f-9ea3-06b7f0bc2f2e.log
implicit\51b24a17-0495-4e2f-a65a-0fcb90fd6069.pb
jetbox_summaries_proto.pb
log\cli-20261024_134513.log
log\cli-20261024_134712.log
log\cli-20261024_134857.log
log\cli-20261024_134954.log
log\cli-20261024_135052.log
presence\2eb0b031-808f-4285-a1ef-062ca33bfeb4.lock
presence\a5db2303-a7e4-44f3-971e-910c249b7a64.lock
presence\ac371ba0-5ba3-4e72-9a92-d412cc279f12.lock
```

Existing file/link names with changed metadata, relative to the same root:

```text
cache\onboarding.json
cli.log
conversation_summaries.db
last_check.timestamp
```

`cli.log` was treated as a symbolic link, not read through. Changed
directory names were the `antigravity-cli` root and its `brain`, `cache`,
`conversations`, `crashes`, `implicit`, and `log` subdirectories, plus
`%USERPROFILE%\AppData\Local\agy\bin`. No other surveyed original root
showed a changed entry in this comparison.

OBSERVED: the temporary home stayed empty but the original agy tree
changed. The two home variables therefore did not provide write isolation
for these commands. Metadata observations do not establish byte-for-byte
integrity, a crash cause, or the contents of any generated file. Original
application-generated files were preserved; none were read or committed.

### Cleanup and scope

Only the owned, empty temporary home was removed, with absence checked
after removal. No production/test code was changed, and no credential was
explicitly retrieved, changed, or deleted. Original application-generated
state was not manually edited or deleted; CLI-created and CLI-updated state
was left in place. Only this Markdown report is included in the follow-up
commit.

## 2026-10-24 follow-up: child-only USERPROFILE and HOME

Starting commit: `9af76d2`, branch `feat/navi-cross-platform`, clean
working tree. This experiment changes different variables from the
previous home-variable experiment; its results are recorded separately.

### Authentication and storage verdicts

Requested authentication classification: **로그인 공유** (login shared).
OBSERVED: the requested Flash prompt returned `OK`, exit 0, with no
detected login requirement, no stderr, no quota error, and no timeout.
No login/logout command or login input was supplied. No new login window
was observed during or after the run, so none required cancellation.

Storage separation: **PASS for the requested original-folder criterion**.
The original `%USERPROFILE%\.gemini\antigravity-cli` had no new, removed,
or metadata-changed entry, including no new conversation or log file.
The temporary profile instead acquired its own `.gemini` tree.

These are separate conclusions: the prompt reused accessible
authentication while its observed agy state was written under the
temporary profile. Successful authentication does not identify the
credential source or prove that every Windows storage location is isolated.
`APPDATA`, `LOCALAPPDATA`, and the Windows user identity were not deliberately
changed by this experiment. No credential value or configuration/log/
database content was retrieved or printed.

### Exact execution scope

The owned directory was created empty:

```text
%USERPROFILE%\AppData\Local\Temp\navi-profile-survey-5a951f64-f9d5-4e57-a13b-fe1a371039cb
```

`%USERPROFILE%` in report paths always denotes the original parent profile.
Only the child PowerShell 7.6.8 process set these environment variables:

```powershell
$env:USERPROFILE = $runRoot
$env:HOME = $runRoot
Set-Location -LiteralPath $runRoot
# Original installed executable, resolved before changing the child profile:
& $agyExe -p "reply OK" --model gemini-3.8-flash --effort low
```

`$agyExe` was `%USERPROFILE%\AppData\Local\agy\bin\agy.exe` under the
original profile. `ANTIGRAVITY_HOME` and `GEMINI_CLI_HOME` were absent in
the parent and were not set for this run. Parent `USERPROFILE` and `HOME`
were checked unchanged afterward; no persistent environment setting was
modified.

The runner registered output/process events before starting agy, captured
command output only in memory, and emitted fixed status markers. Stdin
was closed without supplying input. An explicit login requirement would
stop the owned CLI process tree; a 90-second bound also applied. The run
completed normally without either stop condition.

### Before/after comparison

Only names and filesystem metadata were examined. The comparison included
entry type, size, last-write/change times, file identifier, and mode.
Symbolic links were not followed; file contents and content hashes were
not read.

| Observation | Result |
| --- | --- |
| Baseline, UTC | `2026-10-24T05:32:47.550Z` |
| After, UTC | `2026-10-24T05:34:03.021Z` |
| Original agy-tree entries | 116 before / 116 after |
| Original new / removed / metadata-changed names | 0 / 0 / 0 |
| Original new conversation / log files | None |
| Temporary profile initial child count | 0 |
| Temporary profile final files / links | 45 / 1 |
| Temporary profile final directories | 35 below the root, plus the root itself |
| Temporary snapshot records | 82, including the root |
| Enumeration errors | 0 in original and temporary trees |

The unchanged original metadata supports the requested observed storage
separation criterion, not byte-for-byte integrity or a general sandbox
guarantee.

All temporary file/link names follow, relative to the owned root. `cli.log`
is a symbolic link; all other listed entries are regular files.

```text
.gemini\antigravity-cli\annotations\32e7a880-92ed-4670-a441-092dc9c57b2e.pbtxt
.gemini\antigravity-cli\bin\webm_encoder.exe
.gemini\antigravity-cli\brain\32e7a880-92ed-4670-a441-092dc9c57b2e\.system_generated\logs\chunks\transcript\00000000.jsonl
.gemini\antigravity-cli\brain\32e7a880-92ed-4670-a441-092dc9c57b2e\.system_generated\logs\chunks\transcript_full\00000000.jsonl
.gemini\antigravity-cli\brain\32e7a880-92ed-4670-a441-092dc9c57b2e\.system_generated\logs\transcript.jsonl
.gemini\antigravity-cli\brain\32e7a880-92ed-4670-a441-092dc9c57b2e\.system_generated\logs\transcript_full.jsonl
.gemini\antigravity-cli\builtin\.checksum
.gemini\antigravity-cli\builtin\keep.txt
.gemini\antigravity-cli\builtin\skills\agy-customizations\docs\hooks.md
.gemini\antigravity-cli\builtin\skills\agy-customizations\docs\json_configs.md
.gemini\antigravity-cli\builtin\skills\agy-customizations\docs\mcp_servers.md
.gemini\antigravity-cli\builtin\skills\agy-customizations\docs\plugins.md
.gemini\antigravity-cli\builtin\skills\agy-customizations\docs\rules.md
.gemini\antigravity-cli\builtin\skills\agy-customizations\docs\skills.md
.gemini\antigravity-cli\builtin\skills\agy-customizations\SKILL.md
.gemini\antigravity-cli\builtin\skills\antigravity_guide\references\app.md
.gemini\antigravity-cli\builtin\skills\antigravity_guide\references\cli.md
.gemini\antigravity-cli\builtin\skills\antigravity_guide\references\ide.md
.gemini\antigravity-cli\builtin\skills\antigravity_guide\references\sdk.md
.gemini\antigravity-cli\builtin\skills\antigravity_guide\SKILL.md
.gemini\antigravity-cli\builtin\skills\automation\SKILL.md
.gemini\antigravity-cli\builtin\skills\generative_ui\SKILL.md
.gemini\antigravity-cli\builtin\skills\migrate-workflows\SKILL.md
.gemini\antigravity-cli\builtin\skills\permissioned-github\SKILL.md
.gemini\antigravity-cli\builtin\skills\plugin\SKILL.md
.gemini\antigravity-cli\builtin\skills\run-workflow\SKILL.md
.gemini\antigravity-cli\builtin\skills\ui-plugin-navigation\SKILL.md
.gemini\antigravity-cli\cache\default_project_id.txt
.gemini\antigravity-cli\cache\last_conversations.json
.gemini\antigravity-cli\cache\onboarding.json
.gemini\antigravity-cli\cli.log
.gemini\antigravity-cli\conversations\32e7a880-92ed-4670-a441-092dc9c57b2e.db
.gemini\antigravity-cli\conversation_summaries.db
.gemini\antigravity-cli\crashes\crash_34160_ca6f2c81-a880-4cb0-b8a8-3ea500e5dfe6.log
.gemini\antigravity-cli\implicit\a84b53b2-561e-4b4c-a4f1-8c38fb94db24.pb
.gemini\antigravity-cli\installation_id
.gemini\antigravity-cli\jetbox_summaries_proto.pb
.gemini\antigravity-cli\jetski_state.pbtxt
.gemini\antigravity-cli\last_check.timestamp
.gemini\antigravity-cli\log\cli-20261024_143337.log
.gemini\antigravity-cli\presence\32e7a880-92ed-4670-a441-092dc9c57b2e.lock
.gemini\antigravity-cli\updater\update.lock
.gemini\antigravity-cli\updater\update_status.json
.gemini\config\.migrated
.gemini\config\mcp_config.json
.gemini\config\projects\default-cli-project.json
```

The crash-named file is recorded by filename only; its cause or contents
were not investigated and do not override the observed prompt exit 0.

### Credential target names

`cmdkey.exe /list` exited 0 before and after. Only target-name fields
matching `gemini|antigravity`, case-insensitively, were retained:

| Before | After |
| --- | --- |
| `LegacyGeneric:target=gemini:antigravity` | `LegacyGeneric:target=gemini:antigravity` |

Added target names: none. Removed target names: none. Values were not
retrieved, so unchanged names do not establish unchanged values.

### Cleanup and repository scope

The owned temporary root, including its generated `.gemini` tree and
symbolic link, was removed without following the link. Its absence was
checked after removal. The original agy folder was not manually edited,
deleted, or used as a cleanup target. Only this Markdown report is included
in the follow-up commit; production and test code are unchanged.
