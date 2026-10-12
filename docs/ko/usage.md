# 사용법

> - **Native Gravity**: 1.1.0
> - **상태**: alpha
> - **호환성**:
>   - AGY 1.3.3 — validated

체크아웃한 저장소에서 플러그인을 설치/재설치합니다:

```bash
agy plugin uninstall native-gravity
agy plugin install .
```

업그레이드 시에는 제거된 legacy agent/hook 파일이 남지 않도록 clean reinstall을 권장합니다.

## `ntg-vnext` 러너

vNext가 유일한 런타임입니다. 멀티 마일스톤 작업은 plan(goal, constraints, `plan_version`, `acceptance_criteria`/`bounded_scope`/`non_goals`/`dependencies`를 가진 milestones)을 작성하고 러너로 실행합니다:

```bash
ntg-vnext init    --ledger .ntg/ledger.json --plan plan.json
ntg-vnext plan    --ledger .ntg/ledger.json --task "..."   # Piledriver 자문; 자동 채택 없음
ntg-vnext run     --ledger .ntg/ledger.json [--milestone ID] [--all]
ntg-vnext replan  --ledger .ntg/ledger.json --plan plan-v2.json
ntg-vnext recover --ledger .ntg/ledger.json --evidence "observed interruption"
ntg-vnext alt     --ledger .ntg/ledger.json --task "..." [--milestone ID] [--escalate]   # Instinct 자문; 자동 채택 없음
ntg-vnext status  --ledger .ntg/ledger.json
```

호출마다 ledger를 다시 로드하므로 fresh context는 ledger가 가리키는 지점에서 재개됩니다. `run`은 다음 대상 마일스톤을 Bulldozer로 실행하고, 독립적인 네이티브 Zen verdict를 받아 matching GO일 때만 승격합니다. `--all`은 의존성 순서로 계속합니다. 종료 코드 2는 NO-GO, BLOCKED, NEEDS_DEEP을 의미합니다(출력된 `results` 참고). Global completion은 현재 plan의 모든 마일스톤이 current GO를 가질 때만 선언됩니다. `NTG_ZEN_MODEL`로 Zen의 모델을 지정할 수 있습니다.

`alt`는 Instinct alternate-framing 자문(NEEDS_ALT)을 요청하고 advisory JSON을 `adopted: false`와 함께 출력합니다. 자문은 advisory evidence로만 기록되며 plan 채택이나 completion 상태 변경이 없습니다. `status`는 실패 class별 `needs_alt` 추천을 보여줍니다: 같은 실패 class가 새 증거 없이 3회 이상 반복되면 NEEDS_ALT를 추천합니다. `--escalate`만 Opus tier로 가며, 없으면 Instinct는 Sonnet에서 실행됩니다.

## Excavator worker

Excavator는 Bulldozer의 worker로, "고장났는데 원인을 아는 사람이 없다"는 어려운 경우에 씁니다. 마일스톤에 어려운 고장 문제가 있을 때 Bulldozer가 bounded 진단 -> 재현 -> 근본 원인 -> 수리 -> 검증 루프를 Excavator에 위임하며, 일반 구현은 Bobcat에 남습니다. Excavator는 위임받은 범위 안에서 직접 수정하며, 중첩 위임이 없고 Zen을 호출하지 않습니다. worker 결과(ROOT_CAUSE `CONFIRMED | LIKELY | SPECULATIVE`, CHANGES, VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK, STATUS `READY | BLOCKED`)를 Bulldozer에 반환하며, STATUS는 로컬 worker 신호이지 마일스톤이나 프로젝트 완료가 아닙니다.

네이티브로 선택 가능한 primary는 더 이상 없으며, 프로젝트 작업의 진입점은 `ntg-vnext`입니다. Bulldozer, Piledriver, Instinct는 runner 전용 역할입니다. 멀티 마일스톤 작업, durable ledger 상태, replanning, global completion은 `ntg-vnext`에 속하며, Piledriver 자문은 `ntg-vnext plan`으로, Instinct 자문은 `ntg-vnext alt`로 요청합니다.

## Bobcat / Puma / Excavator

Bobcat은 일반적인 behavior-bearing 구현 담당이며 Bulldozer가 `ADVISOR_GATE: REQUIRED | NONE`을 선택합니다.

REQUIRED일 때 Bobcat은 read-only 로컬 조언/CHECK gate인 **Strix Halo** (`strix-halo`)를 호출합니다.

Puma는 writing, formatting, presentation-only, mechanical text/config 같은 명확하고 작은 저위험 작업 전용이며 Advisor를 부르지 않고 중첩 위임도 없습니다.

Excavator는 한 마일스톤 안에서 어려운 고장 진단/수리 전용입니다 — 스스로 조사하고, 재현하고, 근본 원인을 고치고, 결과를 검증합니다.

## Alpha 검증

이 checklist는 릴리스 gate입니다(`AGENTS.md` 참고). 러너 경로(1-4번)는 AGY 1.3.3에서 라이브로 통과했습니다 — `.omo/evidence/138-vnext-only-results.md` 참고. 5-8번은 deterministic 테스트로 강제되며 이전 라이브 관측이 있습니다. AGY 런타임이 바뀌면 전체 checklist를 다시 실행합니다:

1. 러너가 Steamroller -> Piledriver -> Bulldozer -> Zen을 end-to-end로 실행하고, matching Zen GO를 관측한 경우에만 마일스톤을 승격하는지;
2. 멀티 마일스톤 실행이 의존성 순서로 승격하고, material replan이 `plan_version`을 증가시키며 retained 마일스톤을 재검증하는지;
3. Zen NO-GO가 마일스톤을 미완료로 남기고, 수정된 후보가 fresh GO를 필요로 하는지;
4. fresh-context 재개가 대화가 아니라 ledger에서 이어지는지;
5. Bobcat이 `strix-halo` 외 다른 subagent를 호출하지 않는지 (negative case);
6. Bulldozer가 bounded 진단+수리를 Excavator에 위임할 때 Excavator가 수정을 하고, subagent(Zen 포함)를 호출하지 않으며 worker 결과를 반환하는지, 그리고 Bulldozer 위임 검증이 Excavator를 수용하고 non-worker 역할을 거부하는지;
7. Zen이 `NTG_ZEN_VERIFY=1` marker로 독립 검증 command를 실행하면서 일반적인 의도적 source-mutation 시도는 거부되는지;
8. Excavator-marked shell call이 일반 sudo 진단을 허용하면서 privilege-drift와 full-upgrade 경로는 거부하는지.

마일스톤이 열린 결정 질문으로 `BLOCKED`가 되면 `ntg-vnext plan`으로 Piledriver에 넘깁니다. Excavator는 Bulldozer의 worker입니다: `STATUS`는 마일스톤 내부의 로컬 신호이며, 승격과 완료는 오직 Steamroller만 합니다.

## `ntg-dag` (ledger 마일스톤 그래프)

`ntg-dag`는 vNext ledger 스냅샷의 마일스톤 의존 그래프를 터미널에 Unicode 박스로 그립니다. 읽기 전용이며 ledger를 수정하지 않습니다.

```bash
node scripts/dag-view.mjs --ledger tests/fixtures/dag-view/all-states.ledger.json --width 80 --no-color
```

- `--ledger PATH`: ledger JSON 경로 (`NTG_LEDGER` env로도 지정 가능)
- `--watch`: ledger 파일 변경 시 전체 화면 다시 그림 (herdr/tmux 옆 pane에 띄우면 라이브)
- `--width N`: 폭 고정 (기본: TTY 컬럼)
- `--no-color`: ANSI 색 비활성화

설치 후 `ntg-dag` 이름으로도 실행 가능합니다.
