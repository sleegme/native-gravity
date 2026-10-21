#!/usr/bin/env bash
# Adapted from the measured wf-tools test.sh; only ctx and git-snap.
# Invoked by test_workflow_tools.py in the repository suite.
set -u
cd "$(dirname "$0")/../tools"

pass=0
fail=0

has() { # has <label> <haystack> <needle>
    if [[ $2 == *"$3"* ]]; then
        pass=$((pass + 1)); printf 'ok   %s\n' "$1"
    else
        fail=$((fail + 1)); printf 'FAIL %s -- missing: [%s]\n' "$1" "$3"
    fi
}

hasnt() { # hasnt <label> <haystack> <needle>
    if [[ $2 != *"$3"* ]]; then
        pass=$((pass + 1)); printf 'ok   %s\n' "$1"
    else
        fail=$((fail + 1)); printf 'FAIL %s -- unexpected: [%s]\n' "$1" "$3"
    fi
}

eq() { # eq <label> <actual> <expected>
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1)); printf 'ok   %s\n' "$1"
    else
        fail=$((fail + 1)); printf 'FAIL %s -- got [%s] want [%s]\n' "$1" "$2" "$3"
    fi
}

lte() { # lte <label> <actual> <max_allowed>
    if [ "$2" -le "$3" ]; then
        pass=$((pass + 1)); printf 'ok   %s\n' "$1"
    else
        fail=$((fail + 1)); printf 'FAIL %s -- got [%s] want <= [%s]\n' "$1" "$2" "$3"
    fi
}


for s in ctx git-snap; do
    if [ ! -x "./$s" ]; then
        printf 'error: ./%s missing or not executable\n' "$s" >&2
        exit 2
    fi
done

here=$PWD

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=Test
export GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=Test
export GIT_COMMITTER_EMAIL=test@example.com
export GIT_CEILING_DIRECTORIES="$tmp"

echo '=== ctx ==='
mkdir -p "$tmp/fx"
printf 'one\ntwo\nthree\nfour\nfive\n' > "$tmp/fx/a.txt"

out=$(./ctx "$tmp/fx/a.txt"); rc=$?
eq 'ctx: exit 0' "$rc" 0
has 'ctx: header' "$out" "== $tmp/fx/a.txt (5 lines) =="
has 'ctx: line 1 numbered' "$out" "$(printf '     1\tone')"
has 'ctx: line 5 numbered' "$out" "$(printf '     5\tfive')"

out=$(./ctx "$tmp/fx/a.txt:2-4")
has 'ctx: range start' "$out" "$(printf '     2\ttwo')"
has 'ctx: range end' "$out" "$(printf '     4\tfour')"
hasnt 'ctx: range excludes 1' "$out" "$(printf '     1\tone')"
hasnt 'ctx: range excludes 5' "$out" "$(printf '     5\tfive')"

awk 'BEGIN { for (i = 1; i <= 450; i++) printf "line %03d\n", i }' > "$tmp/fx/big.txt"
out=$(./ctx "$tmp/fx/big.txt")
has 'ctx: truncation note' "$out" '... truncated, 50 more lines'
has 'ctx: line 400 shown' "$out" "$(printf '%6d\t%s' 400 'line 400')"
hasnt 'ctx: line 401 hidden' "$out" 'line 401'
hasnt 'ctx: line 450 hidden' "$out" 'line 450'

out=$(./ctx "$tmp/fx/big.txt:401-450")
has 'ctx: range past cap start' "$out" "$(printf '%6d\t%s' 401 'line 401')"
has 'ctx: range past cap end' "$out" "$(printf '%6d\t%s' 450 'line 450')"
hasnt 'ctx: range past cap truncated note' "$out" 'truncated'

printf 'text\0more\n' > "$tmp/fx/bin.dat"
out=$(./ctx "$tmp/fx/bin.dat"); rc=$?
eq 'ctx: binary exit 0' "$rc" 0
has 'ctx: binary noted' "$out" '(binary file, skipped)'
hasnt 'ctx: binary content hidden' "$out" 'text'

out=$(./ctx "$tmp/fx/nope.txt" "$tmp/fx/a.txt"); rc=$?
eq 'ctx: missing file exit 1' "$rc" 1
has 'ctx: missing reported' "$out" "== $tmp/fx/nope.txt (error: no such file or directory) =="
has 'ctx: continues after missing' "$out" "$(printf '     1\tone')"

: > "$tmp/fx/empty.txt"
out=$(./ctx "$tmp/fx/empty.txt")
has 'ctx: empty file header' "$out" '(0 lines)'

out=$(./ctx --help); rc=$?
eq 'ctx: --help exit 0' "$rc" 0
has 'ctx: --help text' "$out" 'usage: ctx'

out=$(./ctx 2>&1); rc=$?
eq 'ctx: no args exit 2' "$rc" 2

# === ctx capping tests ===
out=$(./ctx --max-bytes "$tmp/fx/big.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: default cap byte bound' "$bytes" 24576
has 'ctx: default cap omitted notice' "$out" "... omitted: $tmp/fx/big.txt:401-450"


out=$(./ctx --max-bytes=100 "$tmp/fx/big.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: max-bytes=100 byte bound' "$bytes" 100
has 'ctx: max-bytes=100 omitted notice' "$out" "... omitted: $tmp/fx/big.txt:"

out=$(./ctx --max-bytes 120 "$tmp/fx/big.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: max-bytes 120 byte bound' "$bytes" 120
has 'ctx: max-bytes 120 omitted notice' "$out" "... omitted: $tmp/fx/big.txt:"

out=$(CTX_MAX_BYTES=150 ./ctx "$tmp/fx/big.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: CTX_MAX_BYTES byte bound' "$bytes" 150
has 'ctx: CTX_MAX_BYTES omitted notice' "$out" "... omitted: $tmp/fx/big.txt:"

out=$(CTX_MAX_BYTES=150 ./ctx --max-bytes=100 "$tmp/fx/big.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: flag overrides CTX_MAX_BYTES' "$bytes" 100

out=$(./ctx --max-bytes=120 "$tmp/fx/a.txt" "$tmp/fx/big.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: multi-file byte bound' "$bytes" 120
has 'ctx: multi-file omitted notice file 1' "$out" "... omitted: $tmp/fx/a.txt:"
has 'ctx: multi-file omitted notice file 2' "$out" "... omitted: $tmp/fx/big.txt:1-450"

# Long lines
python3 -c 'print("x" * 2500)' > "$tmp/fx/longline.txt"
out=$(./ctx "$tmp/fx/longline.txt")
has 'ctx: long line cut marker' "$out" ' ... [+500 chars]'
out=$(./ctx --max-bytes=200 "$tmp/fx/longline.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: long line capped byte bound' "$bytes" 200
has 'ctx: long line omitted notice' "$out" "... omitted: $tmp/fx/longline.txt:1-1"

# Multibyte UTF-8
printf 'こんにちは世界\n絵文字 🚀🌟🎉\nテスト行三\n' > "$tmp/fx/utf8.txt"
out=$(./ctx "$tmp/fx/utf8.txt")
has 'ctx: utf8 content preserved' "$out" 'こんにちは世界'
has 'ctx: utf8 emoji preserved' "$out" '🚀🌟🎉'
out=$(./ctx --max-bytes=80 "$tmp/fx/utf8.txt")
bytes=$(printf '%s\n' "$out" | wc -c)
lte 'ctx: utf8 capped byte bound' "$bytes" 80
has 'ctx: utf8 omitted notice' "$out" "... omitted: $tmp/fx/utf8.txt:"


echo
echo '=== git-snap ==='
repo=$tmp/repo
git init -q "$repo"
git -C "$repo" symbolic-ref HEAD refs/heads/main
printf 'hello\n' > "$repo/README.md"
git -C "$repo" add README.md
git -C "$repo" commit -qm 'initial commit'
bare=$tmp/origin.git
git init -q --bare "$bare"
git -C "$repo" remote add origin "$bare"
git -C "$repo" push -qu origin main
git -C "$repo" branch feature/x
printf 'more\n' >> "$repo/README.md"
git -C "$repo" commit -qam 'second commit'
printf 'wip\n' >> "$repo/README.md"
git -C "$repo" stash -q

out=$(cd "$repo" && "$here/git-snap"); rc=$?
eq 'git-snap: default dir exit 0' "$rc" 0
has 'git-snap: repo section' "$out" '## repo'
has 'git-snap: work tree root' "$out" "$repo"
has 'git-snap: branch line' "$out" 'main -> origin/main [ahead 1, behind 0]'
has 'git-snap: status clean' "$out" 'clean'
has 'git-snap: local branch' "$out" 'feature/x'
has 'git-snap: remote branch' "$out" 'origin/main'
has 'git-snap: commits section' "$out" '## commits (last 5)'
has 'git-snap: newest commit' "$out" 'second commit'
has 'git-snap: older commit' "$out" 'initial commit'
has 'git-snap: remotes section' "$out" '## remotes'
has 'git-snap: origin url' "$out" "$bare"
has 'git-snap: stash section' "$out" '## stash'
has 'git-snap: stash count' "$out" '1 entries'

printf 'x\n' > "$repo/untracked.txt"
out=$(./git-snap "$repo")
has 'git-snap: dirty status' "$out" '?? untracked.txt'

i=1
while [ "$i" -le 60 ]; do
    : > "$repo/u$i.txt"
    i=$((i + 1))
done
out=$(./git-snap "$repo")
has 'git-snap: status line cap' "$out" '... 11 more entries (of 61)'
hasnt 'git-snap: status tail hidden' "$out" '?? u60.txt'

mkdir -p "$tmp/notrepo"
out=$(cd "$tmp/notrepo" && "$here/git-snap" 2>&1); rc=$?
eq 'git-snap: outside repo exit 1' "$rc" 1
has 'git-snap: outside repo message' "$out" 'not a git repository'

out=$(./git-snap "$tmp/notrepo" 2>&1); rc=$?
eq 'git-snap: outside repo dir arg exit 1' "$rc" 1

out=$(./git-snap "$tmp/no-such-dir" 2>&1); rc=$?
eq 'git-snap: missing dir exit 1' "$rc" 1
has 'git-snap: missing dir message' "$out" 'no such directory'

out=$(./git-snap --help); rc=$?
eq 'git-snap: --help exit 0' "$rc" 0
has 'git-snap: --help text' "$out" 'usage: git-snap'


echo
if [ "$fail" -eq 0 ]; then
    printf 'ALL PASS: %d assertions\n' "$pass"
    exit 0
fi
printf 'FAILURES: %d passed, %d failed\n' "$pass" "$fail"
exit 1
