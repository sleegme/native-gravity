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

업그레이드 테스트 시에는 이전 v0.3 에이전트/훅 파일이 스테이징에 남지 않도록 클린 재설치를 권장합니다.

