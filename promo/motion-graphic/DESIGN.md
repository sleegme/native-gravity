# Native Gravity 홍보 모션그래픽 설계서

- **상태:** 설계 v1. 구현 전.
- **역할 분담:** 설계 Claude, 구현 Gemini 4 Argon.
- **기준 문서:** 이 파일이 구현의 기준입니다. 화면 속 주장은 모두 §2 근거표에 있는 레포 문서에서 가져옵니다.
- **함께 있는 파일:** [`plan.json`](plan.json)은 구현 마일스톤과 수용 기준입니다. `ntg-vnext`로 그대로 돌릴 수 있습니다(§12).
  [`frames/`](frames/)는 장면별 스타일프레임(1920×1080 프레임 + 아래 메모 띠)과 개요, 비주얼 시스템 보드입니다.
  오너 검토용 캔버스에서 렌더한 것이고, 프레임과 이 문서가 다르면 이 문서가 우선합니다. KO 글꼴은 프레임에서
  Noto Sans KR로 대신했지만 구현은 Pretendard를 씁니다. S02의 점선과 S06의 흐린 외곽선은 설명용 표시이며 영상에는 없습니다.

## 0. 한눈에 보기

| 항목 | 값 |
|---|---|
| 마스터 | 1920×1080, 30fps, 1470프레임(49.0초), 무음 우선. EN 마스터와 KO 버전 |
| 파생본 | 15초 숏컷(EN/KO), README용 4초 무한 루프(GIF와 MP4) |
| 핵심 메시지 | 에이전트가 "끝났다"고 해도 완료가 아니다. 독립 검수의 GO만 완료다 |
| 컨셉 | **주장은 떠다니고, 검증된 작업만 착지한다** (Claims float. Verified work lands.) |
| 마지막 태그라인 | “Done” is a verdict, not a claim. / “완료”는 주장이 아니라 판정입니다. |
| 렌더 엔진 | Remotion(React, TypeScript). 프레임 단위 결정적 렌더링 |
| 작업 위치 | 플러그인 체크아웃 바깥의 별도 저장소 `native-gravity-promo/` (§11.2) |

## 1. 목적, 대상, 메시지

**목적.** GitHub README와 소셜에서 NTG가 무엇이고 왜 쓰는지를 50초 안에, 소리 없이도 이해시켜
저장소 방문과 설치 시도로 잇습니다.

**대상.** Google Antigravity(AGY)로 여러 단계, 여러 세션에 걸친 코딩 작업을 하는 개발자.
내부 역할(Steamroller, Zen 등)은 몰라도 됩니다. README가 말하듯 내부 에이전트 선택과 조율은
제품이 할 일이고, 사용자가 배울 역할을 늘리면 안 됩니다. 영상도 내부 역할 이름을 가르치지 않습니다.

**메시지 위계.**

1. 핵심: 에이전트의 "끝났다"는 완료가 아니다. 독립 검수의 GO만 완료다.
2. 보조(장면 순서대로): 완료 기준이 있는 작은 단계로 된 플랜 → 실행 결과는 후보일 뿐 →
   독립 검수, NO-GO는 미완료로 남음 → 고친 결과는 새 GO가 필요 → ledger에 저장되고
   새 세션에서 이어감 → 플랜을 바꾸면 남긴 단계도 다시 검증.
3. 행동 유도: `github.com/sleegme/native-gravity`.

**성공 기준.** 무음으로 한 번 보고 핵심 메시지를 한 문장으로 말할 수 있어야 합니다. 30초 지점까지
NO-GO와 GO의 차이가 보여야 합니다.

## 2. 사실 가드레일

이 저장소는 근거에 비례한 주장을 요구합니다. 홍보물도 예외가 아닙니다.

### 2.1 허용된 주장과 근거

| 화면 주장 | 카피 키 | 근거 |
|---|---|---|
| 에이전트의 "done"은 완료가 아니다 | c01, c02a, c02b, c10a | `README.md` "An agent saying "done" doesn't make a step done." |
| 무엇이 정말 끝났는지 | c02b | `README.md` 첫 문단 "honest about what's actually finished" |
| Google Antigravity용 플러그인 | c03b | `README.md` 첫 문단, `plugin.json` |
| 작은 단계, 단계마다 완료 기준 | c04 | `README.md` "a plan made of small steps, each with acceptance criteria" |
| 실행 결과는 후보 | c05 | `docs/architecture.md` "bounded execution produces a candidate" |
| 독립 검수, 사용자의 기준 대비 | c06a | `README.md` "has a separate reviewer check each result", "pass an independent review against your criteria" |
| NO-GO는 미완료로 남음 | c06b | `docs/status.md` "A rejected milestone (NO-GO) stays unfinished" |
| 고친 결과는 새 GO가 필요 | c07, c07s | `docs/status.md` "until a repaired result earns a fresh GO" |
| 검증된 진행이 ledger에 저장됨 | c08a | `README.md` "saves the verified progress", "called a ledger" |
| 새 세션에서 이어감 | c08b | `docs/status.md` "Resume from the saved ledger in a fresh process" |
| 플랜을 바꾸면 남긴 단계도 재검증 | c09 | `README.md` "every step needs fresh verification, including the ones you kept" |
| 버전, 성숙도, 검증 런타임 | c10c | `README.md` 머리말 "1.1.0 · alpha · AGY 1.3.3" |

### 2.2 금지

- 속도, 품질, 신뢰성에 대한 수치나 비교("10배", "버그 없음", "항상 정확"). README는 한 호스트에서
  검증된 alpha라고만 말합니다.
- GO를 "코드가 맞다는 보증"으로 표현하는 것. GO는 사용자의 기준에 대한 독립 검수 통과일 뿐입니다.
- `npm install native-gravity`. 1.1.0은 npm에 없습니다. 설치는 저장소에서 합니다.
- 전역 `ntg-vnext` 명령처럼 보이는 표기. 화면 명령은 `node "$NTG/scripts/ntg-vnext.mjs" …` 형태만 씁니다.
- 모델 이름(Gemini, Argon, Flash, Claude 등)과 내부 역할 이름. 라우팅은 바뀔 수 있고 사용자 기능이 아닙니다.
- Google, Antigravity, Gemini의 로고, 아이콘, 브랜드 색 배열. 공식 제휴처럼 보이는 표현.
  "for Google Antigravity" 같은 호환성 텍스트 표기만 허용합니다.
- 실제 녹화 실행처럼 보이게 하는 것. 예시 플랜은 `docs/usage.md`를 바탕으로 한 설명용입니다.
  S04부터 S10까지 화면 오른쪽 위에 `Illustrative example` / `예시 시나리오` 라벨을 둡니다.
- 이모지 글리프. 헤드리스 Chromium에서 두부(□)로 깨질 수 있습니다. 아이콘은 모두 SVG로 그립니다.

카피를 바꾸면 §2.1 표도 같이 고칩니다. 근거 없는 주장은 넣지 않습니다.

## 3. 컨셉: 주장은 떠다니고, 검증된 작업만 착지한다

이름에서 출발합니다. Antigravity는 에이전트를 띄우는 환경이고, Native Gravity는 그 위에 **중력**을
더합니다. 영상의 물리 법칙이 곧 제품의 규칙입니다.

| 영상 속 물리 | 제품 의미 |
|---|---|
| 무게 없이 떠오르고 흔들리는 것 | 검증되지 않은 주장, 후보 |
| 바닥(ledger 레일)에 떨어져 멈추는 것 | 독립 검수 GO를 받은 단계 |
| 바닥 직전에서 튕겨 나가는 것 | NO-GO. 미완료로 남음 |
| 착지했던 블록이 다시 떠오름 | 플랜 변경으로 STALE. 재검증 필요 |
| 세션이 꺼졌다 켜져도 바닥은 그대로 | ledger에 저장된 진행 |

이야기는 무중력 세계에서 시작합니다. 에이전트의 "done" 말풍선이 떠올라 흘러갑니다. 타이틀에서 세계에
중력이 생기고, 그 뒤로는 검증을 통과한 것만 바닥에 내려앉습니다. Antigravity를 깎아내리지 않습니다.
S03 태그라인 "Agents get lift. Verified work gets gravity."처럼 둘을 보완 관계로 그립니다.

### 3.1 모션 불변식

마일스톤 블록은 **그 블록, 그 후보(result_ref), 현재 플랜 버전에 대한 GO가 화면에 먼저 보인 뒤에만**
착지합니다. NTG의 승격 규칙("matching GO for that candidate, milestone and plan_version")을 그대로
옮긴 것입니다. 구현은 이 규칙을 테스트로 강제합니다(§11.5). 워드마크 같은 브랜드 오브젝트는 예외입니다.

## 4. 출력 사양

| 산출물 | 컴포지션 ID | 해상도 | 프레임 | 파일 |
|---|---|---|---|---|
| 마스터 EN | `NG-Master-EN` | 1920×1080 | 1470 (49.0s) | `out/native-gravity-promo-en-1080p.mp4` |
| 마스터 KO | `NG-Master-KO` | 1920×1080 | 1470 | `out/native-gravity-promo-ko-1080p.mp4` |
| 숏 EN | `NG-Short-EN` | 1920×1080 | 450 (15.0s) | `out/native-gravity-short-en-1080p.mp4` |
| 숏 KO | `NG-Short-KO` | 1920×1080 | 450 | `out/native-gravity-short-ko-1080p.mp4` |
| README 루프 | `NG-ReadmeLoop` | 960×540 | 120 (4.0s) | `out/native-gravity-readme-loop.mp4`, `.gif` |
| 포스터 | 마스터 마지막 프레임 | 1920×1080 | 프레임 1469 | `out/poster-en.png`, `out/poster-ko.png` |
| 컴포넌트 시트(개발용) | `NG-ComponentSheet` | 1920×1080 | 1 | `out/qa/component-sheet.png` |

- 비디오: H.264, yuv420p, 30fps 고정, CRF 18, `+faststart`.
- GIF: 15fps, 가로 960, 팔레트 생성 방식, 6MB 이하, 무한 반복.
- 오디오: v1은 무음입니다. 의미는 모두 화면 텍스트와 모션으로 전달합니다. 효과음 큐는 §9.3에 있고,
  라이선스가 확인된 음원을 오너가 줄 때만 넣습니다.
- 세이프 영역: 좌우 96px, 상하 54px(5%). 텍스트와 핵심 오브젝트는 이 안에만 둡니다.

## 5. 비주얼 시스템

### 5.1 색 토큰

`src/tokens.ts`에 아래 이름 그대로 둡니다. 상태 색은 실제 DAG 뷰어(`scripts/dag-view.mjs`)의 상태
의미를 따릅니다. ACTIVE는 cyan, DONE은 green, NO-GO는 red, BLOCKED는 yellow, STALE은 magenta입니다.

| 토큰 | HEX | 쓰임 | bg0 대비 |
|---|---|---|---|
| `bg0` | `#06080C` | 우주 배경 | |
| `bg1` | `#0D1119` | 패널, 블록 바탕 | |
| `bg2` | `#141A25` | 말풍선, 리뷰 카드 | |
| `line` | `#232B3A` | 패널 테두리 | |
| `ground` | `#2B3547` | ledger 레일 기본선 | |
| `textHi` | `#EDF1F7` | 본문, 캡션 | 17.68 |
| `textLo` | `#8C95A6` | 보조 텍스트, 먼지 | 6.65 |
| `active` | `#38D3F2` | 실행 중, 에이전트 활동과 주장 | 11.23 |
| `done` | `#39D98A` | GO, DONE, 착지한 레일 | 10.94 |
| `nogo` | `#FF5C5C` | NO-GO | 6.62 |
| `stale` | `#C77DFF` | STALE | 7.45 |
| `blocked` | `#FFC542` | 예약. 이 영상에서는 쓰지 않음 | 12.71 |
| `pending` | `#4B5568` | PENDING 블록 **테두리 전용** | 2.67 |
| `reviewer` | `#F4F7FB` | 독립 리뷰 빔, 카드 머리글 | 18.65 |

모든 텍스트 색은 bg0, bg1 위에서 4.5:1 이상입니다. `pending`은 대비가 낮아 텍스트에 쓰지 않습니다.
PENDING 태그 글자는 `textLo`로 씁니다.

### 5.2 색의 법칙 (어기면 안 됨)

1. **초록은 검증만 뜻합니다.** `done`은 독립 리뷰 카드 안의 통과 체크, GO 판정, 착지한 블록과 레일에만
   씁니다. 에이전트의 "done" 주장, 진행률, 장식에는 절대 쓰지 않습니다.
2. 에이전트의 주장과 실행은 `active` cyan입니다. 말풍선 체크 아이콘도 cyan 외곽선입니다.
3. 빨강은 NO-GO 전용, 마젠타는 STALE 전용입니다.
4. 독립 리뷰는 `reviewer` 흰색입니다. 에이전트와 색을 공유하지 않는 것이 "독립"의 시각 표현입니다.
5. 네 상태색을 로고처럼 나란히 배열하지 않습니다(§2.2).

### 5.3 타이포그래피

모두 SIL OFL 폰트이며 `public/fonts/`에 woff2로 셀프 호스팅하고 라이선스 파일을 함께 둡니다.
렌더 중 네트워크로 폰트를 받지 않습니다.

| 용도 | EN | KO | 크기(1080p 기준) |
|---|---|---|---|
| 워드마크 | Space Grotesk Bold, 자간 −2% | 같은 워드마크(영문 고정) | 120px |
| 엔드 태그라인 | Space Grotesk Medium | Pretendard SemiBold | 64px / KO 60px |
| 캡션 | Inter Medium, 행간 1.25 | Pretendard Medium | 44px / KO 42px |
| 블록 제목, 카드 본문 | Inter Medium | 영문 유지 | 24px |
| 모노(터미널, 블록 id, 태그, ref) | JetBrains Mono | 영문 유지 | 22–26px |

- 최소 글자 크기는 22px입니다. 캡션은 40px 아래로 내리지 않습니다.
- 캡션은 가운데 정렬, 최대 폭 1400px, 최대 두 줄입니다. 바탕 상자 없이
  `text-shadow: 0 2px 12px rgba(0,0,0,.6)`만 씁니다.
- 캡션 강조 토큰은 정확히 일치할 때만 적용합니다. `GO`는 모노 + `done`, `NO-GO`는 모노 + `nogo`,
  `ledger`는 모노 + `textHi`입니다. 그 밖의 강조는 없습니다.
- KO 버전도 터미널, plan.json, 블록 제목, 검수 기준, ref는 영어 그대로 둡니다. 실제 파일 내용이기 때문입니다.
  말풍선, 캡션, 리뷰 카드 머리글, 예시 라벨만 현지화합니다(§8).

### 5.4 레이아웃 그리드 (1920×1080)

| 요소 | 위치 |
|---|---|
| ledger 레일(S04–S10) | y=800, x 160–1760, 2px |
| 타이틀 레일(S03) | y=640. S04 시작에서 y=800으로 내려감 |
| 블록 슬롯 중심 x | m1=560, m2=960, m3=1360. 레일에 8px 눈금 |
| 블록 크기 | 340×132, 모서리 14px. 본문이 세 줄이면 162px로, 아래변을 고정한 채 위로 늘어남 |
| 떠 있는 블록 | 아래변 y=632(레일 위 168px), 위변 y=500 |
| 착지한 블록 | 아래변 y=798 |
| 캡션 영역 | y 880–1000(S03과 S10은 예외, 장면 설명 참고) |
| 리뷰 카드(S06–S07) | x 1180–1720, y 300–560 |
| 커맨드 바(S05, S08) | x 360–1560, y 110–170 |
| HUD 플랜 칩 | 왼쪽 위 (96, 54) |
| 예시 라벨 | 오른쪽 위, 오른쪽 끝 x=1824, y=54 |

### 5.5 핵심 오브젝트

**마일스톤 블록 (주인공).** DAG 뷰어 상자(`┌ m1 ────── DONE ┐`)를 그래픽으로 옮긴 모양입니다.

- 바탕 `bg1` 92%, 테두리 2px 상태색, 모서리 14px.
- 머리줄: 왼쪽 id(JetBrains Mono SemiBold 26px, `textHi`), 오른쪽 상태 태그(JetBrains Mono Bold 22px,
  대문자, 상태색), 그 사이에 1px 가로줄(상태색 40%).
- 본문: 제목(Inter Medium 24px), 의존성 줄 `← m1`(모노 22px, `textLo`), STALE일 때만 노트 `was GO@v1`(모노 22px, `stale`).
- 상태별 모습:

| 상태 | 테두리 | 태그 글자 | 추가 효과 |
|---|---|---|---|
| PENDING | `pending` | `textLo` | 없음 |
| READY | `textHi` 60% | `textHi` | 없음 |
| ACTIVE | `active` | `active` | 바깥 글로우 0 0 24px, 불투명도 0.45↔0.8, 주기 30f |
| NO-GO | `nogo` | `nogo` | 없음 |
| DONE | `done` | `done` | 레일 구간 초록 발광 |
| STALE | `stale` 점선(10/6) | `stale` | `was GO@v1` 노트 |

**후보 태그(candidate tab).** 블록 아래 10px에 두 줄로 매달린 260×44 꼬리표입니다.
`ref-sha256-3f9a1c…` 같은 ref를 모노 22px로 씁니다. 태그 아래 10px에는 에이전트 주장 칩이 매달립니다.
주장 칩은 cyan 체크 외곽선 아이콘에 `agent: done`(모노 22px)입니다. 착지가 시작되면 태그와 칩은 블록 본문의
한 줄(`ref-sha256-9b2e47…`)로 접혀 들어가 기록으로 남습니다. NO-GO 판정이 나면 블록이 움직이기 전에 먼저
찢어져 먼지가 되어 위로 흩어집니다. 매달린 태그가 블록보다 먼저 레일에 닿는 일은 없어야 합니다.

| 블록 | 후보 ref |
|---|---|
| m1 첫 후보(NO-GO) | `ref-sha256-3f9a1c…` |
| m1 수리 후보(GO) | `ref-sha256-9b2e47…` |
| m2 | `ref-sha256-c41d08…` |
| m3 | `ref-sha256-e7a5b2…` |

**ledger 레일.** 2px `ground` 선과 은은한 글로우(0 0 12px, `textLo` 25%)입니다. 착지한 블록 아래로
폭 360px 구간이 `done`으로 빛납니다(2px, 글로우 16px 50%). S08부터 왼쪽 끝 아래에 `ledger` 라벨이 붙습니다.

**리뷰 카드와 빔.** 카드는 `bg2` 바탕, 테두리 `reviewer` 35%, 모서리 16px입니다. 머리글은 렌즈 아이콘과
`Independent review`(Inter SemiBold 26px, `reviewer`)입니다. 행은 체크박스 28px와 기준 문장(Inter 24px)이고,
아래쪽에 판정 알약이 있습니다. 빔은 폭 4px, 블록과 태그를 합친 높이의 세로 막대이며 `reviewer` 색에
0 0 18px 글로우를 줍니다. 점선 연결선(4/4, `reviewer` 40%)은 카드 왼쪽 위 (1180, 380)에서 m1 위변의
(블록 왼쪽 +250, 블록 위변)으로 긋습니다. 블록 오른쪽 가운데로 그으면 m2를 가로지르므로 이 경로를 씁니다.
연결선과 빔은 SCAN 동안만 보이고, 판정 STAMP 뒤 8f에 걸쳐 사라집니다.

**판정 알약.** 140×56, 모서리 28px, 모노 Bold 32px입니다. GO는 `done` 글자와 테두리에 `done` 12% 바탕,
NO-GO는 같은 방식으로 `nogo`입니다. 빠른 재검증용 미니 알약은 88×36, 모노 22px이며 블록 위 12px에 뜹니다.

**말풍선(S01–S02).** `bg2` 바탕, `line` 테두리, 모서리 20px, 안쪽 여백 20/28px, 왼쪽 아래 꼬리입니다.
cyan 체크 외곽선 아이콘(28px)과 문구(Inter Medium 32px)를 넣고, 위에 `agent` 라벨(모노 22px, `textLo`)을 둡니다.

**워드마크.** 왼쪽에 72×72 둥근 사각형(모서리 14px, 4px `done` 테두리)이 120px 받침선 위에 놓인 마크,
오른쪽에 `Native Gravity`(Space Grotesk Bold 120px)입니다. 마크와 글자 사이는 28px이고, 마크 왼쪽 끝부터
글자 오른쪽 끝까지를 한 그룹으로 보고 가로 가운데에 둡니다(1080p에서 그룹 폭은 약 880px로 측정됨).
마크는 "착지한 블록"이므로 초록을 쓸 수 있습니다.

**커맨드 바.** `bg1` 바탕, `line` 테두리, 모서리 12px, 모노 24px입니다. 프롬프트 `$`는 `textLo`,
커서는 12×26 `textHi` 블록입니다.

**배경.** `bg0`에 중심 (960, 420)에서 `#0B1018`로 밝아지는 방사형 그라디언트, 32px 간격 1.5px 점 격자
(`textLo` 5%), 가장자리 비네트입니다. 먼지 입자 48개(1.5–3px, 불투명도 0.08–0.22, `textLo`)는
S03 10f 전까지 위로(−0.3~−0.9 px/f), 그 뒤로 아래로(+0.2~+0.6 px/f) 움직입니다. 방향 전환은 20f 동안
부드럽게 하며, 화면 밖으로 나가면 반대편에서 다시 나옵니다. 세계에 중력이 생겼다는 것을 배경이 먼저 알립니다.

**레이어 순서(아래→위).** 배경 → 먼지 → 레일 → 그림자 → 블록과 태그 → 빔 → 카드, HUD, 커맨드 바 →
캡션 → 엔드 카드.

## 6. 모션 언어

모든 모션은 `useCurrentFrame()`에서 계산하는 순수 함수입니다(§11.4). 프레임 수는 30fps 기준이고,
이징 이름은 Remotion `Easing`에 대응합니다(`easeInQuad` = `Easing.in(Easing.quad)`,
`easeOutCubic` = `Easing.out(Easing.cubic)`, `easeInOutSine` = `Easing.inOut(Easing.sin)`).

| 프리미티브 | 길이 | 정의 |
|---|---|---|
| **FLOAT** | 반복 | y = 8·sin(2π·t/84 + φ), 회전 = 1.2°·sin(2π·t/120 + φ₂). φ는 오브젝트별 시드 난수. 그림자는 블록 폭 70%, 불투명도 0.18, 블러 16px |
| **LAND** | 30f (빠른 변형 20f) | 낙하 18f(빠름 12f): y는 `easeInQuad`로 가속. 충돌 프레임: 아래 중심 기준 scaleY 0.90, scaleX 1.06, 상태색 6f 크로스페이드, 바닥 잔물결(가로 반지름이 블록 폭 0.5→1.4배, 불투명도 0.6→0, 20f, `done` 2px), 레일 구간 발광 8f, 카메라 2px 눌림 후 6f 복귀. 안착: `spring({damping: 12, stiffness: 220, mass: 0.8})`로 스케일 1 복귀. 그림자는 폭 96%, 불투명도 0.45, 블러 6px |
| **REPEL** | 40f | 하강 14f: 레일 위 48px까지 `easeInQuad`. 접촉 f14: 레일 구간에 `nogo` 역장선 번쩍임(불투명도 0→0.9→0, 8f), 태그는 NO-GO로, 테두리는 4f 동안 `nogo`로 바뀜. 반동 f14–40: `spring({damping: 10, stiffness: 160})`로 떠 있던 자리로 돌아가며 약 20px 넘어갔다 돌아옴. 흔들림 x = 6·sin(2π·(t−14)/6)·(1−(t−14)/12), f14–26. REPEL 전에 후보 태그를 먼저 흩어 둠(TEAR) |
| **TEAR** | 16f | NO-GO 판정 직후 후보 태그와 주장 칩이 가운데에서 갈라져 `nogo` 60% 입자 24개가 되어 위로 흩어지고 사라짐 |
| **SCAN** | 30f (미니 10f) | 빔 x가 블록 왼쪽 −10에서 오른쪽 +10까지 `easeInOutSine`. n개 기준 중 i번째 행은 t = 30·(i+1)/(n+1)에 체크됨. 체크는 스케일 0.6→1 스프링 8f |
| **STAMP** | 10f | 판정 알약이 스케일 1.3→1, 불투명도 0→1, `spring({damping: 12})` |
| **STALE LIFT** | 14f | y −16px `easeOutCubic`, 테두리는 점선 `stale`, 태그는 STALE, 노트가 나타남. 레일 초록이 10f 동안 빠짐. 블록 사이 3f 엇갈림(의존성 순서) |
| **POP** | 12f | 스케일 0.85→1 `spring({damping: 14, stiffness: 200})`, 불투명도 0→1 6f |
| **TYPE-ON** | 가변 | 프레임당 3글자. 커서는 30f 주기(15f 켜짐, 15f 꺼짐) |
| **LINE REVEAL** | 줄당 3f | 줄마다 6px 올라오며 불투명도 0→1, 4f |
| **POWER OFF/ON** | 30f | 끄기: 무대 전체 scaleY 1→0.004 8f `easeInCubic`, 이어서 scaleX 1→0 4f, 검은 화면 6f. 켜기: 순서를 뒤집어 4f+8f `easeOutCubic` |
| **CAPTION** | 창 단위 | 들어올 때 12px 올라오며 페이드 8f(`easeOutCubic`), 창이 끝나기 6f 전부터 페이드 아웃 |

**모션 원칙.**

1. 검증 안 된 것은 뜨거나 떠오르고, 검증된 것은 떨어져서 머뭅니다. 세계 물리가 곧 제품 의미입니다.
2. 한 번에 주인공 모션은 하나입니다. 시선이 한 오브젝트를 따라가게 합니다.
3. LAND는 무겁고 차분합니다. 장난스럽게 튀는 것은 REPEL뿐입니다.
4. 캡션을 읽는 동안 캡션 영역을 가로지르는 모션은 없습니다.
5. 장면 전환에 일반적인 와이프나 디졸브를 쓰지 않습니다. 하나의 연속된 무대이고(§11.4), 전환은 중력,
   카메라, POWER OFF/ON처럼 이유 있는 움직임으로만 합니다.
6. 번쩍임은 초당 3회를 넘지 않고, 빨간 번쩍임은 가는 선에만 씁니다.

## 7. 스토리보드 (마스터, 1470f)

| ID | 이름 | 절대 프레임 | 길이 | 한 줄 요약 |
|---|---|---|---|---|
| S01 | Claim | 0–89 | 90 | 에이전트 말풍선 "All done!"이 떠오른다 |
| S02 | Drift | 90–254 | 165 | 말풍선들이 흘러가며 체크가 물음표로 바뀐다 |
| S03 | Gravity | 255–404 | 150 | 중력이 생기고 워드마크가 착지한다 |
| S04 | Plan | 405–554 | 150 | plan.json이 블록 두 개로 펼쳐진다 |
| S05 | Run | 555–704 | 150 | m1이 실행되고 후보 태그가 매달린다. 아직 떠 있다 |
| S06 | Review · NO-GO | 705–884 | 180 | 독립 리뷰가 훑고 NO-GO. 블록이 튕겨 나간다 |
| S07 | Repair · GO · Land | 885–1034 | 150 | 새 후보, 새 GO, 착지 |
| S08 | Ledger · Resume | 1035–1199 | 165 | 세션이 꺼졌다 켜져도 ledger는 그대로. m2 착지 |
| S09 | Replan | 1200–1319 | 120 | plan v2. m1, m2가 STALE로 떠오르고 순서대로 재착지 |
| S10 | Verdict | 1320–1469 | 150 | m3 착지, 워드마크, 태그라인, URL |

아래 프레임은 모두 **장면 내부 프레임**(장면 시작 = 0)입니다. 캡션 창은 [고정]이고, 나머지 타이밍은
±3f, 위치는 ±8px까지 조정할 수 있습니다.

### S01 Claim (90f)

- 0–12: 검은 화면에서 배경이 들어오고 먼지가 천천히 떠오릅니다.
- 10–22: 말풍선 A `All done!`이 (960, 470)에 POP. cyan 체크 외곽선, 위에 `agent` 라벨.
- 50–89: A가 FLOAT하면서 떠오르기 시작합니다. 상승 속도가 0에서 1.2px/f로 늘고 3°까지 기웁니다.
- 캡션 c01 [24–89].

### S02 Drift (165f)

- A는 계속 올라가 60f 전에 화면 위로 나갑니다.
- 말풍선 B `Tests pass`(520, 600)가 6f, C `Fixed it`(1400, 560)가 18f, D `Ready to ship`(900, 700)이
  30f에 POP합니다. 각자 1.0–1.6px/f로 떠오르며 흔들리고 ±4° 안에서 기울어집니다.
- 말풍선이 y<360을 지나면 체크 아이콘이 8f 동안 `?` 글리프(`textLo`)로 바뀝니다. 실패를 단정하지 않고
  "확인되지 않았다"만 보여 줍니다.
- 캡션 c02a [8–108], c02b [114–164].

### S03 Gravity (150f)

- 0–24: 말풍선들이 12f 안에 멈춘 뒤 아래로 끌려가고(`easeInQuad`), y=640에 닿기 전에 30f까지 먼지로 흩어집니다.
  **주장은 끝내 착지하지 못합니다.**
- 8–36: y=640 레일이 가운데에서 양옆으로 그려집니다(폭 0→1600, `easeOutCubic`).
- 10–30: 먼지 방향이 위에서 아래로 바뀝니다.
- 30–60: 워드마크가 y −160에서 떨어져 레일 위에 LAND합니다(충돌 48f).
- 52: 부제 c03b가 y=700(Inter 32px, `textLo`)에. 60: 태그라인 c03c가 y=790(캡션 스타일)에.
- 캡션 c03b [52–149], c03c [60–149]. 이 장면만 캡션 위치가 위와 같습니다.

### S04 Plan (150f)

- 0–20: 워드마크, 부제, 태그라인이 20px 올라가며 사라지고, 레일이 y=640에서 800으로 24f 동안 내려갑니다
  (`easeInOutCubic`).
- 12–24: plan 패널(x 560–1360, y 100–460, 커맨드 바 스타일)이 POP.
- 20–56: §10.1의 plan.json 11줄이 LINE REVEAL.
- 20: 오른쪽 위 예시 라벨이 페이드 인합니다. S10 카메라 틸트 전까지 남습니다.
- 60–96: m1(64f)과 m2(76f)가 패널 아래쪽에서 POP한 뒤 스프링 20f로 슬롯(560, 960)의 떠 있는 자리로 갑니다.
  둘 다 PENDING이고, 의존성이 없는 m1은 96f에 READY가 됩니다.
- 캡션 c04 [30–149].

### S05 Run (150f)

- 0–24: plan 패널이 크기 0.18로 줄며 왼쪽 위로 날아가 HUD 칩 `plan v1`이 됩니다. 이 칩은 끝까지 남습니다.
- 16–42: 커맨드 바가 위에서 내려오고 §10.2의 run 명령을 TYPE-ON합니다.
- 40: m1이 ACTIVE가 됩니다.
- 44–100: cyan 입자가 m1로 모이고 블록 본문이 은은하게 일렁입니다.
- 100–112: 후보 태그 `ref-sha256-3f9a1c…`가 스프링으로 흔들리며 내려옵니다. 108f에 `agent: done` 주장 칩이 POP.
- 112–149: 그대로 떠 있습니다. 착지하지 않았다는 것이 이 장면의 요점입니다.
- 캡션 c05 [48–149].

### S06 Review · NO-GO (180f)

- 0–10: 커맨드 바가 사라집니다.
- 0–24: 리뷰 카드가 오른쪽에서 200px 미끄러져 들어옵니다(`easeOutCubic`). 기준 두 줄은 비어 있습니다.
  `GET /health returns 200`, `Body includes a status field`.
- 12–30: 점선 연결선이 그려지고 빔이 m1 왼쪽에 나타납니다.
- 30–59: SCAN. 1행 ✓(`done`)은 40f, 2행 ✗(`nogo`)는 50f.
- 64: 카드에 NO-GO STAMP.
- 64–72: 연결선과 빔이 사라집니다.
- 64–79: 후보 태그와 주장 칩이 TEAR로 흩어집니다.
- 70–109: 태그가 없는 블록이 REPEL합니다(접촉 84f).
- 110–179: m1은 NO-GO 상태로 떠 있습니다.
- 캡션 c06a [4–98], c06b [104–179].

### S07 Repair · GO · Land (150f)

- 0–12: 카드의 체크와 판정이 8f 동안 사라지며 초기화됩니다.
- 6–30: m1이 다시 ACTIVE가 되고 cyan 수리 입자가 모입니다.
- 26–36: 새 후보 태그 `ref-sha256-9b2e47…`와 `agent: done` 칩이 붙습니다.
- 30–38: 연결선이 다시 그려집니다.
- 38–67: SCAN. 48f와 58f에 ✓ 두 개.
- 70: 카드에 GO STAMP. 70–78: 연결선과 빔이 사라집니다.
- 76–105: LAND(충돌 94f). 76–82f에 태그가 블록 안으로 접힙니다. m1은 DONE이 되고 레일 구간이 초록으로 빛납니다.
- 106: 의존 대상 m1이 착지했으므로 m2가 READY가 됩니다.
- 120–149: 리뷰 카드가 오른쪽으로 나갑니다.
- 불변식 확인: GO 70f, 착지 시작 76f. 간격 6f 이상.
- 캡션 c07 [8–140].

### S08 Ledger · Resume (165f)

- 0–16: 레일 왼쪽 아래에 `ledger` 라벨, m1 슬롯 아래에 기록 `m1 · GO · ref-sha256-9b2e47…`(모노 22px, `GO`만 초록)이 나타납니다.
- 18–48: 무대 전체가 POWER OFF/ON. 다시 켜지면 m1 DONE, 레일, HUD가 그대로입니다.
- 48–74: 커맨드 바가 §10.3의 status 명령을 TYPE-ON.
- 74–84: 출력 세 줄이 LINE REVEAL(§10.3, y 180–300).
- 84–96: READY인 m2의 테두리가 한 번 밝게 맥동해 출력의 `next_milestone`을 가리킵니다.
- 100–147: m2 빠른 진행. ACTIVE 100, 후보 태그 `ref-sha256-c41d08…` 106, 미니 SCAN 112–121, 미니 GO 122,
  빠른 LAND 128–147.
- 캡션 c08a [4–86], c08b [92–164].

### S09 Replan (120f)

- 0–8: 커맨드 바가 사라집니다.
- 0–14: HUD 칩이 rotateX로 뒤집히며 `plan v1`에서 `plan v2`가 됩니다.
- 10–24: m1(10f), m2(13f)가 STALE LIFT. 노트 `was GO@v1`.
- 16–34: m3 `Document the endpoint`(`← m1`)가 슬롯 1360에 PENDING으로 POP.
- 40–75: m1 재검증. 미니 SCAN 40–49, 미니 GO 50, 빠른 LAND 56–75. 코드는 그대로이므로 ref는 `9b2e47…`
  그대로이고, GO는 v2 기준입니다.
- 76: m1이 착지했으므로 m3가 READY가 됩니다.
- 76–111: m2 재검증. 미니 SCAN 76–85, 미니 GO 86, 빠른 LAND 92–111.
- 캡션 c09 [4–119].

### S10 Verdict (150f)

- 0–47: m3 빠른 진행. ACTIVE 0, 후보 태그 `ref-sha256-e7a5b2…` 6, 미니 SCAN 12–21, 미니 GO 22, 빠른 LAND 28–47.
  레일 세 구간이 모두 초록입니다.
- 48–72: 카메라 틸트. 무대가 아래로 260px 이동하며 불투명도 25%로 어두워지고, 초록 레일은 지평선처럼 남습니다.
  예시 라벨과 HUD도 함께 어두워집니다.
- 56–86: 워드마크가 y=520 받침선에 LAND(충돌 74f).
- 76: 태그라인 c10a가 y=640에(Space Grotesk 64px). 84: URL c10b가 y=740에(모노 32px, `textHi`).
  92: 배지 c10c가 y=800에(Inter 24px, `textLo`).
- 110–149: 정지. 마지막 프레임이 포스터입니다.
- 캡션 c10a [76–149]. c10b와 c10c는 엔드 카드라 읽기 속도 규칙에서 제외합니다(마지막 프레임이 남기 때문).

## 8. 카피 덱

`src/copy.ts`에 키 그대로 둡니다. 따옴표는 둥근 따옴표(“ ” ‘ ’)를 씁니다.

### 8.1 캡션

| 키 | EN | KO |
|---|---|---|
| c01 | An agent says “done.” | 에이전트가 “다 했어요”라고 합니다. |
| c02a | Across steps and sessions, “done” starts to drift. | 단계와 세션이 쌓일수록 “완료”는 떠다니기 시작합니다. |
| c02b | What’s actually finished? | 정말 끝난 건 무엇일까요? |
| c03a | Native Gravity | Native Gravity |
| c03b | A plugin for Google Antigravity | Google Antigravity 플러그인 |
| c03c | Agents get lift. Verified work gets gravity. | 에이전트에겐 날개를, 검증된 작업에겐 중력을. |
| c04 | Write a plan: small steps, each with acceptance criteria. | 작업을 작은 단계로 나누고, 단계마다 완료 기준을 적습니다. |
| c05 | A step runs. Its result is only a candidate. | 단계가 실행됩니다. 결과는 아직 ‘후보’일 뿐입니다. |
| c06a | Independent review: does it meet your criteria? | 독립 리뷰: 여러분이 정한 기준을 충족하나요? |
| c06b | NO-GO? It stays unfinished. | NO-GO면 미완료로 남습니다. |
| c07 | A repaired result needs a fresh GO. Only then does it land. | 고친 결과는 새 GO를 받아야 하고, 그제야 착지합니다. |
| c07s | Only a fresh GO makes it land. | 새 GO를 받아야만 착지합니다. |
| c08a | Verified progress is saved in a ledger. | 검증된 진행 상황은 ledger에 저장됩니다. |
| c08b | Pick up in a fresh session. | 새 세션에서 그대로 이어 갑니다. |
| c09 | Change the plan, and kept steps are verified again. | 계획을 바꾸면 남겨 둔 단계도 다시 검증받습니다. |
| c10a | “Done” is a verdict, not a claim. | “완료”는 주장이 아니라 판정입니다. |
| c10b | github.com/sleegme/native-gravity | github.com/sleegme/native-gravity |
| c10c | v1.1.0 · alpha · validated on AGY 1.3.3 | v1.1.0 · alpha · AGY 1.3.3에서 검증 |

### 8.2 화면 UI 문구

| 키 | EN | KO |
|---|---|---|
| ui.agent | agent | agent |
| ui.bubbleA | All done! | 다 했어요! |
| ui.bubbleB | Tests pass | 테스트 통과 |
| ui.bubbleC | Fixed it | 고쳤어요 |
| ui.bubbleD | Ready to ship | 배포 준비 완료 |
| ui.claim | agent: done | agent: done |
| ui.review | Independent review | 독립 리뷰 |
| ui.illustrative | Illustrative example | 예시 시나리오 |
| ui.ledger | ledger | ledger |

### 8.3 읽기 시간 규칙 [고정]

캡션 창 길이(초)는 `max(1.5, 글자 수 / CPS)` 이상이어야 합니다. 글자 수는 공백과 문장부호를 포함한
유니코드 코드포인트 수이고, CPS는 EN 15, KO 11입니다. 엔드 카드(c10b, c10c)만 예외입니다.
설계 단계에서 마스터와 숏의 모든 창이 이 규칙을 통과하는 것을 확인했습니다. 구현은 이 검사를 테스트로
옮깁니다(§11.5).

## 9. 파생본

### 9.1 숏 (450f, 15.0초)

| ID | 절대 프레임 | 내용(내부 프레임) | 캡션 |
|---|---|---|---|
| K1 | 0–59 | 말풍선 A가 2f에 POP, 30f부터 떠오름 | c01 [4–59] |
| K2 | 60–159 | 말풍선이 흩어지고(0–14) y=640 레일(4–28), 워드마크 LAND(8 시작, 충돌 26) | c03b [22–99] |
| K3 | 160–359 | 레일이 y=800으로(0–20), m1을 가운데 슬롯 960에 POP하고 16f에 ACTIVE, 태그 `3f9a1c…`(22–30), 미니 SCAN ✓✗(32–49, 블록 오른쪽 미니 체크), NO-GO 알약 50, TEAR 50–65, REPEL 54–93(접촉 68), 새 태그 `9b2e47…`(100–110), 미니 SCAN ✓✓(112–129), GO 알약 130, LAND 136–165(충돌 154), 예시 라벨 표시 | c06b [60–118], c07s [124–199] |
| K4 | 360–449 | 카메라 틸트(0–20), 워드마크 LAND(0 시작, 충돌 18), URL 30, 배지 38 | c10a [10–89] |

리뷰 카드와 HUD는 숏에 없습니다. K3에도 불변식이 적용됩니다(GO 130, 착지 136).

### 9.2 README 루프 (960×540, 120f)

캡션 없이 무한 반복되는 장면입니다. 1920×1080 무대를 0.5배로 축소하고 m1만 가운데(x=960)에 둡니다.

- 0–15: m1(ACTIVE)과 태그 `9b2e47…`가 FLOAT.
- 16–40: 블록 위로 빔이 지나가고 미니 체크 ✓✓.
- 42: 미니 GO.
- 48–77: LAND(충돌 66).
- 78–101: DONE으로 정지.
- 102–119: 0프레임 상태로 크로스페이드. 119f 다음 0f가 끊김 없이 이어져야 합니다.

### 9.3 효과음 큐 (선택, P2)

음원은 라이선스가 확인된 것만 씁니다. 없으면 무음으로 냅니다. 큐는 마스터 절대 프레임 기준입니다.
말풍선 POP 10, 96, 108, 120(가벼운 팝) · 타이틀 착지 303(낮은 쿵) · NO-GO 판정 769, 반발 789(짧은 버즈) ·
GO 판정 955(맑은 차임) · m1 착지 979(쿵) · POWER OFF/ON 1053–1083 · m2 착지 1175 · STALE 1210(쉬머) ·
재착지 1268, 1304 · m3 착지 1360 · 워드마크 착지 1394(가장 깊은 쿵). 음악을 쓰면 −18 LUFS 근처에 맞추고
효과음은 음악보다 6dB 위에 둡니다.

## 10. 화면 속 실제 텍스트

화면의 명령과 출력은 실제 형식을 따릅니다. 설계 단계에서 확인한 내용입니다.

### 10.1 예시 plan.json (S04, 11줄)

`docs/usage.md`의 예시를 줄인 것입니다. 기준을 두 줄로 나눴으므로 설명용 예시입니다.

```json
{
  "goal": "Add a health-check endpoint",
  "plan_version": "v1",
  "milestones": [
    { "id": "m1", "title": "Implement the endpoint",
      "acceptance_criteria": [
        "GET /health returns 200",
        "Body includes a status field" ] },
    { "id": "m2", "title": "Cover it with a test",
      "dependencies": ["m1"] } ]
}
```

v2(S09)는 `{ "id": "m3", "title": "Document the endpoint", "dependencies": ["m1"] }`를 더한 것입니다.

설계 단계에서 확인한 것(2026-10-19, 모델 호출 없음):

- OBSERVED: 이 v1 플랜은 `ntg-vnext init`, v2 플랜은 `ntg-vnext replan`을 통과했습니다(둘 다 exit 0).
- OBSERVED(합성 ledger): `scripts/ledger.mjs` API로 판정을 직접 기록한 ledger에서 m1 NO-GO 뒤
  `completed_milestones`가 비어 있었습니다. m1, m2 GO 뒤 v2로 replan하자 두 판정이 `is_stale: true`가 되었고,
  `dag-view`가 두 블록을 `STALE`과 `was GO@v1` 노트로, m3를 `PENDING`으로 그렸습니다. S06, S09의 상태 표현은
  이 결과와 같습니다. 실제 모델 실행 기록은 아닙니다.
- OBSERVED: 실제 `result_ref` 형식은 `ref-sha256-` 뒤에 16진수 64자입니다. 영상은 앞 6자만 보이고 `…`로 줄입니다.
  §5.5의 ref 값은 설명용입니다.

### 10.2 run 명령 (S05)

```text
$ node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

### 10.3 status 명령과 출력 발췌 (S08)

```text
$ node "$NTG/scripts/ntg-vnext.mjs" status --ledger .ntg/ledger.json
  …
  "completed_milestones": ["m1"],
  "next_milestone": "m2"
```

OBSERVED(합성 ledger): m1 GO만 기록한 ledger에 실제 status 명령을 실행하면 `completed_milestones`가
`["m1"]`, `next_milestone`이 `"m2"`입니다. 실제 출력은 이보다 길어서 `…` 줄로 발췌임을 드러냅니다.

## 11. 기술 설계

### 11.1 스택

- **Remotion**(React + TypeScript). 구현 시점의 최신 안정 버전을 `package.json`에 **정확한 버전으로 고정**합니다
  (`^`, `~` 금지). React 버전은 Remotion 요구사항을 따릅니다.
- **라이선스 확인 필요.** Remotion은 개인과 소규모 조직(직원 3명 이하)에는 무료이고, 그 밖에는 회사 라이선스가
  필요합니다. 오너가 remotion.dev/license에서 확인합니다. 해당되지 않으면 MIT 라이선스인 Motion Canvas로
  바꿉니다. 이 문서의 모션 정의는 엔진에 묶여 있지 않습니다.
- Node 18 이상, ffmpeg와 ffprobe(GIF 변환과 검수용).

### 11.2 작업 위치

플러그인 체크아웃 안이 아니라 형제 디렉터리의 별도 저장소 `native-gravity-promo/`에서 구현합니다.

- OBSERVED: `agy plugin install .`은 체크아웃의 스냅샷을 설치합니다(`.omo/evidence/134-vnext-activation.md`의
  "installed native snapshot"). 어떤 파일까지 복사하는지는 UNKNOWN입니다. 체크아웃 안에 수백 MB짜리
  `node_modules`가 생기면 설치본에 섞일 수 있습니다.
- OBSERVED: 루트 `package.json`은 의존성이 없는 구조이고 CI는 `npm pack --dry-run`으로 패키지 내용을 봅니다.
- 이 설계 폴더(`promo/motion-graphic/`)에는 문서만 둡니다. 구현 코드나 의존성은 넣지 않습니다.

### 11.3 디렉터리 구조

```text
native-gravity-promo/
  package.json            # 정확한 버전 고정, scripts: test, typecheck, render:all
  tsconfig.json
  remotion.config.ts
  design/DESIGN.md        # 이 파일의 읽기 전용 복사본. 고치지 않는다
  DEVIATIONS.md           # 설계와 다르게 한 곳과 이유, 근거
  QA.md                   # §13 검수 결과
  public/fonts/           # woff2와 OFL 라이선스 파일
  scripts/render-all.sh   # §11.6 전체 산출물 렌더
  src/
    index.ts              # registerRoot
    Root.tsx              # 컴포지션 6개 등록
    tokens.ts             # §5 색, 타이포, 레이아웃 상수
    copy.ts               # §8 카피 (en, ko)
    timeline.ts           # 장면 표, 스토리 이벤트, 캡션 창 (단일 기준)
    world.ts              # deriveWorld(events, frame) -> 블록 상태와 모션 입력
    motion/               # float, land, repel, scan, stamp, staleLift, pop, typeOn, power, caption
    components/           # MilestoneBlock, CandidateTab, ClaimChip, LedgerRail, ReviewerCard,
                          # ReviewerBeam, VerdictPill, ChatBubble, Wordmark, CommandBar,
                          # PlanPanel, HudChip, Caption, Background, Dust
    stage/                # Stage.tsx(연속 무대), Overlays.tsx(장면별 오버레이)
    compositions/         # Master.tsx, Short.tsx, ReadmeLoop.tsx, ComponentSheet.tsx
  tests/                  # motion, timeline, invariant, copy 테스트
  out/                    # .gitignore
```

### 11.4 아키텍처: 연속 무대와 이벤트에서 도출한 상태

장면마다 블록을 새로 마운트하지 않습니다. 블록, 레일, HUD는 **하나의 무대**에 계속 있고, 그 상태는
스토리 이벤트 목록에서 계산합니다. NTG의 ledger가 이벤트에서 상태를 만드는 방식과 같습니다.

```ts
type BlockId = 'm1' | 'm2' | 'm3';
type PlanVersion = 'v1' | 'v2';
type StoryEvent =
  | { f: number; block: BlockId; kind: 'appear' | 'ready' | 'active' }
  | { f: number; block: BlockId; kind: 'candidate'; ref: string }
  | { f: number; block: BlockId; kind: 'scan'; mini: boolean; results: ('pass' | 'fail')[] }
  | { f: number; block: BlockId; kind: 'verdict'; value: 'GO' | 'NO-GO'; ref: string; planVersion: PlanVersion }
  | { f: number; block: BlockId; kind: 'repel' }
  | { f: number; block: BlockId; kind: 'land'; fast: boolean }
  | { f: number; block: BlockId; kind: 'stale'; planVersion: PlanVersion }
  | { f: number; kind: 'plan'; planVersion: PlanVersion };
```

- `timeline.ts`는 장면 표(§7)와 장면 내부 프레임 이벤트를 갖고, 절대 프레임으로 바꿔 내보냅니다.
- `deriveWorld(events, frame)`는 블록마다 현재 상태, 마지막 이벤트, 그 이벤트 이후 경과 프레임을 돌려줍니다.
  컴포넌트는 그 값과 §6 프리미티브만으로 그립니다.
- 캡션, 커맨드 바, 리뷰 카드, plan 패널 같은 장면 전용 요소는 `<Sequence>` 오버레이로 둡니다.
- 마스터, 숏, 루프는 같은 컴포넌트와 프리미티브를 쓰고 이벤트 목록만 다릅니다.

**결정성.** `Math.random`, `Date`, CSS 애니메이션과 트랜지션을 쓰지 않습니다. 난수는 Remotion `random(seed)`을
씁니다. 폰트 로딩이 끝날 때까지 `delayRender`로 렌더를 막습니다. 같은 프레임을 두 번 렌더한 PNG는 바이트가 같아야 합니다.

### 11.5 테스트 (`npm test`)

1. **장면 표:** 0에서 시작하고, 빈틈이나 겹침이 없고, 마스터 합계가 1470, 숏이 450, 루프가 120입니다.
2. **착지 불변식 [고정]:** 모든 `land`(블록 b, 프레임 f) 앞에 같은 b의 `verdict GO`가 f−6 이하에 있어야 합니다.
   그 GO의 `ref`는 b의 마지막 `candidate` ref와 같고, `planVersion`은 f 시점의 플랜 버전과 같아야 합니다.
   그 GO와 `land` 사이에 b의 새 `candidate`, `stale`, `plan` 이벤트가 없어야 합니다.
3. **NO-GO 뒤:** `verdict NO-GO` 뒤에 b가 착지하려면 다른 ref의 새 `candidate`와 새 GO가 있어야 합니다.
4. **의존성 순서:** 블록은 의존 대상이 현재 플랜 버전에서 착지한 뒤에만 `active`가 됩니다. m2와 m3는 m1 뒤입니다.
5. **카피:** 쓰이는 모든 키에 EN, KO 문자열이 있고, 모든 캡션 창이 §8.3 규칙을 통과합니다.
6. **모션 프리미티브:** LAND 충돌 프레임에서 블록 아래변이 레일 y와 같고 scaleY가 0.90입니다. FLOAT 진폭은
   8px을 넘지 않습니다. REPEL은 레일 위 48px보다 아래로 내려가지 않습니다. SCAN 체크 프레임이 §6 식과 같습니다.
7. **색의 법칙:** 상태가 DONE이 아니거나 GO 직후가 아닌 블록, 주장 칩, 말풍선에 `done` 색이 쓰이지 않습니다
   (컴포넌트 단위 테스트 또는 렌더 함수의 색 선택 테스트).

### 11.6 렌더 명령

플래그 이름은 설치한 버전의 `npx remotion render --help`로 확인합니다.

```bash
npx remotion compositions src/index.ts
npx remotion still src/index.ts NG-Master-EN out/qa/stills/en-0060.png --frame=60
npx remotion render src/index.ts NG-Master-EN out/native-gravity-promo-en-1080p.mp4 \
  --codec=h264 --crf=18 --pixel-format=yuv420p
ffmpeg -i out/native-gravity-readme-loop.mp4 \
  -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a" \
  -loop 0 out/native-gravity-readme-loop.gif
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt \
  -show_entries format=duration -of json out/native-gravity-promo-en-1080p.mp4
```

MP4에 `faststart`가 없으면 `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`로 다시 감쌉니다.
`scripts/render-all.sh`는 §4의 모든 산출물과 §13의 검수 스틸을 한 번에 만듭니다.

## 12. 구현 마일스톤

마일스톤의 기준 목록은 [`plan.json`](plan.json)입니다. 아래는 요약입니다.

| id | 내용 | 의존 |
|---|---|---|
| p1-scaffold | 프로젝트, 토큰, 카피, 폰트, 빈 컴포지션 6개 등록 | 없음 |
| p2-motion-core | 프리미티브, timeline, deriveWorld, 테스트 1–7 | p1 |
| p3-components | 컴포넌트와 컴포넌트 시트 스틸 | p1 |
| p4-master-a | 마스터 S01–S05 | p2, p3 |
| p5-master-b | 마스터 S06–S10, EN/KO 전체 렌더 | p4 |
| p6-variants-qa | 숏, README 루프, 포스터, render-all, QA.md | p5 |

NTG로 돌릴 수도 있습니다. 작업 저장소 루트에서:

```bash
cp "$NTG/promo/motion-graphic/plan.json" plan.json
node "$NTG/scripts/ntg-vnext.mjs" init --ledger .ntg/ledger.json --plan plan.json
node "$NTG/scripts/ntg-vnext.mjs" run --ledger .ntg/ledger.json --all
```

NTG의 홍보 영상을 NTG의 독립 검수로 만드는 셈입니다. `run`은 실제 모델을 호출합니다.

## 13. 검수 기준

구현 쪽은 아래 항목을 OBSERVED 근거와 함께 `QA.md`에 남깁니다.

1. **파일 사양:** 산출물마다 ffprobe JSON. 해상도, 30/1 fps, h264, yuv420p, 길이(마스터 49.0초 ±1프레임, 숏 15.0초).
2. **검수 스틸:** 마스터 EN/KO 각각 프레임 60, 210, 380, 520, 690, 820, 1000, 1125, 1230, 1312, 1469.
   숏은 30, 120, 230, 330, 449. 한 장짜리 컨택트 시트(`out/qa/contact-en.png`, `-ko.png`)도 만듭니다.
3. **카피:** 화면 문자열이 §8과 글자 단위로 같습니다. KO 스틸에 두부(□)가 없습니다.
4. **가드레일:** §2.2 금지 항목이 하나도 없습니다(항목별 체크리스트).
5. **색의 법칙:** 프레임 60, 210, 690 스틸에서 `#39D98A`(±6) 픽셀이 0개입니다. GO 이전 장면이기 때문입니다.
6. **세이프 영역:** 모든 검수 스틸에서 텍스트가 §4 세이프 영역 안에 있습니다.
7. **결정성:** 프레임 1000을 두 번 렌더한 PNG의 SHA-256이 같습니다.
8. **루프:** README 루프의 0프레임과 119프레임 이후 이어짐이 육안으로 끊기지 않습니다(두 프레임 스틸 첨부). GIF는 6MB 이하입니다.
9. **테스트:** `npm test`와 `npx tsc --noEmit` 출력 전문.
10. **편차:** `DEVIATIONS.md`에 바꾼 값, 이유, 근거.

## 14. 오너 결정 사항 (기본값으로 진행)

| 결정 | 기본값 | 바꾸면 영향 |
|---|---|---|
| 언어 | EN 마스터 + KO 버전 | 카피가 데이터라 언어 추가는 컴포지션 등록과 §8 행 추가로 끝남 |
| 길이 | 49초 마스터 + 15초 숏 + 4초 루프 | 장면 표와 캡션 창 재검증 필요 |
| 오디오 | 무음 | §9.3 큐와 라이선스 음원 필요 |
| 내레이션 | 없음 | 내레이션 길이에 맞춰 장면 표 재설계 |
| 렌더 엔진 | Remotion(라이선스 확인 조건) | Motion Canvas로 바꿔도 §5–§10은 그대로 |
| 작업 위치 | 별도 저장소 | 이 저장소 안이면 플러그인 설치 범위부터 확인 |

## 15. 구현 규칙 (Argon에게)

- 이 문서가 기준입니다. 장면, 카피, 색 법칙, 불변식, 캡션 창은 [고정]이고 바꾸지 않습니다.
  그 밖의 수치는 §7의 허용 오차 안에서 조정할 수 있으며, 넘으면 `DEVIATIONS.md`에 적습니다.
- 장면, 카피, 기능, 스톡 영상, 외부 에셋을 새로 넣지 않습니다. 렌더 중 네트워크를 쓰지 않습니다.
- native-gravity 플러그인의 소스(`agents/`, `scripts/`, `hooks/`, `rules/` 등)는 건드리지 않습니다.
- 설계로 해결되지 않는 문제(예: 라이선스, 폰트 렌더링 불가)는 추측하지 말고 BLOCKED로 근거와 함께 돌려줍니다.
- 결과 보고는 산출물 경로, ffprobe 출력, 스틸 경로, 테스트 출력, 편차 목록을 담고, 각 진술에
  OBSERVED, INFERRED, UNKNOWN을 붙입니다. "완성했다"는 말 대신 §13 근거를 보여 줍니다.
