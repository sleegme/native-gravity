# Native Gravity

Native Gravity는 Google Antigravity의 네이티브 실행 구조를 유지하면서 역할별 하네스를 제공하는 소형 오케스트레이션 플러그인입니다.

> 상태: **v0.4 alpha / AGY 1.1.21 런타임 검증 완료**

## Primary 모드

```text
User
├─ Bulldozer  — 범용 Host / 오케스트레이터
├─ Piledriver — 계획 전용
└─ Excavator  — 자율 트러블슈터 / 수리 담당
```

세 Primary는 동급 진입점입니다. Piledriver와 Excavator는 Bulldozer의 하위 에이전트가 아닙니다.

## Bulldozer 내부 팀

```text
Bulldozer
├─ Bobcat       — 일반 구현 / Flash
│  └─ Strix Halo — 로컬 조언 + CHECK / Pro
├─ Puma         — quick + writing / Flash
├─ Jaguar       — 탐색 / Flash
├─ Steamroller  — 깊은 판단 / Pro
└─ Zen          — 독립 검수 / Pro
```

라우팅 기준:

- 찾기/현황 파악 -> Jaguar
- 작고 명확하고 저위험 / writing -> Puma
- 일반 구현 -> Bobcat
- 아키텍처/모호성/트레이드오프 -> Steamroller
- 독립 검수 -> Zen

v0.3.3의 Gemini 3.1 Pro 전역 mutation deny 훅은 제거했습니다. v0.4의 Excavator는 Pro-tier 자율 구현 역할이므로 직접 수정 권한이 필요합니다.

AGY 1.1.21 clean install에서 custom primary인 Bulldozer의 내부 위임과 Bulldozer -> Bobcat -> Strix Halo 중첩 gate를 실제 대화로 검증했습니다. AGY 런타임이 바뀌면 이 compatibility gate를 다시 검증해야 합니다.

## 설치

### npm

Node.js 18+와 `PATH`에서 실행 가능한 Antigravity CLI(`agy`)가 필요합니다.

배포 도우미를 전역 설치한 뒤 Native Gravity를 Antigravity에 설치할 수 있습니다.

```bash
npm install -g native-gravity
native-gravity
```

전역 설치 없이 바로 실행하려면:

```bash
npx native-gravity
```

업그레이드나 clean reinstall이 필요하면:

```bash
npx native-gravity reinstall
```

npm 진입점은 설치만 담당합니다. Antigravity 실행을 감싸는 별도 런타임이 아니라, npm 패키지에 포함된 Native Gravity 디렉터리를 `agy plugin install`에 넘기는 얇은 배포 도우미입니다.

### Git checkout

```bash
git clone https://github.com/sleegme/native-gravity.git
cd native-gravity
agy plugin uninstall native-gravity
agy plugin install .
```

업그레이드 테스트에서는 v0.3 시절 제거된 agent/hook 파일이 staging 경로에 남지 않도록 clean reinstall을 권장합니다.
