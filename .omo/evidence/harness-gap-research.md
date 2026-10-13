# NTG 하네스 갭 리서치 (타 하네스 비교)

- Date: 2026-10-13
- Basis: repository `9506a14` (main)
- Status: 리서치 결과 기록. 구현·정책 결정 아님.

## 결론

NTG는 "완료를 믿을 수 있는가"(검증 무결성)에서는 조사한 어떤 하네스보다 엄격하다.
부족한 부분은 세 곳이다.

- **앞단:** 목표를 계획으로 만드는 단계
- **실행 중간:** 자동 수리 루프, 실제 변경 내용을 런너가 직접 기록하는 스냅샷
- **운영:** 모델 장애 대응, 비용 기록, 알림, 시작 경로

## 조사 대상

| 약칭 | 정체 | 핵심 성격 |
|---|---|---|
| omo | oh-my-openagent (구 oh-my-opencode) | 카테고리별 모델 배정, 훅 38개, `/goal`, Team Mode, 자체 CLI |
| omp | oh-my-pi (Pi 포크) | 내장 도구 30여 개, hashline 편집, LSP/DAP, 턴별 Advisor, TTSR |
| gjc | gajae-code | 외부 하네스. deep-interview → ralplan → ultragoal, tmux 워커, worktree, Telegram |
| 참고 | omc / omx, superpowers, GSD | 워크플로 원형 |

## NTG가 이미 앞서는 부분

- **결과물에 묶인 독립 리뷰:** Zen GO가 `result_ref`와 현재 `plan_version`에 정확히 맞아야 승격되고, replan 시 기존 판정은 STALE. (omc는 "테스트 출력이 대화에 나오면 증명"으로 취급)
- **레저 안전장치:** 단일 작성자, 락, 크래시 복구.
- **조언/채택 분리:** Piledriver·Instinct 결과는 `adopted: false`로만 기록.
- **실패 반복 감지:** NEEDS_ALT(같은 실패 클래스 3회)는 superpowers systematic-debugging의 "3회 실패 시 접근 재검토"와 같은 발상.

## 부족한 것 (우선순위순)

### P1 — 바로 손댈 것

**1. 모델 소실 대응 (#144)**
- OBSERVED: Piledriver는 `gemini-3.1-pro-high` 단일 슬러그 고정 → 현재 `ntg-vnext plan` 실패. `scripts/agy-compat-check.mjs`는 출력 덤프만 하고 판정하지 않음.
- 타 하네스: omp 역할별 `retry.fallbackChains`, omo `fallback_models` + `model-fallback`/`runtime-fallback` 훅, omo·omx·gjc `doctor`.
- 제안: "silent fallback 금지"는 유지하되 역할별 대체 체인을 **설정에 명시**하고 실제 사용 슬러그를 레저에 기록. `ntg-vnext doctor`로 `run` 전 모든 역할 슬러그·pro 티어 매핑을 사전 확인.

**2. 런너가 실제 변경을 git으로 스냅샷**
- OBSERVED: `candidate_artifact_ref`는 Bulldozer가 쓰는 문자열(`scripts/spine.mjs:511`). Bulldozer는 `commandExecutionPolicy: off`라 해시 계산 불가. `result_ref`는 그 문자열의 해시일 뿐 작업 트리와 연결되지 않음. `bounded_scope` 이탈도 기계적 검사 없음.
- 타 하네스: superpowers BASE 커밋 기록 후 diff 리뷰, GSD 작업별 원자 커밋, omp `omp commit`, gjc·omx worktree 격리.
- 제안: Bulldozer 전후 트리 해시(`git write-tree`, 임시 인덱스)를 `candidate_artifact_ref`로 사용, 변경 파일 vs `bounded_scope` 비교로 `scope_deviations` 자동 기록, Zen에 diff 전달, NO-GO 시 되돌릴 기준점 확보.

**3. 상한 있는 자동 수리 루프**
- OBSERVED: `run --all`은 첫 NO-GO에서 exit 2 (`scripts/ntg-vnext.mjs:247`). #16·#18은 탐색만 있고 미구현.
- 타 하네스: superpowers(1~3라운드 동일 구현자, 4~5라운드 강한 모델, 이후 컨트롤러 판정), omc ralph/verify, omx ultragoal, omo `/goal` + `todo-continuation-enforcer`.
- 제안: `run --all --max-repairs N`. Zen `repair_needs`를 다음 Bulldozer 패킷에 명시 필드로 투입, NEEDS_ALT 조건 충족 시 중단 후 `alt` 권고. 상한은 #16 제안(3사이클 / 60k 토큰 / 20분).

### P2 — 기능 공백

**4. 목표 → 계획**
- OBSERVED: 사용자가 `plan.json` 직접 작성. `plan`은 1회성 조언 JSON(plan.json 형식 아님), 사용자에게 되묻는 경로 없음.
- 타 하네스: deep-interview(질문 1개/라운드, 목표·제약·성공기준 가중 점수, 모호도 ≤ 0.2 종료, 최대 20라운드), ralplan(Planner → Architect → Critic, 최대 5회, ADR, 고위험 시 pre-mortem), superpowers brainstorming → writing-plans, omo plan-consultant/plan-reviewer.
- 제안: `ntg-vnext draft --goal "..."` — CLI 명확화 질문 → Piledriver가 plan.json 초안 → Critic 리뷰(#128 계획 리뷰 계약 부활) → 사람이 `init`으로 채택.

**5. 최종 통합 리뷰**
- OBSERVED: 마일스톤별 GO만으로 전체 완료. 뒤 마일스톤의 회귀를 잡을 단계 없음.
- 타 하네스: superpowers 브랜치 전체 최종 리뷰, omo `review-work`, omp `/review`(P0~P3).
- 제안: `declareGlobalCompletion` 전 BASE 이후 누적 diff로 Zen 1회 추가 (2번 전제).

**6. QA 스킬 미연결**
- OBSERVED: `skills/*.md`는 AGY 스킬 형식(`skills/<name>/SKILL.md`) 아님, `package.json` `files`에 없음, 어떤 agent/script도 참조 안 함(`rules/harness.md:138` 한 줄뿐).
- 제안: 런너가 결과물 종류별 스킬 본문을 Zen 요청에 주입하거나 SKILL.md 형식으로 패키징.

### P3 — 운영·UX

7. **비용·시간 기록:** `runner.mjs:461`이 `usage`를 받지만 spine/레저에 저장 안 함. 호출별 토큰·시간을 레저에 기록하고 `status`/`dag-view`에 표시. (참고: omc analytics, omp-stats)
8. **알림:** `run --all` 종료를 알 방법 없음. `--notify <webhook>`으로 GO/NO-GO/BLOCKED/완료 통지. (참고: gjc Telegram/Discord/Slack, omc 종료 콜백)
9. **시작 경로·배포:** npm 미배포, 전역 명령 없음, AGY 세션 내 진입 불가. `skills/ntg/SKILL.md`로 `status`/`run` 래핑(슬래시 명령화), npm 배포.

### P4 — 나중에

10. **독립 마일스톤 병렬 + worktree:** 2번 이후, 의존성 풀린 마일스톤만 병렬, Zen·병합은 직렬, 기본 off. (참고: omo Team Mode, omx team, gjc `--tmux --worktree`)
11. **워커 코드 분석 도구:** 에이전트 모두 `mcpServers: []`. Flash 편집 실패율을 먼저 측정하고, 확인되면 LSP 진단 MCP 추가. (참고: omo LSP/ast-grep, omp LSP/DAP/hashline)
12. **프로젝트 간 학습:** NO-GO `repair_needs`에서 교훈 추출 → 사람이 채택하는 규칙 파일 수준으로 한정. (참고: omo Kibitzer, omp `learn`)

## 가져오지 말 것

- 대량 훅·키워드 매직 모드 (native-first, 좁은 런너 원칙과 충돌)
- 계획 자동 채택, silent model fallback
- 멀티 프로바이더 계정 풀링, 자체 TUI (모델·세션은 AGY 소관)

## 권장 순서

1 → 2 → 3 + 7 → 5 → 4 → 6·8·9 → 10·11·12

## 조사 한계

- `antigravity.google` 문서는 조사 환경에서 DNS 차단으로 직접 확인 못 함. AGY 훅 이벤트는 PreToolUse·Stop만 확인(레포 evidence 기준), 나머지는 UNKNOWN.
- 타 하네스는 실행하지 않고 2026-10-13자 공식 README/문서만 읽음. hashline "6.7% → 68.3%"는 omp README 인용값으로 독립 검증 아님.
- NTG 사실은 `9506a14` 코드 직접 확인.

## Sources

- oh-my-openagent: https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/README.md , https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/docs/reference/features.md
- oh-my-pi: https://raw.githubusercontent.com/can1357/oh-my-pi/main/README.md
- gajae-code: https://github.com/Yeachan-Heo/gajae-code
- oh-my-claudecode: https://raw.githubusercontent.com/Yeachan-Heo/oh-my-claudecode/main/README.md (skills/deep-interview, skills/ralplan)
- oh-my-codex: https://raw.githubusercontent.com/Yeachan-Heo/oh-my-codex/main/README.md
- superpowers: https://raw.githubusercontent.com/obra/superpowers/main/skills/subagent-driven-development/SKILL.md , https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md
- GSD: https://www.mintlify.com/gsd-build/get-shit-done
- Antigravity CLI plugins (검색 요약으로만 확인): https://antigravity.google/docs/cli/plugins
