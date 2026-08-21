# 사용법

이 문서는 oh-my-agy를 로컬 Antigravity 환경에 연결하고 실제 작업에 사용하는 기본 흐름을 설명합니다.

## 1. 설치

```bash
git clone https://github.com/sleegme/oh-my-agy.git
cd oh-my-agy
./scripts/install-dev.sh
```

개발 설치는 repository checkout 자체를 `~/.gemini/antigravity-cli/plugins/oh-my-agy`에 symlink하고 `~/.local/bin/oma` convenience command를 만듭니다.

`oma`가 실행되지 않으면 `command -v oma`와 `command -v agy`를 먼저 확인하세요.

## 2. Smoke test

```bash
oma smoke
```

기본 smoke는 quota를 사용하지 않고 `agy` command, 필요한 모델, OMA custom agent discovery를 확인합니다.

실제 작은 모델 호출까지 포함하려면:

```bash
oma smoke --live
```

`--live`는 quota를 사용합니다.

## 3. Main 시작

작업할 repository에서:

```bash
oma main
```

Main은 요청을 분석하고 `.oma/task-contract.md`를 만든 뒤 적절한 category/worker로 위임하도록 설계되어 있습니다.

## 4. Worker routing

```text
작고 명확한 일
    ↓
Flash

복잡한 구현 / deep / ultrabrain / UI / architecture
    ↓
Pro
```

Main은 worker prompt에 `CATEGORY: <name>` 형태로 category를 전달합니다. 자세한 의미는 [categories.md](categories.md)를 참고하세요.

## 5. Evidence

Implementation worker는 가능한 한 다음 정보를 남겨야 합니다.

```text
Summary of changes
Files changed
Verification commands and outcomes
Remaining risks / blockers
```

Main은 이 결과를 `.oma/implementation-evidence.md`에 저장할 수 있습니다.

## 6. Review packet

```bash
oma packet
```

현재 task contract, evidence, git diff/status를 `.oma/review-packet.md`로 묶습니다.

## 7. Opus review

```bash
oma review
```

Reviewer는 read-only이며 acceptance criteria, correctness, regression, scope expansion, risky deletion, API/behavior contract, verification adequacy를 blocker 관점에서 검사합니다.

최종 verdict는 `VERDICT: GO` 또는 `VERDICT: NO-GO`입니다.

NO-GO일 때는 concrete blocker만 같은 worker session으로 보내는 것을 권장합니다.

## 8. 수정 루프

```text
worker implementation
    ↓
evidence
    ↓
review
    ↓
NO-GO
    ↓
blocker only
    ↓
same worker session
    ↓
fix
    ↓
review again
```

v0.1에서는 같은 blocker에 대해 두 번 정도 correction 후 Main이 다시 진단하는 것을 기본으로 합니다.

## 9. Model override

```bash
OMA_MAIN_MODEL=<model-slug> oma main
OMA_REVIEW_MODEL=<model-slug> oma review
```

preview naming/model slug drift가 있을 때 escape hatch로 사용할 수 있습니다.

## 10. Quota 관찰

v0.1에서는 자동 quota routing을 하지 않습니다. 작업 전후 Gemini/Claude remaining %, category, 사용 모델 정도를 기록한 뒤 실제 burn-rate를 보고 라우팅을 조정합니다.

## 11. 문제 발생 시

```bash
agy --version
agy models
agy agents
oma smoke
```

그 다음 plugin symlink와 agent frontmatter를 확인합니다.
