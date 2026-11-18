# Native Gravity (NTG)

[![XERJ Corpus Hub contributor](https://hub.xerj.org/contributors/sleegme/badge.svg)](https://hub.xerj.org/contributors/sleegme)

[English](../../README.md)

## NTG란?

Native Gravity 2.0(NTG 2.0)은 Google Antigravity(`agy`) 위에서 동작하는 하이브리드 오케스트레이션 플러그인으로, 인터랙티브 **Steamroller**와 **`LedgerKernel`** (`src/core/ledger-kernel.mjs`), **`LightweightLog`** (`src/core/lightweight-log.mjs`)를 중심으로 동작합니다.

`/ntg <할 일>`만 입력하면 Steamroller가 작업 규모와 위험도를 판단해 **Track L (`HALO_LIGHTWEIGHT`)**, **Track S (`ZEN_DURABLE`)**, **Track M (`ZEN_DURABLE`)** 중 적절한 경로를 선택하고, 직접 실행/경량 워커(`Jaguar`/`Puma`/`Bobcat`) 또는 **Bulldozer** (`Gemini 4 Hydrogen XHigh`) 위임, **Strix Halo** 품질 리뷰, **Zen** 독립 검수, 세션 밖 진행 상태 저장을 자동으로 처리합니다.

## 주요 기능

- **자율 Track L / S / M 라우팅:** 단순하고 범위가 작은 변경은 경량 경로 **Track L (`HALO_LIGHTWEIGHT`)**에서 Strix Halo 리뷰를 거쳐 빠르게 처리하고, 실질적 단일 마일스톤(Track S)과 복합 마일스톤(Track M)은 한 번의 평어 승인 후 독립 Zen 검수를 거쳐 안전하게 완료합니다.
- **독립 완료 검수와 품질 리뷰의 분리:** `NTG_ACTIVE_ROLE=zen`으로 비수정 경계가 강제되는 독립 최종 관문(Zen `GO | NO-GO`)과 다중 호출자 품질 리뷰(Strix Halo `ACCEPT | REVISE | ESCALATE`)를 엄격히 분리하며, diff나 기준이 바뀌면 기존 리뷰를 `STALE`로 무효화합니다.
- **역량(Model)과 권한(Authority)의 분리:** `ModelRouter` (`src/core/model-router.mjs`)의 동적 모델 전환은 모델 지능만 조정할 뿐 역할의 파일 수정·셸·위임·검수 권한을 절대 확장하지 않습니다. `3.8 Flash Low` 한계를 넘는 작업은 `Bobcat` 또는 `Bulldozer`로 재라우팅됩니다.
- **통합 변경 안전 가드와 관측 우선 텔레메트리:** `hooks/shell-safety-guard.py`가 `run_command`와 파일 수정 도구를 아울러 보호 경로 및 권한 상승을 차단하며, `hooks/telemetry-guard.py`는 단순 횟수 제한 대신 비진행 동일 루프만 최소 개입합니다.
- **내구성 있는 크래시 복구 및 1.x 호환성:** 소유자 토큰 기반 락, Tactical/Material replan 시 `plan_version` 증가 및 기존 판정 무효화, 1.x `.ntg/ledger.json`·`plan.json`·`plugin.json` 양방향 호환(`src/core/v1-compat.mjs`)을 제공합니다.

## 설치 방법

Node.js 18+와 Antigravity CLI(`agy`) >= 1.3.0이 필요합니다.

`curl` 및 `irm` 설치 스크립트는 GitHub에서 직접 다운로드하므로 PATH에 `npm`이나 `npx`가 없어도(Node.js 또는 Bun만 설치되어 있으면) 바로 실행할 수 있습니다.

```bash
npx --yes native-gravity
```

```bash
bunx native-gravity
```

```bash
curl -fsSL https://raw.githubusercontent.com/sleegme/native-gravity/v1.2.0/scripts/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/sleegme/native-gravity/v1.2.0/scripts/install.ps1 | iex
```

`ntg update`는 기존 설치(npm, Bun, curl, irm)를 최신 릴리스로 업그레이드하고 이전 -> 새 버전을 출력합니다.

## 사용 방법

`agy` 세션에서 다음과 같이 입력합니다:

```text
/ntg <할 일>
```

1. NTG가 작업을 Track L/S/M으로 분류하고, Track S/M일 경우 읽기 쉬운 1회 평어 요약으로 진행 여부를 확인합니다.
2. 확인 후 실행, Strix Halo 리뷰, 실패 시 복구(Bulldozer + 온디맨드 Instinct), 독립 Zen 검수가 순서대로 진행됩니다.
3. 전체 진행 흐름을 시각적으로 보고 싶다면 아래 명령어를 사용하세요:

```text
/ntg graph
```

자세한 사용법은 [docs/usage.md](../usage.md), NTG 2.0 아키텍처 개요는 [docs/architecture.md](../architecture.md), 현재 동작 상태와 검증 기록은 [docs/status.md](../status.md)에서 확인할 수 있습니다.
