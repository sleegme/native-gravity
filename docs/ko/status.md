# 상태

[English](../status.md) · [사용법](usage.md) · [내부 동작](../internals.md)

- **Native Gravity**: 2.0.1
- **상태**: NTG 2.0 (Season 2 on `feat/ntg-2.0.0`)
- **호환성**:
  - 호스트 `agy models` 카탈로그 확인 완료 (`gemini-4-argon-{low,medium,high}`, `gemini-4-hydrogen-{low,medium,high,xhigh}`, `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`)

버전 규칙과 라이프사이클 단계는 [Versioning Policy](../versioning.md)에 정리되어 있습니다.

## 현재 동작하는 기능 (NTG 2.0)

- **하이브리드 컨트롤 플레인과 Track L / S / M 라우팅:** `SteamrollerController` (`src/runtime/steamroller-controller.mjs`) 및 `TrackRunner` (`src/runtime/track-runner.mjs`)가 작업을 Track L(`HALO_LIGHTWEIGHT`, `src/core/lightweight-log.mjs`)과 Track S/M(`ZEN_DURABLE`, `src/core/ledger-kernel.mjs`)으로 자율 분류하며, 고위험 Track L 작업은 독립 Zen 검수로 에스컬레이션합니다.
- **역할 구성 정비 및 Excavator 영구 은퇴:** **Bulldozer** (`Gemini 4 Hydrogen XHigh`) + 온디맨드 **Instinct** (`Claude Sonnet 5.5 High` / 에스컬레이션 `Claude Opus 5.5 High`)가 은퇴한 Excavator를 대체합니다(`agents/excavator.md`, `scripts/excavator-agy.mjs`, `hooks/excavator-shell-guard.py` 완전 삭제). **Puma** (`Gemini 3.8 Flash Low`)는 기계적 편집 전용 워커로 유지되며, 한계를 초과하는 작업은 **Bobcat** (`Gemini 4 Hydrogen Medium`)이나 **Bulldozer**로 재라우팅됩니다.
- **다중 호출자 Strix Halo 및 Halo/Zen 엄격 분리:** Steamroller, Bulldozer, Bobcat이 통합 `ReviewRequest`로 `strix-halo`를 호출할 수 있으며(`ACCEPT | REVISE | ESCALATE`), `candidate_id_or_run_id`·`reviewed_diff_digest`·`acceptance_criteria_digest`·`plan_version`·`evidence_basis` 변경 시 즉시 `STALE` 처리됩니다. Track S/M에서 Halo `ACCEPT`는 Zen `GO`를 대체할 수 없습니다.
- **권한과 분리된 `ModelRouter`:** `src/core/model-router.mjs`는 `Carbon Medium -> Gemini 4 Argon Medium`(`gemini-pro-orchestrator-g1-pro` 기본 제외) 등 역량 라우팅만 수행하며 불변 역할 권한은 절대 확장하지 않습니다.
- **통합 변경 안전 가드와 관측 우선 텔레메트리:** `hooks/shell-safety-guard.py` 및 `hooks/zen-shell-guard.py`가 셸(`run_command`)과 파일 수정 도구 양쪽에서 보호 경로와 `NTG_ACTIVE_ROLE=zen` 비수정 경계를 우회 마커 없이 강제하며, `hooks/telemetry-guard.py`가 은퇴한 `hooks/budget-guard.py`를 대체합니다.
- **Tactical/Material Replan 및 1.x 호환성:** `LedgerKernel`은 Tactical/Material replan 모두에서 `plan_version`을 증가시키고 이전 판정을 `STALE` 처리하며, 소유자 토큰 락(`src/core/lock-manager.mjs`), 복구 안전 상한(`max_recovery_retries = 3`), 1.x `ledger.json`·`plan.json`·`plugin.json` 라운드트립 호환(`src/core/v1-compat.mjs`)을 보장합니다.

## 한계와 알려진 경계

- **오프라인 결정론적 테스트 vs 라이브 모델 실행:** 기본 JS/Python 스위트는 `SKIP_LIVE_TESTS=1` 환경에서 모의(mock) 검증으로 실행되며, 실제 모델 종단 간 실행에는 명시적 `NTG_LIVE_TESTS=1` 설정과 `agy` 모델 쿼터가 필요합니다.
- **Linux 크래시 복구:** PID+토큰 기반 고아 실행기 정리는 Linux `/proc` 및 Python `os.pidfd_open`에 의존합니다.

## 검증 범위

오프라인 JS + Python 스위트(`SKIP_LIVE_TESTS=1 node --test tests/*.mjs` + `python3 -m unittest discover -s tests -p 'test_*.py' -v`)가 다음을 검증합니다:

- `ModelRouter` 정책 해석, 카탈로그 세션 캐싱, 기본 오케스트레이터 제외 및 `AuthorityExpansionError` 강제 (`tests/test_model_router.mjs`, `tests/test_runner_spike.mjs`)
- `LedgerKernel`, `LightweightLog`, 토큰 기반 `lock-manager`, Halo 신선도/무효화 바인딩, Tactical/Material replan, 1.x 파일 라운드트립 호환 (`tests/test_ledger.mjs`, `tests/test_ledger_guard.mjs`, `tests/test_v1_compat_roundtrip.mjs`)
- `hooks/shell-safety-guard.py`, `hooks/zen-shell-guard.py`, `hooks/telemetry-guard.py` 및 Model-Aware Harness Layers 1–3 (`tests/test_shell_safety_guard.py`, `tests/test_zen_shell_guard.py`, `tests/test_telemetry_guard.py`, `tests/test_harness.mjs`)
- `SteamrollerController`, `TrackRunner`, `MinimalSpine`/`SteamrollerSpine`, `ntg-vnext` 런타임 및 CLI 전이 (`tests/test_spine.mjs`, `tests/test_ntg_vnext.mjs`)

## 과거 이력 기록 (1.x)

AGY 1.3.3/1.3.6 기반의 1.x 검증 이력은 `.omo/evidence/`에 보존되어 있으며, NTG 2.0에서는 Excavator 및 `hooks/budget-guard.py` 경로가 완전히 제거되었습니다.
