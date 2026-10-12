# 아키텍처

> vNext가 유일한 런타임입니다 (44G, [#134](https://github.com/sleegme/native-gravity/issues/134)).

Native Gravity는 Antigravity의 네이티브 라이프사이클, 세션, 워크스페이스, 모델/도구 시스템을 유지합니다. vNext는 좁은 exact-model 러너와 authoritative ledger를 더할 뿐 런타임을 대체하지 않습니다.

이 개요는 [architecture contract](../specs/vnext-architecture-contract.md)와 배포된 [agents](../../agents/) / [rules](../../rules/)를 따릅니다. `ntg-vnext`는 멀티 마일스톤 작업의 진입점이고, Excavator는 자체 Zen gate를 가진 bounded 자율 수리용으로 네이티브 선택 가능합니다.

## 감독과 마일스톤 실행

```text
User
  Steamroller — 감독 / authoritative ledger 소유자
    Piledriver — 계획, 아키텍처, 어려운 결정
    Bulldozer — 하나의 bounded 마일스톤
      Jaguar / Puma / Bobcat
                       Strix Halo — Bobcat 로컬 advisor gate
    Zen — 독립 마일스톤 검증
    Steamroller ledger transition
```

- **Steamroller**는 goal, constraints, 채택된 plan version, 마일스톤 그래프, 증거, blocker, next action, global completion을 소유합니다. authoritative ledger 상태는 혼자 작성합니다. 프로젝트 소스를 구현하지 않고 worker를 직접 오케스트레이션하지도 않습니다.
- **Piledriver**는 Steamroller를 위한 계획, 아키텍처/API 결정, 검증 전략, material replan을 제안합니다. 구현, 위임, ledger, completion 권한이 없습니다. 채택 여부는 Steamroller가 결정합니다. 실행/검수 요청도 계획 요청으로 남습니다. runner 전용이며 advisory JSON을 반환합니다.
- **Bulldozer**는 current-version 마일스톤 패킷 하나를 받아 bounded 작업을 위임하고 `DONE | BLOCKED | NEEDS_DEEP`을 반환합니다. 프로젝트 소스를 직접 수정하지 않고, shell command를 실행하지 않으며, Piledriver/Zen을 호출하지 않고, ledger를 작성하지 않습니다. 알려진 컨텍스트와 패킷에 명시된 파일은 직접 검사하지만, discovery와 미지 탐색은 Jaguar에 맡깁니다.

## Specialist 라우팅

- **Jaguar** — read-only 사실 탐색; 네이티브 Flash 역할; 위임 없음.
- **Puma** — 명시적 저위험 writing/formatting/mechanical 작업; 네이티브 Flash 역할; 위임과 advisor ceremony 없음.
- **Bobcat** — bounded 구현; 네이티브 Flash 역할; Strix Halo만 호출 가능. Bulldozer가 `ADVISOR_GATE: REQUIRED | NONE`을 선택합니다: 실질적인 code/behavior/API/state/lifecycle/test 작업은 REQUIRED, 명확히 저위험한 mechanical 작업만 NONE.
- **Strix Halo** — Bobcat 전용 read-only 로컬 gate; 네이티브 Pro 역할; `ACCEPT | REVISE | NEEDS_DEEP`. 수정은 Bobcat을 통해 이루어집니다.
- **Zen** — Steamroller를 위한 독립적 비변경 마일스톤 검증으로 Bulldozer의 child가 아니며, Excavator의 최종 완료 검수자입니다; 네이티브 Pro 역할; `GO | NO-GO`. 검증 shell command는 `NTG_ZEN_VERIFY=1`을 사용합니다.

작업 종류로 라우팅하며 크기로 하지 않습니다. 어려운 결정은
`Strix Halo -> Bobcat -> Bulldozer -> Steamroller -> optional Piledriver`를 따르며,
worker나 Bulldozer가 Piledriver를 직접 호출하지 않습니다.

## Ledger와 완료

대화 기억이 아니라 ledger가 권위를 가집니다. Steamroller는 goal, constraints, decision invariants, plan version, 마일스톤 그래프, active/completed 마일스톤, 증거, 검증, blocker, next action을 기록합니다. 한 번에 하나의 마일스톤만 실행되거나 검수를 받습니다.

Worker `READY`와 Strix `ACCEPT`는 로컬 신호입니다. Bulldozer `DONE`은 검증된 마일스톤이나 프로젝트 완료가 아니라 pre-review 후보입니다. Steamroller는 Zen 검수를 요청하기 전에 불변 후보와 고유 `result_ref`를 지속화합니다. 모든 P0 마일스톤은 `milestone_id`, 현재 `plan_version`, `result_ref`에 matching되는 독립 Zen GO를 요구합니다. 그 GO와 실제 증거를 관측한 뒤에만 마일스톤을 승격합니다. 변경된 후보는 새 reference와 검수를 요구합니다.

Material replanning은 active 실행/검수를 끝내고 `plan_version`을 증가시키며 이전 verdict를 STALE로 표시하고 active/completed 마일스톤 상태를 비웁니다. Retained 마일스톤은 의존성 순서로 fresh current-version 검수가 필요합니다; 이전 증거는 history로 남을 뿐 completion 권한이 아닙니다. Global completion은 모든 현재 마일스톤이 검증되고, blocker가 없으며, active 실행/검수가 없고, Steamroller가 증거를 직접 관측했음을 요구합니다.

Piledriver의 replanning view는 원시 ledger가 아니라 bounded tier-B 투영입니다: 어떤 artifact/lane이 실패했는지와 실패한 단계의 redacted tool args 또는 command line을 기록합니다(NTG #114). Prompt 텍스트, 역할 텍스트, 계약 조각은 planning packet에 들어가지 않습니다.

## 호출과 마이그레이션 경계

Steamroller/Bulldozer는 Gemini 3.8 Flash / High를, Piledriver는 Gemini 3.1 Pro / High를 목표로 합니다. 러너는 설치된 모델 slug를 silent fallback 없이 해석하고 effort, cwd/context, bounded prompt 구성, timeout, 재귀 보호, 구조화된 결과 수집, 실패 보고를 소유합니다. Machine 호출은 대화형 terminal 산문이 아니라 bare JSON 객체 하나를 요청합니다. Packet 파싱은 ledger 검증이나 독립 검수를 대체하지 않습니다.

Specialist는 네이티브 Flash/Pro 역할 정책을 유지합니다. Exact-model Zen은 정책 가정이 아니라 비교 라이브 증거가 필요합니다.

Excavator는 P0 밖의 별도 트러블슈팅 primary로 남습니다; recovery 재연결/최종 배치는 post-44G입니다. `NTG_EXCAVATOR=1` guard 효과를 보존합니다. Instinct/Sonnet은 미래 작업입니다.

OQ-6(`inheritCustomizations` 의미)은 Excavator로 좁혀진 PO 결정입니다(#137); 누락되거나 상속된 customization은 절대 grant로 취급하지 않습니다.
