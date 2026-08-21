# 사용법

이 문서는 oh-my-agy를 로컬 Antigravity 환경에 연결하고 실제 작업에 사용하는 기본 흐름을 설명합니다.

## 1. 설치

```bash
git clone https://github.com/sleegme/oh-my-agy.git
cd oh-my-agy
./scripts/install-dev.sh
```

개발 설치는 repository checkout 자체를 Antigravity plugin 경로에 symlink 합니다.

```text
~/.gemini/antigravity-cli/plugins/oh-my-agy
```

그리고 convenience command를 다음 위치에 연결합니다.

```text
~/.local/bin/oma
```

`oma`가 실행되지 않으면 먼저 다음을 확인합니다.

```bash
command -v oma
command -v agy
```

## 2. Smoke test

실제 quota를 쓰지 않는 기본 점검:

```bash
oma smoke
```

이 명령은 다음을 확인합니다.

- `agy` command가 PATH에 존재하는지
- 필요한 Gemini / Claude 모델이 `agy models`에서 보이는지
- OMA custom agent가 AGY에 discovery 되었는지

현재 검사 대상 agent:

```text
oma-main
oma-implementation-flash
oma-implementation-pro
oma-review
oma-explore
oma-librarian
```

### Live smoke

```bash
oma smoke --live
```

`--live`는 실제 모델 호출을 포함하므로 quota를 사용합니다. 설치 확인만 필요하다면 기본 `oma smoke`만 사용하세요.

## 3. Main 시작

작업할 repository로 이동한 뒤:

```bash
oma main
```

`oma main`은 현재 설치된 Sonnet 4.6 model slug를 찾아 `oma-main` agent로 세션을 시작합니다.

Main에게는 평범하게 작업 요청을 주면 됩니다.

예:

```text
이 repository에서 로그인 후 redirect가 가끔 잘못되는 원인을 찾아서 수정해.
기존 API contract는 바꾸지 말고 관련 테스트까지 확인해.
```

Main은 요청을 분석하고 `.oma/task-contract.md`를 만든 뒤 적절한 category/worker로 위임하도록 설계되어 있습니다.

## 4. Worker routing

대략적인 기준은 다음과 같습니다.

```text
작고 명확한 일
    ↓
Flash

복잡한 구현 / deep / ultrabrain / UI / architecture
    ↓
Pro
```

Main이 정확한 category를 선택하고 worker prompt에 다음 형태로 전달합니다.

```text
CATEGORY: deep
```

category별 의미는 [categories.md](categories.md)를 참고하세요.

## 5. Evidence

Implementation worker는 작업이 끝났다고 말하는 대신 가능한 한 다음 정보를 남겨야 합니다.

```text
Summary of changes
Files changed
Verification commands and outcomes
Remaining risks / blockers
```

Main은 이 결과를 `.oma/implementation-evidence.md`에 저장할 수 있습니다.

## 6. Review packet

현재 worktree의 task contract, evidence, git diff/status를 review용 snapshot으로 만들려면:

```bash
oma packet
```

생성 위치:

```text
.oma/review-packet.md
```

이 파일은 최종 reviewer가 구현 맥락을 빠르게 확인하기 위한 local artifact입니다.

## 7. Opus review

```bash
oma review
```

목표는 같은 `oma-review` harness를 Claude Opus 4.6로 실행하는 것입니다.

Reviewer는 read-only이며 다음을 blocker 관점에서 검사합니다.

- acceptance criteria
- correctness
- regression
- scope expansion
- risky deletion
- API/behavior contract
- verification adequacy

최종 verdict는 다음 둘 중 하나입니다.

```text
VERDICT: GO
```

```text
VERDICT: NO-GO
```

NO-GO일 때는 전체 구현을 처음부터 다시 시키는 대신 concrete blocker만 같은 worker session으로 보내는 것을 권장합니다.

## 8. 수정 루프

권장 흐름:

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

같은 blocker가 반복되는 경우 무한 retry하지 않습니다. v0.1에서는 두 번 정도의 correction loop 후 Main이 문제를 다시 진단하는 것을 기본으로 합니다.

## 9. Model override

정확한 모델 slug 자동 탐지가 실패할 경우 environment variable로 override할 수 있습니다.

Main:

```bash
OMA_MAIN_MODEL=<model-slug> oma main
```

Review:

```bash
OMA_REVIEW_MODEL=<model-slug> oma review
```

이는 AGY에서 model slug가 바뀌거나 preview naming이 달라졌을 때 임시 escape hatch로 사용할 수 있습니다.

## 10. Quota 관찰

v0.1에서는 자동 quota routing을 하지 않습니다.

실사용 중에는 다음만 기록해도 충분합니다.

```text
작업 전 Gemini remaining %
작업 전 Claude/non-Gemini remaining %
작업 category
사용 모델
작업 후 remaining %
```

여러 작업이 쌓이면 다음 질문에 답할 수 있습니다.

```text
Gemini pool이 먼저 닳는가?
Claude pool이 먼저 닳는가?
어떤 category가 예상보다 비싼가?
Opus review 빈도가 너무 높은가?
```

그 다음에 routing을 조정합니다. 초기부터 dynamic quota router를 만드는 것은 v0.1 범위 밖입니다.

## 11. 문제 발생 시 확인 순서

```bash
agy --version
agy models
agy agents
oma smoke
```

그 다음 plugin symlink와 agent frontmatter를 확인합니다.

```bash
ls -l ~/.gemini/antigravity-cli/plugins/oh-my-agy
ls -l ~/.local/bin/oma
```

AGY 업데이트 후 tool 이름이나 custom agent schema가 바뀐 경우 OMA 쪽도 수정이 필요할 수 있습니다.
