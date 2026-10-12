# Native Gravity

Native Gravity는 Google Antigravity의 네이티브 실행 구조를 유지하면서 역할별 하네스를 제공하는 소형 오케스트레이션 플러그인입니다. 런타임은 네이티브로 유지하고, 각 모델이 자연스럽게 잘하는 역할에 에이전트 역할을 배치합니다.

> - **Native Gravity**: 1.0.0
> - **상태**: alpha
> - **호환성**:
>   - AGY 1.3.3 — validated

## vNext 런타임

vNext가 유일한 런타임입니다 ([#134](https://github.com/sleegme/native-gravity/issues/134)). `ntg-vnext` 러너가 멀티 마일스톤 작업을 수행합니다:

```text
User -> ntg-vnext
  Steamroller — 감독 / authoritative ledger 소유자
    Piledriver — 계획, 아키텍처, 어려운 결정 / Pro
    Bulldozer  — 정확히 하나의 bounded 마일스톤 / Flash
      Jaguar / Puma / Bobcat (-> Strix Halo)
    Zen        — 독립 마일스톤 검증 / Pro
```

ledger는 오직 Steamroller만 작성하며, 실제 관측된 matching Zen GO가 있을 때만 마일스톤을 승격하고 global completion을 선언합니다. 명령어는 [사용법](usage.md)을 참고하세요.

## 네이티브로 선택 가능한 primary

```text
User (agent selection)
└─ Excavator  — 자율 트러블슈터 / 수리 담당, Zen completion gate
```

Bulldozer와 Piledriver는 runner 전용 역할입니다. Bulldozer는 호출당 정확히 하나의 bounded 마일스톤을 실행하고, Piledriver는 Steamroller에 자문 계획만 반환합니다. 둘 다 네이티브로 선택할 수 없습니다.

라우팅 기준:

- 찾기/현황 파악 -> Jaguar
- 작고 명확하고 저위험 / writing -> Puma
- 일반 구현 -> Bobcat (-> Strix Halo)
- 아키텍처/모호성/트레이드오프 -> Piledriver (runner에서는 Steamroller 경유)
- 독립 검수 -> Zen

각 모델이 자연스럽게 잘하는 역할에 역할을 맞추고, 특정 역할/모델 조합이 실제로 실패할 때만 보정을 추가합니다. Excavator는 의도적으로 수정하는 역할이므로 model-wide mutation deny는 없습니다.

## Native-first 경계

Native Gravity는 런타임을 대체하지 않습니다. npm 진입점은 설치 전용입니다: 패키징된 플러그인 디렉터리를 찾아 `agy plugin install`에 설치를 위임합니다. Antigravity 런타임 실행을 가로채거나 감싸지 않습니다. primary/subagent 실행, 라이프사이클, 세션, 워크스페이스, 모델 해석, 도구 권한은 Antigravity가 소유합니다. Native Gravity는 역할 계약, 라우팅 정책, 모델 적응형 행동 지침을 제공하며 Antigravity 런타임 동작을 대체하지 않습니다. vNext 러너(`ntg-vnext`)는 `agy` 위의 좁은 exact-model 코디네이터로, authoritative ledger, 마일스톤 순서, 독립 Zen gate만 소유합니다. 일반 워크플로 플랫폼이 아닙니다.

## Ledger 소유권

멀티 마일스톤 작업에서 `ntg-vnext`는 `MinimalSpine`을 통해 세션 수명 동안 배타적 `ledger.json.lock`을 보유합니다. spine은 ledger를 생성하거나 로드하기 전에 lock을 획득하고 `close()` 또는 프로세스 종료까지 보유합니다. 다른 인스턴스에서 재개하기 전에 이전 spine을 닫아야 합니다. 닫힌 spine은 상태를 변경할 수 없고, 사용 중인 spine은 닫을 수 없습니다.

lock은 `openSync(..., 'wx')`(배타적 생성)로 만들어지며 소유자의 10진 PID와 개행이 들어 있습니다. 기존 lock이 있으면 PID가 죽은 것처럼 보이거나 내용이 비어 있어도 항상 `LEDGER_LOCKED`로 시작을 거부합니다. 정상 종료, SIGINT, SIGTERM은 소유권을 해제합니다. SIGKILL, 크래시, 머신 종료는 stale lock을 남길 수 있습니다: `ntg-vnext recover`는 기록된 소유자 PID가 더 이상 살아 있지 않고 그 소유자의 고아 executor가 종료된 것을 확인한 뒤에만 stale lock을 제거합니다 — 살아 있는 소유자의 lock을 제거하지 마세요. lock 복구는 중단된 ledger 마일스톤을 해결하지 않습니다: 재개에는 여전히 관측된 중단 증거가 필요합니다. 모든 writer는 동일한 ledger 경로와 소유권 프로토콜을 사용해야 하며, 하위 수준의 `AuthoritativeLedger.load()` / `save()`는 지속화 원시 연산일 뿐 독립적인 세션 소유자가 아닙니다.

## Google AI Studio lane

`scripts/studio-runner.mjs`는 A/B 비교를 위한 두 번째 실행 프로파일입니다: 동일한 역할 + 패킷이 bounded prompt 계약을 거친 뒤 `agy` 대신 직접 `generateContent` REST 호출로 전달됩니다.

```js
import { invokeStudio } from './scripts/studio-runner.mjs';
const result = await invokeStudio('steamroller', packet, {
  model: 'gemini-3.1-pro-high',
  generationConfig: { temperature: 0.2 },
});
```

환경 변수 `GOOGLE_AI_STUDIO_API_KEY`(또는 `GOOGLE_API_KEY`)를 설정하세요 — 키는 요청 URL에서 Google로만 전달되며 결과, 오류, ledger 상태에 기록되지 않습니다. 결과는 `provider: 'google-ai-studio'`, 모델 id, 토큰 `usage`를 담아 model + provider + settings로 귀속을 유지합니다. 이 lane에는 도구, subagent, ledger 권한이 없습니다. "이게 모델입니까 하네스입니까?"에 답할 뿐, 오케스트레이션을 실행하지 않습니다.

## Alpha 호환성 gate

예전 Native Gravity 테스트에서 Antigravity Default 에이전트는 성공하는데 custom primary는 subagent 호출에 실패한 사례가 있었습니다. AGY 1.3.3에서 clean install은 러너의 end-to-end 마일스톤 흐름(Steamroller -> Piledriver -> Bulldozer -> Zen)과 specialist 위임(Bulldozer -> Jaguar / Puma / Bobcat, 중첩 Bobcat -> Strix Halo gate 포함)을 라이브 프로브 세션에서 검증합니다. AGY 런타임이 바뀌면 이 호환성 gate를 다시 검증해야 합니다. 자세한 버전 정책 및 호환성 매트릭스는 [Versioning Policy](../versioning.md)를 참고하세요.

## 설치

### npm

Node.js 18+ 및 `PATH`에 Antigravity CLI(`agy`)가 필요합니다.

```bash
npm install -g native-gravity
native-gravity
```

전역 설치 없이 직접 실행:

```bash
npx native-gravity
```

업그레이드/재설치:

```bash
npx native-gravity reinstall
# 또는
npx native-gravity update
```

npm 패키지는 패키징된 디렉터리를 찾아 `agy plugin install`을 호출하는 배포 도우미일 뿐이며 실행 래퍼가 아닙니다.

### Git checkout

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity
agy plugin install .
```

업그레이드 테스트 시에는 제거된 legacy agent/hook 파일이 설치 디렉터리에 남지 않도록 clean reinstall을 권장합니다.
