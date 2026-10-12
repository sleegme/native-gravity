# 상태

- **Native Gravity**: 1.1.0
- **상태**: alpha
- **호환성**:
  - AGY 1.3.3 — validated (vNext 러너 라이브 프로브: #134, #138; 위임 프로브: #113/#56; Instinct NEEDS_ALT 라이브 호출: #20)

버전 체계 및 라이프사이클 정책은 [Versioning Policy](../versioning.md)를 참고하세요.

## 상태

### Excavator 강등: Bulldozer worker (이번 릴리스)

Excavator는 더 이상 네이티브로 선택 가능한 primary가 아닙니다. Bulldozer만 호출하는 specialist worker로, 한 마일스톤 안에서 어려운 진단 -> 재현 -> 근본 원인 -> 수리 -> 검증 작업을 수행합니다(소유자 결정). 네이티브로 선택 가능한 primary는 더 이상 없으며 진입점은 `ntg-vnext`입니다. Excavator는 worker 결과(ROOT_CAUSE `CONFIRMED | LIKELY | SPECULATIVE`, CHANGES, VERIFICATION_EVIDENCE, ROLLBACK, RESIDUAL_RISK, STATUS `READY | BLOCKED`)를 Bulldozer에 반환하며, STATUS는 다른 worker와 같은 로컬 신호입니다. 조사 깊이, 근본 원인 규율, `NTG_EXCAVATOR=1` shell guard를 유지하고, 중첩 위임이 없으며 Zen을 호출하지 않습니다 — 네이티브 primary Zen completion gate(`hooks/excavator-review-gate.py` Stop hook)는 primary와 함께 제거되고, 이를 표시하기만 했던 `scripts/gate_panel.py`도 제거됩니다(issue #112 이력은 `.omo/evidence`에 보존). Bulldozer 위임 검증은 Excavator를 마일스톤 worker로 수용하고 non-worker 역할을 거부합니다. #137의 `inheritCustomizations: true` 결정은 네이티브 primary에 대한 것으로 이번 강등으로 superseded 됩니다; worker는 `inheritCustomizations` 필드를 갖지 않습니다.

### Instinct (#20)와 Bulldozer relay 규칙 (#136)

Instinct는 heterogeneous alternate-framing 자문입니다. runner 전용이며 advisory입니다: bare JSON 객체 하나(현재 framing, 그것이 틀릴 수 있는 이유, 각각 evidence basis와 discriminating test를 가진 materially 다른 가설/접근, 권고, unknowns)를 반환하고 구현, 오케스트레이션, ledger, completion 권한이 없습니다. `ntg-vnext alt`는 bounded NEEDS_ALT 패킷(failure class/signature, 현재 가설, 시도 횟수, evidence, tier-B replan context)으로 호출하고 결과는 advisory evidence(`adopted: false`)로만 기록됩니다. Exact-model 해석은 Claude Sonnet 5.5 / High를 목표로 하고, Claude Opus 5.5 / High는 명시적 `--escalate`에서만 선택되며 기존과 같은 fail-closed slug 해석을 사용합니다(OQ-4 해결). `status`는 같은 실패 class가 새 증거 없이 3회 이상 반복될 때 class별로 NEEDS_ALT를 추천합니다(계약 §2.9); 추천은 유료 호출을 자동 실행하지 않습니다.

#136: Bulldozer의 MACHINE-INVOCATION MODE가 specialist/worker 보고를 packet 필드(`verification_evidence`, `delegations` findings) 안에서만 relay하도록 요구합니다. JSON 객체 앞뒤의 텍스트는 금지되며 packet 파서는 그대로입니다: 모호하지 않은 JSON 객체 하나만 받고, 잘못된 형식·복수 객체·모호한 산문이 섞인 출력은 거부합니다.

### vNext-only (1.0.0, #138)

vNext가 유일한 구조입니다. pre-vNext(v0.4) 토폴로지와 호환성 경로가 제거되었습니다: Bulldozer와 Piledriver는 runner 전용(`mainAgent: false`)이고, Bulldozer/Piledriver Stop 검수 gate(`hooks/primary-review-gate.py`)와 `ntg-run` 역할 귀속 래퍼는 삭제되었으며, `docs/specs/vnext/` pre-activation 미러도 삭제되었습니다. 1.0.0 시점에 Excavator는 아직 Zen completion gate를 가진 유일한 네이티브 선택 가능 primary였으며, 이번 릴리스의 Excavator 강등이 이를 superseded 합니다. `docs/specs/plan-review-contract.md`(네이티브 Piledriver plan-readiness 검수)는 그것이 정의한 흐름과 함께 제거되었습니다.

### vNext 활성화 (44G, #134)

vNext가 런타임입니다. 배포된 `agents/`와 `rules/`가 vNext 계약을 담고, 러너는 `agents/`에서 역할 body를 로드하며 `ntg-vnext`가 멀티 마일스톤 진입점입니다. Steamroller는 runner 전용이고 Bulldozer와 Piledriver는 러너가 exact model과 bounded packet으로 호출합니다. 활성화 증거: `.omo/evidence/134-vnext-activation.md`.

OQ-6(#137): 작업공간 지침을 유지하기 위해 당시 네이티브 Excavator의 `inheritCustomizations: true`를 명시적으로 유지했습니다. AGY 1.3.3 통제 실험에서 true와 생략은 작업공간 규칙을 전달했고 false는 전달하지 않았습니다. 이번 Excavator 강등이 그 결정을 superseded 합니다: 네이티브로 선택 가능한 primary가 더 이상 없고 worker는 `inheritCustomizations` 필드를 갖지 않습니다. Bulldozer와 Piledriver는 runner 전용이며 해당 필드를 갖지 않습니다. Instinct는 구현되어 있습니다(#20, 위 참고).

### 적용 중인 guard와 경계

- Zen은 verification-only `run_command`와 일반적인 의도적 shell mutation 경로를 막는 marker-scoped `PreToolUse` guard(`NTG_ZEN_VERIFY=1`)를 가집니다.
- Excavator는 일반 sudo는 유지하면서 stdin-password 권한 획득, 우회 privilege 경로, shell-history credential mining, 전체 시스템 업그레이드를 막는 marker-scoped shell guard(`NTG_EXCAVATOR=1`)를 가집니다.
- Excavator는 중첩 위임이 없고 Zen을 호출하지 않습니다: worker 결과를 Bulldozer에 반환하며, 마일스톤 검증은 Steamroller의 Zen gate입니다. 네이티브 primary Zen completion gate(플러그인 `Stop` hook)는 primary와 함께 제거됩니다.
- Deterministic 커버리지: `tests/test_excavator_shell_guard.py`, `tests/test_zen_shell_guard.py`.
- Zen/Excavator shell guard는 완전한 shell 또는 privilege sandbox가 아니라 behavioral backstop입니다. AGY 런타임의 `PreToolUse` payload에는 신뢰할 수 있는 custom-agent identity가 없어, 두 guard 모두 명시적 `NTG_ZEN_VERIFY=1` / `NTG_EXCAVATOR=1` shell marker로 세션을 식별합니다.

### 라이브 검증 상태

AGY 1.3.3에서 검증 완료 (증거: `.omo/evidence/113-live-probe-results.md`, `.omo/evidence/56-activation-readiness.md`, `.omo/evidence/134-live-probe/`, `.omo/evidence/138-vnext-only-results.md`):

- 러너 end-to-end: 마일스톤별 독립 Zen GO를 가진 멀티 마일스톤 의존성 순서 실행, 관측된 중단 후 fresh-context 재개, `plan_version` 증가와 fresh current-version 재검증을 가진 material replan, 그리고 라이브 Zen NO-GO -> 수정 -> fresh GO 사이클
- specialist 위임: Bulldozer -> Jaguar / Puma / Bobcat과 중첩 Bobcat -> Strix Halo(`ACCEPT`) gate가 transcript 수준 `invoke_subagent` dispatch로 관측됨
- Bulldozer -> Excavator worker: 실제 `ntg-vnext run` 마일스톤이 `~/.cache`의 고장 난 fixture에 대한 bounded 진단+수리를 Excavator에 위임했고(Bulldozer transcript에서 `invoke_subagent` `TypeName: excavator` 관측; Excavator는 Zen을 호출하지 않고 worker 결과를 반환), Steamroller의 matching Zen GO가 마일스톤을 global completion까지 승격; 증거: `.omo/evidence/20-instinct-results.md`
- 러너 exact-model 해석: piledriver `gemini-3.1-pro-high`, bulldozer/steamroller `gemini-3.8-flash-high`, instinct `claude-sonnet-5-5-high` (명시적 escalation에서만 `claude-opus-5-5-high`)
- Instinct NEEDS_ALT: 작은 ledger에 대해 Sonnet으로 실제 `ntg-vnext alt` 호출 1회, `adopted: false`와 함께 advisory JSON 반환; 증거: `.omo/evidence/20-instinct-results.md`
- 네이티브 Excavator (강등 이전, #137): 실제 인터랙티브 NO-GO -> 수정 -> fresh GO 이후 같은 세션에서 GO 뒤 직접 write -> fresh 독립 검수 -> READY를 관측했습니다. 실제 terminal Stop 이벤트는 fresh GO 뒤 완료를 허용했습니다. Stale verdict 거부는 캡처한 post-write transcript를 별도로 재생해 확인했으며, 조기 READY 시도의 live 관측은 아닙니다. 이 경로는 네이티브 primary와 함께 제거되었습니다. 증거: `.omo/evidence/137-excavator-validation.md`.

라이브 재검증 대기:

- `multi_replace_file_content`는 현재 어떤 agent도 선언하지 않으며 라이브로 관측되지 않음 (미래 agent가 선언하지 않는 한 조치 불필요)
- `manage_task`는 라이브 도구 표면에 있으나 어떤 agent도 선언하지 않음

이름 확정:

- Bobcat advisor: **Strix Halo** (`strix-halo`)
