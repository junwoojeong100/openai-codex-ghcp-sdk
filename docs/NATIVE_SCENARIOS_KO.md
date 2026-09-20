# Codex 네이티브 검증 시나리오

[English](NATIVE_SCENARIOS.md) · [실행 방법](EXHAUSTIVE_TESTING_KO.md) · [README](../README_KO.md)

## 요청 범위와 기준

이 실행기는 옆 `../claude-code-ghcp-sdk`의 **69개 기능 × 정상·실패·상태 전이 3개** 구조를
Codex에 대응시킨 것입니다. 브리지 HTTP 테스트 24개로 이 범위를 대체하지 않습니다.
각 기능의 `siblingId`와 시나리오 ID를 유지하되 Claude 도구 이름이나 API를 Codex에 그대로 이식하지 않습니다.

| 구분 | 기준 |
|---|---|
| 필수 경로 | 실제 Codex CLI/app-server → 이 저장소 Responses bridge → GitHub Copilot SDK → 선택 모델 |
| 네이티브 버전 | Codex CLI **0.154.0**; 다른 버전은 계약 재검토 필요 |
| SDK | `@github/copilot-sdk` **1.0.14** |
| 기능·시나리오 분모 | **69개 기능 / 207개 시나리오** |
| 모델 | `src/model-map.mjs`의 정확한 7개 ID; 모델 대체 없음 |
| 전체 결과 행 | **1,449개**; 선택하지 않거나 실행하지 않은 행도 남김 |
| 기계 판독 명세 | [`scripts/native/catalog.mjs`](../scripts/native/catalog.mjs) |
| 실행기 등록 | [`scripts/native/registry.mjs`](../scripts/native/registry.mjs) |
| 출처 snapshot | [`scripts/native/sources.mjs`](../scripts/native/sources.mjs) |

**시나리오 설계 완결성, 드라이버 구현 상태, 실행기 자체 검사, 실모델 호환성은 서로 다른 결과입니다.**
옆 저장소는 읽기 전용 설계 참고일 뿐 런타임 의존성도, 재사용하는 성공 증거도 아닙니다.
기존 날짜별 실모델 검증 리포트는 별도 범위이며 이 1,449개 결과 행으로 가져오지 않습니다.

## 시나리오 계약

각 기능은 아래 세 차원을 모두 갖습니다.

- `normal`: 실제 네이티브 기능의 정상 결과를 도구 출력·파일·프로토콜로 확인합니다.
- `failure`: 잘못된 입력, 거절, 충돌 또는 미지원 경계를 실제로 유발하고 성공으로 오인하지 않습니다.
- `lifecycle`: 재호출·설정 변경·취소 후 복구·프로세스 재시작 등 상태 전이를 확인합니다.

각 시나리오는 절차, 선행 조건, 네이티브 surface, 아래 다섯 판정과 증거 파일을 정의합니다.

1. **primary / secondary**: 해당 시나리오의 두 동작 조건. 일반적인 READY 응답이나 다른 시나리오의 성공으로 대체할 수 없습니다.
2. **route**: 성공한 네이티브 턴과 bridge 요청, SDK 세션·정확한 모델·usage를 연결합니다.
3. **isolation**: 관측한 사용자 설정, fixture 밖 sentinel, 관련 없는 파일이 바뀌지 않아야 합니다. 허용된 변경은 정확한 경로와 최종 내용으로 검사합니다.
4. **cleanup**: 소유한 Codex 프로세스, SDK 세션, listener, 임시 fixture의 종료·삭제 기록이 있어야 합니다.

`native.json`, `sdk.json`, `http.json`, `diagnostics.json`, `observations.json`,
`state.json`, `processes.json`을 사례별로 저장합니다. `--verify`는 드라이버나 모델을 다시 실행하지 않고
보존한 증거를 독립 판정기에 다시 넣습니다. SHA-256과 파일 크기뿐 아니라 판정 내용도 다시 확인합니다.

## 설계와 구현 상태 조회

```bash
# 설계 검사만 수행; 모델·외부 프로세스를 시작하지 않음
npm run test:scenarios

# 전체 구현 상태. 미구현/부분 구현이 있으면 종료 코드 1
npm run test:runner:prepare

# 기능 하나의 전체 절차, 기대 결과, 증거, 구현 공백
npm run test:e2e:native-coverage -- --feature file-edit
npm run test:e2e:native-coverage -- --feature mcp-transports
```

- `ready`: 드라이버와 두 동작 판정기가 등록되어 있습니다. **실모델 통과를 의미하지 않습니다.**
- `partial`: 실행 코드가 있지만 일부 판정이 미완성입니다. 진단 실행에도 성공 시나리오로 투입하지 않습니다.
- `not-implemented`: 네이티브 드라이버가 없습니다. 환경 문제나 제품 미지원으로 바꿔 부르지 않습니다.

아래 표는 코드에서 생성됩니다. 최신 기준은 `test:runner:prepare`입니다.

<!-- BEGIN GENERATED READINESS -->
현재 **ready 39 / partial 6 / not-implemented 162**. 이 수치는 실모델 실행 결과가 아닙니다.

| 기능 ID (옆 저장소 대응) | 정상 | 실패 | 상태 전이 | 네이티브 surface |
|---|---|---|---|---|
| `cli-runtime` | `ready` | `ready` | `ready` | `codex-cli` |
| `terminal-interaction` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-pty` |
| `accessibility` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-pty` |
| `statusline` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-pty` |
| `settings` | `ready` | `ready` | `ready` | `codex-app-server` |
| `model-routing` | `ready` | `ready` | `ready` | `codex-app-server` |
| `reasoning-effort` | `ready` | `ready` | `ready` | `codex-app-server` |
| `gateway-protocol` | `ready` | `ready` | `ready` | `codex-app-server` |
| `streaming` | `ready` | `partial` | `partial` | `codex-app-server` |
| `structured-output` | `ready` † | `ready` † | `ready` † | `codex-app-server` |
| `file-read` | `ready` | `ready` | `ready` | `codex-app-server` |
| `file-search` | `ready` | `ready` | `ready` | `codex-app-server` |
| `file-edit` | `ready` | `ready` | `ready` | `codex-app-server` |
| `notebooks` | `ready` | `ready` | `ready` | `codex-app-server` |
| `shell-execution` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `code-intelligence` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `web-fetch` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `permission-modes` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `planning` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `sandboxing` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `user-input` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `project-instructions` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `auto-memory` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `skills` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `hook-lifecycle` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `hook-transports` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `plugin-lifecycle` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `plugin-distribution` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-plugin-cli` |
| `plugin-evaluations` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-transports` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-authentication` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-resources` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-tool-search` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `subagents` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `agent-continuation` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `agent-teams` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `dynamic-workflows` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `background-agents` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `local-session-messaging` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `worktrees` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-cli` |
| `task-tracking` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `monitoring-tools` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `scheduling` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `goals` | `partial` | `partial` | `partial` | `codex-app-server` |
| `session-resume` | `ready` | `ready` | `partial` | `codex-app-server` |
| `checkpoint-rewind` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `context-compaction` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `crash-recovery` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `output-styles` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `image-input` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `pdf-input` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `binary-tool-results` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `tool-choice` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `usage-context` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `prompt-cache` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `desktop-gateway` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-desktop` |
| `ci-integrations` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-cli` |
| `agent-sdk-host` | `ready` | `ready` | `ready` | `codex-app-server` |
| `external-session-storage` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `managed-local-policy` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-isolated-os-user` |
| `network-containers` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-container` |
| `launchers` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-launcher` |
| `telemetry` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `diagnostics` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `local-notifications` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-desktop-notifications` |
| `local-code-review` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `local-retention` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `auto-permission-policy` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `provider-controls` | `ready` | `ready` | `ready` | `codex-launcher` |

† 예상 결과가 `unsupported`인 경계 검사입니다. 드라이버가 준비되어도 해당 기능 지원으로 계산하지 않습니다.
<!-- END GENERATED READINESS -->

## 재현 가능한 대표 시나리오

### `file-read`: 실제 파일 읽기

- 정상: 한글·악센트 문자, CRLF, 빈 파일, 공백이 있는 경로를 만들고 Codex의 실제 셸 도구로 읽습니다. JSON 응답과 실제 명령 출력을 fixture 원본 바이트와 비교합니다.
- 실패: 없는 파일과 dangling symlink를 읽게 합니다. 실제 비정상 종료 코드와 `ENOENT`, 파일 불변을 확인합니다.
- 상태 전이: 실행기 소유 파일만 변경한 뒤 같은 thread에서 다시 읽습니다. 이전 값과 새 값을 구분하고 턴 ID가 바뀌는지 확인합니다.

### `file-edit`: 정확한 편집과 충돌

- 정상: 반복되는 줄 하나와 새 파일을 명시한 patch를 **native apply_patch**로 적용합니다. `fileChange` 이벤트와 정확한 최종 내용을 함께 검사합니다.
- 실패: 현재 내용과 맞지 않는 patch를 한 번 시도합니다. 실제 patch 오류가 남고 원래 파일이 보존되어야 합니다.
- 상태 전이: 같은 thread에서 두 번째 patch를 적용합니다. 첫 번째 단계 snapshot과 최종 snapshot을 별도로 확인합니다.

### `model-routing` / `gateway-protocol`

- 프롬프트에 없는 nonce 파일 값을 실제로 읽어야 하며 SDK 모델 ID와 네이티브 thread/provider가 일치해야 합니다.
- 잘못된 모델 또는 로컬 bridge 토큰은 명확하게 실패해야 합니다. 대체 모델이나 다른 인증 경로로 성공시키지 않습니다.
- 서로 다른 workspace/thread의 값은 섞이지 않아야 하며, 대화 지속 시 이미 완료한 도구 결과를 재실행하지 않아야 합니다.
- Codex의 `additional_tools`, leading developer 메시지, raw custom 입력 및 function 결과 ID를 원본 요청과 연결합니다.

### `structured-output`: 미지원 경계

실제 `turn/start.outputSchema` 요청을 보내 bridge의 명시적 거절과 추론 미제출을 확인합니다.
JSON 모양의 일반 텍스트를 생성하는 것으로 schema 제약 지원을 주장하지 않습니다.
경계 검사가 예상대로 동작해도 결과는 **`unsupported`**이며 기능 호환성 통과가 아닙니다.

## 아직 실행할 수 없는 영역

표에서 `partial` 또는 `not-implemented`로 표시된 MCP, 에이전트, 계획, 승인, TUI/접근성,
Desktop, 컨테이너 등의 항목은 명세만 있거나 일부 절차만 있습니다.
**이 항목들을 구현 완료로 보고하지 않으며 전체 acceptance 실행은 준비 단계에서 차단됩니다.**
CLI JSONL을 화면·접근성 증거로, 일반 셸 명령을 native Workflow/MCP/agent 실행으로 대체하지 않습니다.

새 드라이버는 다음 조건을 모두 만족해야 `ready`로 등록합니다.

1. 해당 Codex 버전에서 실제 지원되는 네이티브 명령·RPC·이벤트를 사용합니다.
2. `execute(fixture)`와 부작용 없는 동기 `evaluate(evidence, observation)`를 구현합니다.
3. 두 동작 조건을 모두 검사하고 빈 증거·잘못된 ID·조작한 출력에 실패해야 합니다.
4. 사용자 설정이나 기존 daemon을 조작하지 않으며 fixture 소유 자원만 정리합니다.
5. 오프라인 단위검사 및 가능한 경우 실제 Codex + SDK 테스트 대역 검사로 실행기 동작을 확인합니다.
6. 실모델 호출은 별도 명시적 실행으로만 수행하고 새 증거를 남깁니다.

## 범위 제한

계정·클라우드 서비스와 외부 IDE extension-host는 로컬 app-server 검사로 인증하지 않습니다.
TUI/접근성/Desktop은 카탈로그에 남으며 별도 드라이버가 필요합니다. 정확한 제외 이유는
카탈로그의 `scopeExclusions`를 따릅니다. 실행기 소유 파일과 명시적으로 관측한 설정만 검증하며
사용자 홈 전체나 모든 OS 정책의 불변을 보장한다는 뜻은 아닙니다.

공식 프로토콜 근거: [Codex App Server](https://learn.chatgpt.com/docs/app-server).
버전별 RPC 필드는 `codex app-server generate-json-schema --experimental`의 0.154.0 출력도 함께 확인했습니다.
