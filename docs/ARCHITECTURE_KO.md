# 구조

[English](ARCHITECTURE.md) · [빠른 시작](../README_KO.md) · [사용법](USAGE_KO.md) · [호환성](COMPATIBILITY_KO.md)

구현 참조 문서입니다. 실행·설정·재시작 방법은 [사용 안내](USAGE_KO.md)를 참고하세요.

**바로가기:** [소스 지도](#모듈) · [도구 실행 주체](#도구-호출-왕복) · [대화 상태](#대화-연속성) · [제한 시간과 복구](#모델-진행과-복구) · [데이터 보관](#데이터-보관).

### 이 문서의 용어

| 용어 | 의미 |
| --- | --- |
| SDK 세션 | bridge가 만들고 소유하는 Copilot SDK 대화 하나. |
| 대화 family | Codex 대화 하나에 속하는 모든 요청. Codex의 session·thread 헤더, 알려진 응답 ID, 살아 있는 도구 호출로 식별하며 대기열 하나와 상태 하나를 공유합니다. |
| 대기 호출(pending call) | 모델이 요청했지만 Codex가 아직 결과를 돌려주지 않은 도구 호출. |
| 핸드오프(handoff) | 완료된 도구 결과를 SDK에 넘기거나, 대화를 유지한 채 SDK 세션을 교체하는 것. |
| 루트·하위 이벤트 | 주 대화의 이벤트와, 그 안의 보조 agent·리뷰에서 나온 이벤트. 응답은 루트 이벤트로만 구성합니다. |
| client generation | 시작된 SDK client 하나. 연결 복구는 항상 새 generation을 시작합니다. |
| SDK 대역 | 오프라인 검사에서 Copilot SDK 대신 쓰는 로컬 구현. |

## 요청 경로

```text
Codex CLI — 승인·샌드박스·도구 실행 담당
  → 루프백의 인증된 HTTP/SSE: POST /v1/responses
  → request-policy.mjs: 텍스트 입력 및 function/custom 도구 정규화
  → session-manager.mjs: 대화 식별, SDK 이벤트, 대기 중 도구 호출 관리
  → GitHub Copilot SDK 1.0.14 — 기존 Copilot 인증 사용
  → 명시적으로 선택한 Copilot 모델
```

이 프로젝트는 프로토콜 변환기입니다. Codex 대신 Copilot이 도구를 실행하게 하거나 OpenAI/Anthropic API를 직접 호출하지 않습니다. 모델 추론은 GitHub Copilot으로 전송됩니다. bridge가 로컬에서 실행된다는 것은 추론도 로컬에서 수행된다는 뜻이 아닙니다.

## 모듈

| 소스 | 역할 |
| --- | --- |
| [server.mjs](../src/server.mjs) | 루프백 HTTP, 로컬 토큰 인증, 요청 상한, JSON/SSE, 연결 중단 처리. |
| [request-policy.mjs](../src/request-policy.mjs) | 요청 검증, `additional_tools`, namespace, SDK 도구 이름 매핑. |
| [responses.mjs](../src/responses.mjs) | 응답 항목·이벤트 생성. `call_id`, namespace, custom 입력 원문 보존. |
| [session-manager.mjs](../src/session-manager.mjs) | 대화 식별, 이력, 재시도, 대기 결과, 제한 시간·정리. |
| [request-queue.mjs](../src/request-queue.mjs) | 대화별 취소 가능한 FIFO와 대기열 상한·전체 요청 제한. |
| [sdk-lifecycle.mjs](../src/sdk-lifecycle.mjs) | SDK 준비 상태·연결 복구. 무응답 턴 복구와는 별개. |
| [copilot-session-rpc.mjs](../src/copilot-session-rpc.mjs) | 제한 시간이 있는 abort/disconnect/delete·대기 도구 결과 RPC. |
| [mcp-isolation.mjs](../src/mcp-isolation.mjs) | Copilot 사용자·plugin MCP 이름 조회, 모든 bridge 세션에 `disabledMcpServers` 전달. |
| [model-map.mjs](../src/model-map.mjs) | 허용 ID, 기본 모델, Codex 목록, SDK 기반 문맥·추론 수준 한도. 자동 대체 없음. |
| [copilot-home.mjs](../src/copilot-home.mjs), [list-models.mjs](../src/list-models.mjs) | 기존 Copilot 홈 경로 해석과 계정별 모델 조회. |
| [launcher.mjs](../src/launcher.mjs), [bridge-daemon.mjs](../src/bridge-daemon.mjs), [bin/](../bin/) | 소유 bridge 수명주기, 프로세스별 Codex 설정, 비공개 모델 목록, 선택적 상주 실행. |

임시 목록은 피커의 내장·캐시 목록을 대체하며 Codex 종료 시 삭제합니다. 항목에 `apply_patch_tool_type: "freeform"`을 선언하므로 Codex가 기본 `apply_patch` 도구를 제공합니다.

### 검증 하네스

아래는 테스트 진입점이며 별도로 띄워야 하는 운영 서비스가 아닙니다.

- [터미널 러너](../scripts/terminal.mjs)·[공유 터미널 lane](../scripts/soak/terminal-lane.mjs): 동결 소스 worker, 격리 환경, SDK 응답 대조를 사용합니다. soak worker도 이 lane을 재사용합니다. [터미널·내구성 검사](SOAK_TESTING_KO.md)를 참고하세요.
- [TUI 러너](../scripts/tui.mjs)·[구현](../scripts/tui/): [TUI 케이스](TUI_SCENARIOS_KO.md)마다 전용 PTY와 headless Playwright/xterm.js로 실행기를 구동합니다. 런타임 MCP 프로세스·Codex rollout을 관측하고 저장한 fact에서 검사를 다시 계산합니다.
- [PTY 수명주기](../scripts/soak/terminal.mjs)·[브라우저 드라이버](../scripts/soak/browser.mjs): 실제 PTY 하나에 독립 파서 또는 Playwright/xterm 표시기를 연결합니다. 취소 시 터미널 그룹과 소유 브라우저를 함께 정리합니다.

## 도구 호출 왕복

1. Codex가 function 또는 custom/freeform 도구를 선언합니다. `additional_tools` 입력 안의 중첩 선언도 처리합니다.
2. bridge는 **실행 처리 함수가 없는** SDK 도구를 등록하고 `custom:<name>` 항목만 노출합니다.
3. SDK assistant 메시지에서 호출을 받고, `external_tool.requested`에서 해당 호출의 대기 `requestId`를 확보합니다.
4. HTTP 응답으로 `function_call` 또는 `custom_tool_call`을 Codex에 전달합니다. bridge는 도구를 실행하지 않습니다.
5. Codex가 자신의 승인·샌드박스 정책에 따라 실행하고, 다음 Responses 요청으로 결과를 보냅니다.
6. bridge가 `session.rpc.tools.handlePendingToolCall({requestId, result})`로 결과를 제출하고 이어지는 모델 응답을 전달합니다.

- **SDK 도구 격리:** SDK 내장 도구와 tool search는 활성화하지 않습니다. Copilot 런타임 자체의 사용자·plugin MCP 서버는 세션 생성 시 비활성화하여 시작을 막습니다. 이어서 제한 시간이 있는 `session.mcp.list` 점검으로 스캔하지 않은 출처에서 뜬 서버를 중지하고 이후 세션에서 비활성화합니다. Codex 자체 MCP 도구는 Codex가 실행하고 다른 도구처럼 선언하므로 그대로 동작합니다.
- **인자 형식:** function 도구는 JSON 인자를 사용합니다. custom 도구는 필수 `input` 문자열 하나를 가진 객체로 SDK에 전달하며, 이 문자열은 줄바꿈 변경이나 추가 JSON 인코딩 없이 `custom_tool_call.input`이 됩니다. grammar가 제공되면 모델 설명에 포함하지만, **SDK가 grammar 기반 출력을 강제하지는 않습니다.**
- **결과 배치:** 한 턴의 모든 대기 결과를 함께 제출해야 합니다. 알 수 없는 ID, 중복 ID, 잘못된 결과 종류, 일부만 포함한 결과는 SDK 제출 전에 거절합니다.
- **권한:** 예상하지 않은 SDK 권한 요청은 거절합니다. handler 없는 bridge 도구의 `skipPermission`은 SDK의 중복 확인만 피하며, Codex 도구 실행을 승인하는 옵션이 아닙니다.

## 대화 연속성

- Codex의 `session-id`/`thread-id` 헤더로 대화를 구분합니다. 헤더가 없으면 유효한 `previous_response_id` 또는 진행 중 도구 ID로 연결하며, 그것도 없으면 새 대화를 만듭니다.
- 같은 대화의 요청은 직렬화합니다. 서로 다른 대화는 SDK 세션도 분리합니다.
- 전체 이력 요청은 정규화된 prefix를 비교해 처리한 내용을 다시 보내지 않습니다. wire 전용 ID/status는 제외하지만 assistant `phase`와 custom 입력 문자열은 보존·비교합니다. 과거 phase가 생략되면 기존 값을 유지하고, 명시적으로 바뀌면 이력 변경으로 처리합니다.
- `previous_response_id`는 현재 프로세스 안에서의 후속 연결만 제공합니다. 영구 Responses 저장소가 아니며 최신 대화 버전만 이어갈 수 있습니다.
- 가장 최근 정규화 요청의 동일한 재시도는 캐시를 반환하므로 프롬프트·도구 결과를 중복 제출하지 않습니다.
- 대기 호출이 없고 전체 이력이 기존 세션과 맞지 않으면 새 SDK 세션을 만들 수 있습니다. 결과 대기 중의 설정 변경은 아래 핸드오프 절차를 사용합니다.

### 완료된 도구 결과와 함께 설정 바꾸기

**완료 결과 핸드오프**는 Codex가 모든 대기 결과와 변경된 설정을 함께 보낼 때 SDK 세션을 교체하는 절차입니다. 전체 이력, `previous_response_id`, 호출 ID로 연결하는 결과 전용 요청을 지원합니다. 모델·문맥 등급·도구·신뢰된 최상위 지시문을 함께 바꿀 수 있습니다.

1. 대기 호출마다 정확히 한 번 포함된 일치하는 결과를 확인합니다. 기존 사용자·assistant 내용, phase, 호출 ID·인자, 과거 결과도 일치해야 합니다. 잘못된 결과 배치는 **원래 세션을 제거하기 전에** 거절합니다.
2. 이전 세션의 abort·disconnect·delete 성공과 같은 SDK 클라이언트 세대의 준비 상태를 확인합니다.
3. 요청된 설정으로 새 세션을 만듭니다. 완료된 호출·결과는 직렬화한 이력으로만 제공하며 **기존 결과 RPC로 재제출하지 않습니다.** 최상위 지시문은 지시 채널에 유지합니다.

- **변경으로 보지 않는 메타데이터:** Codex가 function 도구 설명 뒤에 덧붙이는 플러그인 출처 문장은 도구의 이름·스키마·원래 설명이 일치할 때만 메타데이터로 취급합니다. 도구 없는 로컬 압축도 같은 핸드오프 경계를 사용합니다.
- **유지되는 것:** 완료 호출 식별자와 응답 버전. 동일 요청 재시도는 새 캐시를 사용하고 이전 응답 참조는 stale 상태로 남습니다. 결과 RPC 중복 제출과 완료 ID 재사용은 막지만, 모델이 새 호출 ID로 같은 작업을 다시 제안하는 것까지 막지는 못합니다.
- **실패:** 정리·준비 상태를 확인하지 못하면 `session_handoff_failed`를 반환합니다. 취소나 대체 세션 실패 시에는 대화 family를 사용할 수 없는 상태로 두며, 재시도 때 조용히 재전송하지 않습니다.
- **진단:** `bridge.session_handoff`, `bridge.session_handoff_failed`, `bridge.pending_session_changed`에는 요청 ID와 제한된 변경 field·개수만 남기며 대화 원문은 기록하지 않습니다.

### 살아 있는 SDK 세션 없이 재개하기

bridge 재시작 후처럼 대화에 살아 있는 SDK 세션이 없으면, bridge는 Codex가 보낸 이력으로 세션을 다시 만듭니다.

- SDK의 send API는 임의의 Responses 이력을 그대로 복원하는 API가 아니므로, 과거 대화가 포함된 최초 요청은 지시문을 제외한 이력을 assistant phase와 함께 직렬화해 새 사용자 프롬프트의 문맥으로 제공합니다.
- JSON 안의 구분자 문자는 이스케이프하지만 디코딩된 원문은 바꾸지 않습니다.
- 근사 방식입니다. **역할을 그대로 복원하는 네이티브 replay가 아니며** 동일한 답변을 보장하지 않습니다.
- 알려진 이력과 일치하며 정상적으로 이어지는 live 턴은 이 replay 경로를 사용하지 않습니다.

### 문맥 예산

- **tier 선택:** `model-map.mjs`는 모델별로 가장 큰 지원 tier를 선택합니다. `billing.tokenPrices.longContext` 또는 `supportedContextTiers`가 지원을 명시하면 `long_context`, 그렇지 않으면 `default`입니다.
- **하나의 선택 함수:** 같은 선택 함수가 모델 목록 예산과 SDK 세션 설정을 모두 결정합니다. tier는 세션 signature에 포함되므로 추론 수준 변경·이력 재구성·무응답 복구 후에도 유지됩니다. 대기 호출이 있을 때 tier를 바꾸려면 위의 완료 결과 핸드오프가 필요하며, 상위 서비스가 거절해도 조용히 다른 tier로 대체하지 않습니다.
- **예산:** 입력 예산은 선택한 tier의 prompt 한도를 따르고, 모델 전체 문맥 창 안에서 최대 출력 공간을 예약합니다. Codex는 이 예산의 80%에서 로컬 자동 압축을 시작하며 SDK 자체 압축은 꺼져 있습니다.
- **문맥 초과 오류:** SDK의 구조화된 문맥 초과 오류는 Responses의 `context_length_exceeded` 코드를 유지하므로, Codex가 재시도할 수 있는 전송 실패와 구분할 수 있습니다. 실행기는 HTTP·스트림 자동 재시도를 끄지만, 클라이언트의 동일한 재시도는 bridge의 성공 캐시를 사용할 수 있습니다.

## 수명주기와 보안 경계

- **접근:** HTTP는 루프백에만 바인딩하며 `/health`를 제외한 모든 경로에 bridge 전용 인증이 필요합니다. 실행기가 생성한 로컬 토큰은 자식 프로세스 환경 변수로 전달하며, Copilot 인증을 Codex 설정으로 복사하지 않습니다.
- **상한:** 세션 수·유휴 시간·본문 크기·이력 크기·턴 시간에 모두 상한이 있습니다.
- **제거:** 클라이언트 연결 끊김이나 실패·시간 초과한 턴은 해당 bridge 소유 SDK 세션을 제거합니다. 정리는 abort·disconnect·delete를 각각 제한 시간 안에서 시도합니다. TTL·용량에 따른 제거로 대기 호출이 사라질 수 있으며, 이때 클라이언트는 지어낸 도구 결과가 아니라 명시적인 오류를 받습니다.
- **종료:** 이 프로젝트의 SDK client를 중지하며, 정상 정리가 실패하면 강제로 중지합니다.

### 모델 진행과 복구

모델 진행 감시는 유휴 세션 만료와 별개입니다. 두 무진행 제한은 절대 턴 5분·요청 6분 제한 안에서 적용됩니다.

| `waitPhase` | 기본 제한 | 제한 시간을 갱신하는 조건 |
| --- | --- | --- |
| `first_progress` | `TURN_FIRST_PROGRESS_TIMEOUT_MS`: 180초 | 없음. 시도마다 한 번의 초기 대기 시간을 부여합니다. |
| `streaming` | `TURN_IDLE_TIMEOUT_MS`: 90초 | 아래에서 정의한 실제 루트 진행. |

- **진행으로 인정하는 것:** 루트 텍스트, 추론·도구 입력 조각, 증가하는 안전 정수 `assistant.streaming_delta.totalResponseSizeBytes`. 이 중 하나가 도착하면 스트리밍 제한으로 전환하고 갱신합니다. 바이트 카운터는 서로 다른 루트 턴 ID에서 초기화하며 중복 시작에서는 유지합니다.
- **Fusion 단계:** 루트 대화의 등록된 Fusion 단계에서도 증가하는 비공개 출력 바이트와 단계당 한 번의 성공 완료를 반영합니다. 루트 턴당 최대 64개 단계 ID만 추적하며 비공개 내용은 읽거나 전달하지 않습니다.
- **진행으로 인정하지 않는 것:** `assistant.turn_start`는 초기화 알림이지 추론 진행이 아닙니다. 단계 시작만 있는 경우, 단계 도구, review·하위 이벤트, 중복되거나 잘못된 카운터는 제한을 늘리지 않습니다. 루트 `model.call_failure`는 제한된 오류 분류와 숫자 HTTP 상태만 남기는 진단입니다.
- **진단:** `bridge.turn_watchdog`는 `min(SDK_READINESS_INTERVAL_MS, TURN_IDLE_TIMEOUT_MS, TURN_FIRST_PROGRESS_TIMEOUT_MS)` 간격으로 실행하고 `waitPhase`를 기록합니다. `bridge.turn_stalled`는 적용된 제한과 마지막 실제 진행을 기록합니다. 세션 생성·모델 설정은 SDK 시작과 턴 제한 중 짧은 값을 사용합니다.

#### 제한된 무응답 복구

입력 접수가 확인된 무응답 요청은 해당 SDK 세션만 다시 만들어 원래 응답 스트림에서 복구할 수 있습니다.

- **전제 조건:** 이전 세션의 abort·disconnect·delete 성공과 같은 client generation의 정상 준비 상태를 먼저 확인합니다. `TURN_IDLE_RECOVERY_ATTEMPTS`는 기본 1이며 0이면 끄고 최대 3입니다.
- **유지하는 것:** 모델·추론 수준·지시문 권한·완료된 전체 이력·완료 호출 식별자·응답 참조 버전·보고된 사용량. 완료된 도구 결과는 문맥으로만 전달하며 **결과 RPC를 다시 제출하지 않습니다.**
- **복구하지 않는 경우:** 부분 출력, 접수 미확인 입력, 대기 호출, 필터링, 취소, 정리 실패, 연결 유실.
- **제한 시간:** 모든 복구 시도와 대체 세션 설정은 원래 턴·요청 제한을 공유하며 이를 초기화하지 않습니다. 취소는 설정 중인 MCP 확인도 중단합니다.
- **진단:** `bridge.turn_recovering`, `bridge.turn_recovered`, `bridge.turn_recovery_skipped`는 대화 원문 없이 제한된 정보를 남깁니다.
- **한계:** 추가 추론 사용량이 발생할 수 있습니다. 완전히 조용한 추론은 정지와 구분할 수 없으며, 이력 재전송은 모델 실행이 정확히 한 번 일어난다는 보장이 아닙니다.

### 데이터 보관

bridge의 상관관계·재시도 상태는 메모리에 있습니다. `store:false`는 여기서 Responses 조회용 저장소를 만들지 않는다는 뜻이지, Copilot·Codex·SDK가 로컬 세션 파일이나 서비스 측 데이터를 전혀 남기지 않는다는 보장은 아닙니다. bridge는 요청 본문과 인증정보를 로그에 기록하지 않습니다. SDK 오류에는 서비스 진단 내용이 포함될 수 있습니다.

이웃 프로젝트의 테스트·검증 러너·결과는 사용하지 않습니다. 오프라인 테스트는 이 구현에 한정하며 fake SDK와 로컬 HTTP 연결을 사용합니다.

## 안정성·복구 경계

- **대기열:** `request-queue.mjs`는 대화 family별 취소 가능한 FIFO 접수와 전체 요청 제한·상한을 담당합니다. 취소된 대기 요청은 즉시 제거되며 나중에 실행되지 않습니다. 취소 응답은 정리 전에 확정되지만, 정리가 끝날 때까지 family lock을 유지합니다.
- **연결 복구:** `sdk-lifecycle.mjs`는 제한된 ping 검사·단일 연결 복구 작업·새 client generation을 담당합니다. 동시 요청마다 client를 따로 만들지 않고, 시작 제한과 backoff가 있는 공유 복구 작업 하나를 사용합니다. 연결을 잃으면 해당 대화를 무효화하고 명시적으로 실패시키며, 추론이나 불확실한 도구 결과를 다시 보내지 않습니다. 정상 연결에서 수행하는 위의 제한적 무응답 복구와는 별개입니다.
- **도구 목록:** 도구는 식별자로 비교하므로 순서는 메타데이터입니다. 호출이 대기 중일 때의 실제 정책 변경에는 위의 완료 결과 핸드오프가 필요합니다. 충돌(409) 진단은 원문 대신 요청 ID·field 이름·hash·개수를 기록합니다.
- **확정 순서:** 스트림의 delta/final 일치 검사는 성공 캐시나 대기 도구 상태를 확정하기 전에 수행합니다. 동일한 재시도는 캐시를 사용하지만, 스트림 프로토콜이 맞지 않으면 전달되지 않은 도구 호출을 성공으로 캐시하지 않습니다. 네트워크 전달과 모델 생성은 하나의 정확히 한 번(exactly-once) 트랜잭션이 아닙니다.
- **상태 경로:** 공개 `/health`는 HTTP 프로세스 생존, 마지막으로 알려진 `ready`·`upstreamState` 필드, 실행 중인 `turnWatchdog` 설정을 반환합니다. 이 필드가 없는 이전 프로세스는 이 구현을 로드하지 않은 상태입니다. 인증된 `/readyz`는 제한 시간 안의 SDK 준비 상태 검사(200 또는 503)이며 스스로 재연결하지 않습니다. 인증된 `/v1/models`는 응답 전에 SDK 연결을 복구할 수 있습니다. 준비 상태가 추론 서비스 상태나 사용 한도를 보장하지는 않습니다.

제한 시간 기본값과 오류 코드는 [사용 안내](USAGE_KO.md#제한-시간과-복구)에, 별도 66건 안정성 검사 사양은 [안정성 검사 안내](STABILITY_TESTING_KO.md)에 있습니다. 과거 v3 안정성 및 v4 호환성 증거는 동결 소스로 검증하며 재채점하지 않습니다.

### 지시문과 응답 경계

- SDK 시스템·보호 지시는 append 모드로 유지합니다. 요청 지시문과 대화 중간을 포함한 모든 최상위 system/developer 메시지를 원문 그대로 덧붙입니다. 지시문이 바뀌면 idle 세션을 재구성하거나 검증된 완료 결과 핸드오프를 사용합니다. SDK 기본 도구 제외와 권한 요청 거절도 유지합니다.
- 도구 결과와 함께 온 새 사용자 메시지는 결과를 반환하기 전에 SDK immediate steering으로 별도 전달합니다. 도구 출력에 섞지 않으며 결과 원문과 재시도 멱등성을 보존합니다.
- 도구 호출을 Codex에 반환하기 전에 SDK pending 요청의 request ID·session ID·도구 이름·JSON 인자를 대조합니다. 최상위 `agentId`와 구형 payload의 `agentId`·`parentToolCallId`로 하위 이벤트를 루트 응답에서 제외합니다.
- 텍스트 완료는 중간 `assistant.turn_end`가 아닌 루트 `session.idle`까지 기다립니다. 도구 반환은 SDK가 Codex 결과를 기다리므로 idle 대신 대응하는 pending 요청을 확인합니다. 텍스트와 도구가 모두 없는 빈 응답은 성공 캐시에 저장하지 않고 실패합니다.
