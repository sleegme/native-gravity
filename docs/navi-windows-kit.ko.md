# Navi Windows 검증 키트 / Windows OmO 인계

## 현재 상태

이 브랜치는 **Windows 실측을 위한 초기 키트**다. 운영 Navi 실행부는 아직
Linux 전용이며, Windows 지원 완료나 main 병합 후보가 아니다.
Linux Navi의 모델·원장·역할 권한은 바꾸지 않는다.

Windows-MCP 연결, AGY discovery probe 대응, 제한된 도구 목록 및 직접 호출
차단을 실제 Windows에서 검증할 수 있다. 파일 공유 잠금의 원본/하드링크
경로 보호는 **가짜 데이터로만** 검사한다. 실제 OAuth 파일은 읽지 않는다.
이 결과가 녹색이어도 실제 AGY 인증·원본 토큰 보호·Navi 실행을 증명하지 않는다.

GUI 제작과 VM 구축은 범위 밖이다. 인계 후 Windows OmO가 브랜치를 소유하며,
리드는 결과를 받기 전까지 추가 편집하지 않는다. 자동 머지하지 않는다.

## 준비

- 로그인된 Windows 10/11 데스크톱, 일반 사용자 권한.
- Git, Node.js 18 이상, Windows PowerShell 5.1 또는 PowerShell 7.
- 소유자가 준비한 `windows-mcp==0.8.8`의 네이티브 실행 진입점
  `windows-mcp.exe`. 이 버전은 Python 3.14 이상이 필요하다.
  키트는 패키지 설치·업데이트·모델 호출을 자동으로 하지 않는다.
- 실제 AGY 단계는 설치·로그인된 Windows AGY와 사용 가능한 모델 쿼터가 필요하다.

Windows-MCP upstream:
`https://github.com/CursorTouch/Windows-MCP`
버전 근거: `pyproject.toml`의 0.8.8.
실측 전에 설치본 버전과 해당 소스의 일치를 기록한다.
backend의 stdio `initialize` 응답 버전만으로 패키지 버전을 단정하지 않는다.

## 1. 안전한 기본 실행

브랜치를 체크아웃한 저장소의 PowerShell에서:

```powershell
git switch feat/navi-cross-platform
git rev-parse HEAD
node --test tests/test_navi_windows_kit.mjs
powershell.exe -NoProfile -File .\scripts\navi-validation\windows-kit.ps1
```

기본 실행은 Windows 파일 공유 잠금의 10개 부정 검사(원본/별칭에 대한
쓰기·truncate·replace·delete·rename), 동일 파일 여부, 잠금 해제를 검사한다.
원본 토큰 대신 임시 fixture를 사용하고 끝나면 삭제한다.
기존 `test_navi.mjs`는 Linux 전제 테스트이므로 Windows 통과를 요구하지 않는다.
리드는 Linux에서 두 테스트 파일을 함께 실행해 회귀를 확인한다.

- exit 1: 실패.
- exit 2: PENDING 또는 UNSUPPORTED. **성공으로 바꾸지 않는다.**
- 현재 키트는 전체 Windows 지원 PASS/exit 0을 선언하지 않는다.

기본 결과 파일은 실행 디렉터리의 `navi-windows-<UTC>.json`이다.
기존 파일을 덮어쓰지 않는다. 결과에는 사용자 경로·토큰·화면 내용이 없다.

## 2. 실제 backend의 연결·도구 경계

```powershell
powershell.exe -NoProfile -File .\scripts\navi-validation\windows-kit.ps1 `
  -Backend (Get-Command windows-mcp.exe).Source
```

`cu`의 후보 stdio 경로는 `node navi-bridge.mjs --windows <exe> serve ...`다.
공개 도구와 직접 호출 양쪽을 `Snapshot`, `Screenshot`, `Click`, `Type`,
`Scroll`, `Move`, `Shortcut`, `WaitFor`로 제한한다.
PowerShell·파일·레지스트리·앱 실행·프로세스 도구는 노출하지 않는다.
서버 텔레메트리는 이 프로세스에서 끈다.

키트는 도구 schema를 결과 JSON에 남기고, PowerShell 직접 호출이 backend에
전달되기 전에 거부되는지 검사한다. 원래 backend의 모든 도구를 허용하지 않는다.
AGY 설정은 수정하지 않으며, 이 단계는 AGY나 유료 모델을 호출하지 않는다.

## 3. 화면 관찰과 테스트 입력

다른 PowerShell 창에서 전용 테스트 창을 연다:

```powershell
powershell.exe -NoProfile -STA -File .\scripts\navi-validation\scratch.ps1
```

Windows OmO는 2단계 결과의 **실제 inputSchema**를 읽고 작업한다.
Linux의 `get_app_state`/`type_text` 인자를 Windows 도구에 추측 적용하지 않는다.
단계 파일은 다음 형태의 JSON 배열이다:

```json
[
  {"name": "Snapshot", "arguments": {}}
]
```

위 빈 인자는 형식 예시다. 설치본 schema의 필수 인자를 먼저 확인한다.
관찰 뒤 식별된 scratch 창의 빈 입력칸에만 짧은 검증 문구를 입력하고 재관찰한다.
기존 창·로그인·메시지 전송·저장·삭제·설정 변경은 조작하지 않는다.
좌표만 지원한다면 요소 기반 클릭이라고 보고하지 않는다.
도구 호출 성공은 입력 결과 성공이 아니다. 입력값 재관찰로 확인한다.
첫 호출을 반복해 성공을 추측하지 않는다.

```powershell
powershell.exe -NoProfile -File .\scripts\navi-validation\windows-kit.ps1 `
  -Backend (Get-Command windows-mcp.exe).Source -Steps .\steps.json
```

단계 결과의 `RETURNED`와 `outcome_verified=false`는 의도적이다.
반환 이미지 개수는 기록하되, 화면 이미지·텍스트는 반송 JSON에 복사하지 않는다.
실제 목표와 결과가 일치하는지 Windows OmO가 별도 증거로 확인해야 한다.
scratch 창은 검증 후 사용자가 닫는다.

## 4. Windows OmO가 이어서 할 작업

다음은 아직 구현/실측 완료가 아니다. fixture나 Linux 테스트 결과로 채우지 않는다.

1. Windows AGY가 사용하는 실제 HOME/USERPROFILE/APPDATA/LOCALAPPDATA 설정·인증
   경로와 keyring fallback 유무를 확인한다. 토큰 값을 출력하지 않는다.
2. `scripts/navi.mjs`의 Linux 경로를 유지하면서 Windows 전용 backend/실행
   profile을 구현한다. private config에만 `cu`를 등록한다.
   모델 조회·등록·본 실행을 포함한 모든 Navi AGY 호출을 보호 경계 안에 둔다.
   CLI의 사전 비보호 모델 조회도 Navi에서는 제거한다.
3. 원본과 같은 파일인 별칭 + 실제 읽기 공유 핸들로 원본 토큰 데이터를 보호한다.
   writable token copy나 파일 read-only 속성으로 대체하지 않는다.
   별칭/원본 양쪽의 부정 검사를 실제 실행 중에도 재현한다.
4. Windows Job Object 등으로 자식 트리를 관리하고, timeout·취소·오류 때
   AGY/bridge/backend 종료 후 보호 해제·private profile 정리를 입증한다.
5. 실제 Navi를 통해 관찰·스크린샷·scratch 입력·재관찰을 수행한다.
   외부 효과가 필요한 요청은 효과 전에 NEEDS_CONFIRMATION으로 돌아와야 한다.
6. 다른 역할에 `cu`가 없고 원장·owner/global/workspace 설정이 그대로인지 확인한다.
7. npm 설치 형태와 공백·비ASCII 경로에서도 같은 과정을 실행한다.
   물리 GPU·물리 다중 모니터는 별도 미검증으로 남긴다.

원본 credential 보호나 private authentication이 성립하지 않으면 typed setup
failure로 멈춘다. 플래그로 보호를 우회하지 않는다. 코드를 고치면 관련 테스트도
추가하고 Linux 회귀를 확인한다. 문서·프롬프트 문구를 테스트로 고정하지 않는다.

## 반환과 소유권

Windows OmO는 기준 SHA, 설치본 버전, 실행 명령/exit code, PASS/FAIL/PENDING
표, 수정 내용, 남은 문제를 짧은 Markdown 보고서로 남긴다.
결과 JSON과 보고서 및 필요한 수정 커밋을 **같은 브랜치**에 push하고
주인에게 최종 SHA를 알려준다. 토큰·대화 DB·사용자 경로·원시 화면·원시 로그는
커밋하지 않는다. 생성된 결과에 개인정보가 없는지 직접 확인한다.
리드에게 최종 SHA가 돌아오면 Linux 재검증과 독립 게이트를 이어간다.
최종 Windows 실측·게이트 전에는 main 병합이나 Windows 지원 완료를 선언하지 않는다.
