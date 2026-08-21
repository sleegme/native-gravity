# oh-my-agy

Antigravity(AGY) 위에서 돌아가는 작은 멀티 에이전트 코딩 하네스입니다.

[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) / OMO의 유용한 설계 아이디어에서 영감을 받았지만, OMO의 전체 런타임이나 에이전트 구성을 그대로 옮기지 않습니다. Antigravity의 native custom agent, subagent lifecycle, model tier, headless CLI를 우선 사용합니다.

> 현재 상태: **v0.1 / experimental**  
> 기본 구조와 라우팅은 구현되어 있지만, 실제 AGY 환경에서 전체 E2E 흐름은 아직 충분히 검증되지 않았습니다. 먼저 `oma smoke`로 설치/모델/에이전트 discovery를 확인한 뒤 사용하세요.

## 목표

OMA의 목표는 "모델 하나에게 모든 일을 시키는 것"이 아니라, AGY에서 사용할 수 있는 모델을 역할에 맞게 나누어 쓰는 것입니다.

```text
User
  │
  ▼
Claude Sonnet 4.6
Main / Orchestrator
  │
  ├─ Gemini Flash     → 빠르고 가벼운 일반 작업
  ├─ Gemini 3.1 Pro   → deep / ultrabrain / 복잡한 구현
  ├─ Explore          → 로컬 코드베이스 탐색
  └─ Librarian        → 외부 문서/OSS 조사
  │
  ▼
Implementation evidence
  │
  ▼
Claude Opus 4.6
Final review
  └─ fallback: Gemini Pro
```

핵심 원칙은 **Main은 조율하고, Worker가 구현하고, Reviewer가 판정한다**입니다.

## v0.1 예상 배치

처음부터 quota 최적화를 추측하지 않고 아래 고정 배치로 실제 사용한 뒤, Gemini / Claude quota 중 어느 쪽이 먼저 닳는지 보고 조정합니다.

| 역할 / 카테고리 | 기본 모델 | fallback / escalation |
| --- | --- | --- |
| Main / orchestration | Claude Sonnet 4.6 | Gemini 3.1 Pro |
| `quick`, `unspecified-low`, 일반 구현 | Gemini Flash | Gemini Pro |
| Explore, Librarian | Gemini Flash | 필요할 때 Gemini Pro |
| `deep`, `ultrabrain`, `visual-engineering`, `artistry`, `unspecified-high`, `architect` | Gemini Pro | Claude Opus 4.6 |
| 최종 Review | Claude Opus 4.6 | Gemini Pro |

카테고리 의미와 세부 라우팅은 [categories.md](categories.md)를 참고하세요.

## 설치

```bash
git clone https://github.com/sleegme/oh-my-agy.git
cd oh-my-agy
./scripts/install-dev.sh
oma smoke
```

`install-dev.sh`는 현재 checkout을 다음 위치에 symlink 합니다.

```text
~/.gemini/antigravity-cli/plugins/oh-my-agy
~/.local/bin/oma
```

`~/.local/bin`이 `PATH`에 없다면 쉘 설정에 추가해야 합니다.

## 기본 사용법

```bash
oma main
oma packet
oma review
oma smoke
```

실제 작은 모델 호출까지 포함한 probe는 `oma smoke --live`이며 quota를 사용합니다.

자세한 실행 흐름은 [usage.md](usage.md)를 참고하세요.

## 작업 흐름

```text
1. User request
2. Main이 task contract 작성
3. category 선택
4. Flash / Pro worker에 구현 위임
5. worker가 diff + test/build/run evidence 반환
6. review packet 생성
7. Opus 또는 Pro reviewer가 GO / NO-GO 판정
8. NO-GO면 blocker만 기존 worker session으로 되돌림
9. 수정 후 같은 gate 재검토
```

완료 판정은 단순히 worker가 "끝났다"고 말하는 것으로 하지 않습니다. 가능한 경우 실제 diff와 테스트/빌드/실행 결과가 있어야 합니다.

## 문서

- [아키텍처](architecture.md)
- [카테고리와 라우팅](categories.md)
- [사용법](usage.md)
- [현재 상태](status.md)

## 설계 원칙

- 에이전트 수를 필요 이상으로 늘리지 않습니다.
- Role / Category / Model / Reasoning을 서로 다른 개념으로 취급합니다.
- Main은 가능한 한 얇게 유지합니다.
- 구현 worker는 실제 파일을 읽고 기존 패턴을 확인한 뒤 수정합니다.
- Review는 read-only이며 blocker 중심으로 판단합니다.
- 결과에는 가능한 한 diff와 검증 evidence가 포함되어야 합니다.
- 병렬 fan-out은 독립적인 작업에서만 사용합니다.
- quota-aware routing은 실사용 burn-rate 데이터가 생기기 전까지 자동화하지 않습니다.

## Credits

이 프로젝트는 OMO / oh-my-openagent의 category routing, 작은 역할 단위의 delegation, evidence 기반 완료, review gate 같은 설계 아이디어에서 많은 영감을 받았습니다.

다만 OMA는 Antigravity-native 구조를 목표로 하며, upstream 코드나 프롬프트를 그대로 복사하는 대신 필요한 행동 원칙을 별도로 재구성하는 것을 기본 정책으로 합니다.
