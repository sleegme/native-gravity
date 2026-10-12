# 사용법

> - **Native Gravity**: 1.0.0
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
ntg-vnext status  --ledger .ntg/ledger.json
```

호출마다 ledger를 다시 로드하므로 fresh context는 ledger가 가리키는 지점에서 재개됩니다. `run`은 다음 대상 마일스톤을 Bulldozer로 실행하고, 독립적인 네이티브 Zen verdict를 받아 matching GO일 때만 승격합니다. `--all`은 의존성 순서로 계속합니다. 종료 코드 2는 NO-GO, BLOCKED, NEEDS_DEEP을 의미합니다(출력된 `results` 참고). Global completion은 현재 plan의 모든 마일스톤이 current GO를 가질 때만 선언됩니다. `NTG_ZEN_MODEL`로 Zen의 모델을 지정할 수 있습니다.

## 네이티브로 선택 가능한 primary

### Excavator

"고장났으니 원인을 파서 고쳐" 유형에 사용합니다. Excavator는 직접 수정이 허용되며 bounded 조사 -> 수정 -> 검증 루프를 수행합니다. 현재 artifact에 대한 Zen `VERDICT: GO`를 관측한 뒤에만 `READY`로 끝납니다.

Bulldozer와 Piledriver는 runner 전용 역할입니다. 멀티 마일스톤 작업, durable ledger 상태, replanning, global completion은 `ntg-vnext`에 속하며, Piledriver 자문은 `ntg-vnext plan`으로 요청합니다.

## Bobcat / Puma

Bobcat은 일반적인 behavior-bearing 구현 담당이며 Bulldozer가 `ADVISOR_GATE: REQUIRED | NONE`을 선택합니다.

REQUIRED일 때 Bobcat은 read-only 로컬 조언/CHECK gate인 **Strix Halo** (`strix-halo`)를 호출합니다.

Puma는 writing, formatting, presentation-only, mechanical text/config 같은 명확하고 작은 저위험 작업 전용이며 Advisor를 부르지 않고 중첩 위임도 없습니다.

## Alpha 검증

이 checklist는 릴리스 gate입니다(`AGENTS.md` 참고). 러너 경로(1-4번)는 AGY 1.3.3에서 라이브로 통과했습니다 — `.omo/evidence/138-vnext-only-results.md` 참고. 5-8번은 deterministic 테스트로 강제되며 이전 라이브 관측이 있습니다. AGY 런타임이 바뀌면 전체 checklist를 다시 실행합니다:

1. 러너가 Steamroller -> Piledriver -> Bulldozer -> Zen을 end-to-end로 실행하고, matching Zen GO를 관측한 경우에만 마일스톤을 승격하는지;
2. 멀티 마일스톤 실행이 의존성 순서로 승격하고, material replan이 `plan_version`을 증가시키며 retained 마일스톤을 재검증하는지;
3. Zen NO-GO가 마일스톤을 미완료로 남기고, 수정된 후보가 fresh GO를 필요로 하는지;
4. fresh-context 재개가 대화가 아니라 ledger에서 이어지는지;
5. Bobcat이 `strix-halo` 외 다른 subagent를 호출하지 않는지 (negative case);
6. Excavator가 프로젝트 소스를 수정하고 current Zen verdict 없이 `READY`로 완료할 수 없는지;
7. Zen이 `NTG_ZEN_VERIFY=1` marker로 독립 검증 command를 실행하면서 일반적인 의도적 source-mutation 시도는 거부되는지;
8. Excavator-marked shell call이 일반 sudo 진단을 허용하면서 privilege-drift와 full-upgrade 경로는 거부하는지.

Excavator가 `BLOCKED`로 끝나면 열린 결정 질문은 `ntg-vnext plan`으로 Piledriver에 넘깁니다. Excavator를 Bulldozer의 child로 취급하지 않습니다.

## `gate_panel.py` (issue #112 gate-status panel)

`scripts/gate_panel.py`는 NTG gate-status panel을 렌더링합니다: 각 transcript에 대해 어떤 gate가 무장되어 있는지(excavator 또는 없음), 관측된 최신 Zen verdict, Stop hook이 반환할 결정, 그 근거, 증거 출처를 보여줍니다. Stop hook이 강제하는 것과 동일한 transcript 레코드를 읽고 그 로직을 재생합니다. 상태를 소유하거나 변경하지 않습니다.

```bash
python3 scripts/gate_panel.py --transcript /path/to/transcript.jsonl
python3 scripts/gate_panel.py --event stop-event.json
python3 scripts/gate_panel.py --transcript a.jsonl --json
```

레이아웃은 가로 전용 pane에 맞는 고정 폭 한 줄-per-gate 표이며, `--json`은 같은 상태를 프로그램 소비자에게 제공합니다.

제약(#112 결정의 escape clause): AGY 플러그인 표면은 agents / hooks / commands / skills / mcpServers를 제공하지만 플러그인 panel을 위한 Settings-tabs host가 없으며 이 저장소에도 그런 표면이 없습니다. 따라서 이 모듈은 가능한 가장 작은 유용한 버전 — Settings tab(또는 임의의 pane)이 호스팅할 수 있는 렌더러 — 이며 플러그인 통합 Settings tab이 아닙니다. 플러그인 panel용 host 표면이 생기면 이 출력을 그대로 소비할 수 있습니다.

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
