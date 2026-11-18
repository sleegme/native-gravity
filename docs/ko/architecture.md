# 아키텍처 (NTG 2.0)

[English](../architecture.md) · [사용법](usage.md) · [내부 동작](../internals.md)

## 설계 의도

Native Gravity 2.0(Season 2)은 정적인 headless 단일 러너 중심에서 **Antigravity 네이티브 인터랙티브 Steamroller 컨트롤 플레인** + 얇은 결정론적 **`LedgerKernel`** (`src/core/ledger-kernel.mjs`) + **`LightweightLog`** (`src/core/lightweight-log.mjs`) 구조로 진화했습니다. 사용자는 `/ntg <할 일>`로 자연어 목표나 플랜을 전달하고, 트랙 선택·내부 역할 조합·재라우팅은 Steamroller가 처리합니다.

Season 2 공식 명세는 [specs/ntg-2.0-architecture-contract.md](../specs/ntg-2.0-architecture-contract.md)이며 `feat/ntg-2.0.0`에서 기존 [specs/vnext-architecture-contract.md](../specs/vnext-architecture-contract.md)를 대체합니다.

## 하이브리드 컨트롤 플레인과 트랙 라우팅

```text
사용자 목표 (/ntg)
  -> Steamroller (Carbon Medium -> Gemini 4 Argon Medium)
       ├─ Track L (HALO_LIGHTWEIGHT)  : 직접/경량 워커 -> Fresh Bound Strix Halo (ACCEPT) [고위험 시 Zen 에스컬레이션] -> .ntg/lightweight-runs.jsonl
       ├─ Track S (ZEN_DURABLE)       : 최초 1회 승인 -> 직접/Bobcat (+ 조건부 Halo) -> 독립 Zen GO -> .ntg/ledger.json
       └─ Track M (ZEN_DURABLE)       : 최초 1회 승인 -> Bulldozer (Hydrogen XHigh) [Jaguar/Puma/Bobcat + 필수 Halo] -> 독립 Zen GO -> .ntg/ledger.json
```

- **Track L**은 저위험·소규모 변경에 불필요한 절차를 덜어내면서도 `reviewed_diff_digest`, `acceptance_criteria_digest`, `plan_version`, `evidence_basis`에 묶인 Strix Halo 검증을 강제하며, 고위험 시 Steamroller 판단으로 Zen 검수로 에스컬레이션합니다.
- **Track S / M**은 내구성 있는 `ZEN_DURABLE` 보증을 제공합니다. 정상 경로에서는 **최초 1회 평어 승인**만으로 연속 실행되며, 목표·완료 기준·불변식을 바꾸는 **Material Replan** 및 확인 게이트에서만 재승인을 요청합니다. 전략만 조정하는 **Tactical Replan**은 `plan_version`을 올리고 기존 판정을 전부 `STALE` 처리한 뒤 자율적으로 이어갑니다.

## 모델 역량(Capability)과 권한(Authority)의 분리

`ModelRouter` (`src/core/model-router.mjs`)는 동적으로 모델 슬러그를 최적화할 수 있지만 `ROLE_AUTHORITY_TABLE`의 불변 권한 경계는 절대 변경할 수 없습니다.

- **Steamroller** (`Gemini 4 Argon Medium`; `gemini-pro-orchestrator-g1-pro`는 기본 라우팅 제외): 인터랙티브 오케스트레이터 및 `LedgerKernel` 소유자.
- **Piledriver** (`Gemini 4 Argon High`, `READ_ONLY`): 마일스톤 분해·설계 자문 및 `NEEDS_DEEP` / Tactical·Material replan 제안.
- **Bulldozer** (`Gemini 4 Hydrogen XHigh`): 선택적 복합 마일스톤 조율기 겸 1차 복구 리더(은퇴한 Excavator를 Instinct와 함께 대체). `hooks/shell-safety-guard.py` 보호 아래 일반 `run_command` 권한 보유.
- **Strix Halo** (`Gemini 4 Hydrogen High`, `READ_ONLY`): Steamroller·Bulldozer·Bobcat 모두가 `ReviewRequest`로 직접 호출할 수 있는 품질 리뷰어(`ACCEPT | REVISE | ESCALATE`). 단, Track S/M에서 Zen `GO`를 대체하지 않습니다.
- **Bobcat** (`Gemini 4 Hydrogen Medium`): 핵심 코드·API·상태 로직·테스트 구현 및 로컬 검증.
- **Jaguar** (`Gemini 3.8 Flash Low`, `READ_ONLY`) 및 **Puma** (`Gemini 3.8 Flash Low`, 독립된 기계적 편집 워커): Lightweight Worker Harness 적용 대상이며, 역량을 초과할 경우 `REROUTE_REQUIRED`로 `Bobcat` 또는 `Bulldozer`로 재라우팅됩니다.
- **Instinct** (`Claude Sonnet 5.5 High` / 에스컬레이션 시 `Claude Opus 5.5 High`, `READ_ONLY`): 온디맨드 대안 프레이밍(`NEEDS_ALT`) 및 2차 복구 자문.
- **Zen** (`Claude Opus 5.5 High`, 쿼터 소진 시 `Gemini 4 Argon High` 폴백): `NTG_ACTIVE_ROLE=zen`으로 셸과 파일 수정 도구를 모두 차단하는 비수정 독립 최종 검수자.
- **Navi** (`Gemini 4 Argon Medium`): 전용 `HOME`과 `cu` MCP만 사용하는 격리된 Linux 데스크톱 leaf(`NEEDS_CONFIRMATION` 준수).

## 모델 인식 하네스, 통합 안전 가드, 관측 텔레메트리

`src/harness/`는 모델 고유의 강점을 보존하는 Layer 1 보정, 역할 지침(Layer 2), 자동 `ContextDigest` 주입(Layer 3)으로 구성됩니다. `hooks/shell-safety-guard.py`는 우회 마커나 셸 예외 없이 셸·파일 도구 양쪽을 보호하고, `hooks/telemetry-guard.py`는 횟수 기반 강제 차단 대신 관측 기록을 `.ntg/telemetry.jsonl`에 남깁니다.

구현 세부 사항은 [내부 동작](../internals.md), 검증 기록은 [상태](status.md)를 참고하세요.
