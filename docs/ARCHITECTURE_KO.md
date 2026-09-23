# 구조

[English](ARCHITECTURE.md) · [빠른 시작](../README_KO.md) · [사용법](USAGE_KO.md) · [호환성](COMPATIBILITY_KO.md)

구현 참조 문서입니다. 실행·설정·재시작 방법은 [사용 안내](USAGE_KO.md)를 참고하세요.

## 요청 경로

```text
Codex CLI — 승인·샌드박스·도구 실행 담당
  → 루프백의 인증된 HTTP/SSE: POST /v1/responses
  → request-policy.mjs: 텍스트 입력 및 function/custom 도구 정규화
  → session-manager.mjs: 대화 식별, SDK 이벤트, 대기 중 도구 호출 관리
  → GitHub Copilot SDK 1.0.14 — 기존 Copilot 인증 사용
  → 명시적으로 선택한 Copilot 모델
```

이 프로젝트는 프로토콜 변환기입니다. Codex의 도구 실행기를 Copilot 실행기로 교체하거나 OpenAI/Anthropic API를 직접 호출하지 않습니다. 모델 추론은 GitHub Copilot으로 전송됩니다. bridge가 로컬에서 실행된다는 것은 추론도 로컬에서 수행된다는 뜻이 아닙니다.

## 모듈

- `server.mjs`: 루프백 HTTP 서버, 로컬 토큰 인증, 요청 상한, JSON/SSE 응답, 연결 중단 처리.
- `request-policy.mjs`: 지원 요청 검증, Codex의 `additional_tools`·namespace 처리, 결정적인 SDK 도구 이름 매핑.
- `responses.mjs`: Responses 출력 항목과 스트리밍 이벤트. `call_id`, namespace, custom 입력 문자열 보존.
- `session-manager.mjs`: 대화별 직렬화, 이력 대조, 최근 재시도 캐시, 도구 결과 전달, 제한 시간·만료·정리.
- `copilot-session-rpc.mjs`: SDK abort/disconnect/delete와 대기 중 도구 결과 RPC의 작은 래퍼.
- `mcp-isolation.mjs`: Copilot 런타임에 설정된 MCP 서버(사용자 `mcp-config.json`과 설치된 plugin)의 정확한 이름을 모아 모든 bridge SDK 세션의 `disabledMcpServers`로 전달.
- `model-map.mjs`: 허용된 6개 ID, 기본 모델, OpenAI/Codex catalog 메타데이터 및 reasoning effort 검사. 모델 문맥 한도와 지원 effort는 SDK catalog에서 가져오며, 자동 대체 모델은 없습니다.
- `copilot-home.mjs`, `list-models.mjs`: 기존 Copilot 홈 경로 해석과 계정별 모델 조회.
- 실행기·daemon 모듈 및 `bin/`: 프로젝트 소유 bridge 시작, 프로세스별 Codex 설정과 비공개 임시 모델 목록 전달, 선택적 백그라운드 실행 관리. 임시 목록은 피커의 내장·캐시 목록을 대체하며 Codex 종료 시 삭제합니다. 목록 항목에 `apply_patch_tool_type: "freeform"`을 선언하므로 Codex가 기본 `apply_patch` 도구를 제공합니다.
- `scripts/terminal.mjs`, `scripts/soak/terminal-lane.mjs`: 명시적 실모델 터미널 실행, 소스 동결 worker, 격리 환경과 SDK 응답 대조. 통합 soak worker도 같은 terminal lane을 사용합니다.
- `scripts/tui.mjs`와 `scripts/tui/`: [실제 TUI 행렬](TUI_SCENARIOS_KO.md)입니다. 케이스마다 `bin/codex-ghcp`를 전용 PTY에서 실행하고 headless Playwright/xterm.js로 렌더링·구동합니다. bridge Copilot 런타임 아래 프로세스를 표본 채취하고, Codex 자체 rollout을 읽으며, 저장한 fact에서 검사를 다시 계산합니다.
- `scripts/soak/terminal.mjs`, `browser.mjs`: 동일한 소유 PTY 수명주기에 독립 파서 또는 Playwright/xterm 표시기를 연결합니다. 브라우저 입출력은 실제 PTY를 사용하며 모의 assistant 화면이 아닙니다. 취소 시 터미널 그룹과 소유 브라우저를 함께 정리합니다.

## 도구 호출 왕복

1. Codex가 function 또는 custom/freeform 도구를 선언합니다. `additional_tools` 입력 안의 중첩 선언도 처리합니다.
2. bridge는 **handler 없는** SDK 도구를 등록하고 `custom:<name>` 항목만 노출합니다. SDK 내장 도구와 tool search는 활성화하지 않습니다. Copilot 런타임 자체의 사용자·plugin MCP 서버는 세션 생성 시 비활성화하므로 하나도 시작되지 않습니다. 이어서 제한 시간이 있는 `session.mcp.list` 점검으로 스캔하지 않은 출처에서 뜬 서버를 중지하고 이후 세션에서 비활성화합니다. Codex 자체 MCP 도구는 Codex가 실행하고 다른 도구처럼 선언하므로 그대로 동작합니다.
3. SDK assistant 메시지에서 호출을 받고, `external_tool.requested`에서 해당 호출의 대기 `requestId`를 확보합니다.
4. HTTP 응답으로 `function_call` 또는 `custom_tool_call`을 Codex에 전달합니다. bridge는 도구를 실행하지 않습니다.
5. Codex가 자신의 승인·샌드박스 정책에 따라 실행하고, 다음 Responses 요청으로 결과를 보냅니다.
6. bridge가 `session.rpc.tools.handlePendingToolCall({requestId, result})`로 결과를 제출하고 이어지는 모델 응답을 전달합니다.

function 도구는 JSON 인자를 사용합니다. custom 도구는 SDK에 필수 `input` 문자열 하나를 가진 객체로 표현합니다. 이 문자열은 줄바꿈 변경이나 추가 JSON 인코딩 없이 `custom_tool_call.input`으로 돌아갑니다. grammar가 제공되면 모델 설명에 포함하지만, **SDK가 grammar 기반 출력을 강제하지는 않습니다.**

한 턴의 모든 대기 결과를 함께 제출해야 합니다. 알 수 없는 ID, 중복 ID, 잘못된 결과 종류, 일부만 포함한 결과는 SDK 제출 전에 거절합니다. 예상하지 않은 SDK 권한 요청도 거절합니다. handler 없는 bridge 도구의 `skipPermission`은 SDK의 중복 확인만 피하며, Codex 도구 실행을 승인하는 옵션이 아닙니다.

## 대화 연속성

- Codex의 `session-id`/`thread-id` 헤더로 대화를 구분합니다. 헤더가 없으면 유효한 `previous_response_id` 또는 진행 중 도구 ID로 연결하며, 그것도 없으면 새 대화를 만듭니다.
- 같은 대화의 요청은 직렬화합니다. 서로 다른 대화는 SDK 세션도 분리합니다.
- 전체 이력 요청은 정규화된 prefix를 비교해 처리한 내용을 다시 보내지 않습니다. wire 전용 ID/status는 제외하지만 assistant `phase`와 custom 입력 문자열은 보존·비교합니다. 과거 phase가 생략되면 기존 값을 유지하고, 명시적으로 바뀌면 이력 변경으로 처리합니다.
- `previous_response_id`는 현재 프로세스 안에서의 후속 연결만 제공합니다. 영구 Responses 저장소가 아니며 최신 대화 버전만 이어갈 수 있습니다.
- 가장 최근 정규화 요청의 동일한 재시도는 캐시를 반환하므로 프롬프트·도구 결과를 중복 제출하지 않습니다.
- 대기 중 호출의 결과가 모두 정확히 한 번 포함되고 지시문을 제외한 기존 대화가 그대로일 때만 설정을 바꿔 세션을 교체할 수 있습니다. Codex가 function 도구 설명 뒤에 덧붙이는 플러그인 출처 문장은 이름·스키마·원래 설명이 일치할 때만 메타데이터로 허용합니다. 대기가 없고 전체 이력이 기존 세션과 맞지 않으면 새 세션을 만들 수 있습니다.

완료 결과 핸드오프는 전체 이력, `previous_response_id`, 호출 ID로 연결하는 결과 전용 요청을 지원합니다. 모든 결과가 있으면 모델·context tier·도구·최상위 지시문 변경을 함께 반영할 수 있습니다. 기존 사용자·assistant 내용, phase, 호출 ID·인자, 과거 결과는 일치해야 합니다. 이전 세션의 abort·disconnect·delete와 같은 SDK generation의 준비 상태를 확인한 뒤 요청된 설정으로 새 세션을 만들고, 완료된 호출·결과를 직렬화한 이력으로만 제공합니다. 기존 결과 RPC를 다시 제출하지 않으며 최상위 지시문은 지시 채널에 유지합니다. 도구 없는 로컬 압축도 이 경계를 사용합니다.

완료 호출 식별자와 응답 버전을 보존하므로 동일 요청 재시도는 새 캐시를 사용하고 이전 응답 참조는 stale 상태로 남습니다. 잘못된 결과 배치는 원래 세션을 제거하기 전에 거절합니다. 정리·준비 상태를 확인하지 못하면 `session_handoff_failed`, 취소·대체 세션 실패 시에는 대화를 유실 상태로 유지하여 후속 요청이 무작정 재전송되지 않게 합니다. `bridge.session_handoff`, `bridge.session_handoff_failed`, `bridge.pending_session_changed`에는 요청 ID와 제한된 변경 field·개수만 남기고 대화 원문은 기록하지 않습니다. 결과 RPC 중복 제출과 완료 ID 재사용을 막는 것이며, 모델이 새 호출 ID로 같은 작업을 다시 제안하는 것까지 보장하지는 않습니다.

SDK의 send API는 임의의 Responses 이력을 그대로 복원하는 API가 아닙니다. 과거 대화가 포함된 최초 요청은 지시문을 제외한 이력을 assistant phase와 함께 직렬화하여 새 사용자 프롬프트의 문맥으로 제공합니다. JSON 안의 구분자 문자는 이스케이프하지만 디코딩된 원문은 바꾸지 않습니다. 이는 **역할을 그대로 복원하는 네이티브 replay가 아니며**, 동일한 답변을 보장하지 않습니다. 정상적으로 이어지는 live 세션에서는 이 replay 경로를 사용하지 않습니다.

### 문맥 예산

`model-map.mjs`는 모델별 최대 지원 tier를 선택합니다. `billing.tokenPrices.longContext` 또는 `supportedContextTiers`가 지원을 명시하면 `long_context`, 그렇지 않으면 `default`입니다. 공통 선택 함수를 모델 목록 예산과 SDK 세션 설정에 함께 사용하고, tier를 세션 signature에 포함하여 추론 수준 변경·이력 재구성·무응답 복구에도 유지합니다. 대기 호출이 있으면 위의 완료 결과 핸드오프 조건을 충족해야 tier를 바꿀 수 있으며, 상위 서비스의 거절을 기본 tier로 자동 대체하지 않습니다.

입력 예산은 선택한 tier의 prompt 한도와 모델 총 문맥 내 최대 출력 예약량을 반영하며 Codex가 80%에서 로컬 자동 압축을 시작합니다. SDK 자체 압축은 계속 비활성화합니다. SDK의 구조화된 문맥 초과 오류는 Responses의 `context_length_exceeded`로 전달하여 단순 전송 실패와 구분합니다. 실행기는 HTTP·스트림 자동 재시도를 끄지만, 클라이언트가 명시적으로 보낸 동일한 최신 요청은 기존 성공 캐시를 사용할 수 있습니다.

## 수명주기와 보안 경계

HTTP는 루프백에만 바인딩하고 `/health` 외에는 bridge 전용 인증이 필요합니다. 실행기가 생성한 로컬 토큰은 자식 프로세스 환경 변수로 전달하며, Copilot 인증을 Codex 설정으로 복사하지 않습니다.

세션 수·유휴 시간·본문 크기·이력 크기·응답 시간에 상한을 둡니다. 연결 중단·실패·시간 초과 시 해당 bridge 소유 세션을 제거합니다. abort, disconnect, delete를 각각 시간 제한 안에서 시도하며, 종료 시 정상 정리가 실패하면 이 프로젝트의 SDK client를 강제로 정리합니다. TTL 또는 용량에 따른 제거로 대기 호출이 사라질 수 있으며, 이 경우 가짜 결과를 만들지 않고 명시적으로 오류를 반환합니다.

모델 진행 감시는 유휴 세션 만료와 전체 턴 제한과 별개입니다. 각 시도는 갱신되지 않는 첫 진행 제한 `TURN_FIRST_PROGRESS_TIMEOUT_MS`(180초)로 시작합니다. `assistant.turn_start`는 초기화 알림이지 추론 진행이 아닙니다. 실제 루트 텍스트·추론·도구 입력 조각 또는 증가하는 안전 정수 `assistant.streaming_delta.totalResponseSizeBytes`가 도착하면 `TURN_IDLE_TIMEOUT_MS`(90초)로 전환하고 갱신합니다. 바이트 카운터는 서로 다른 루트 턴 ID에서 초기화하며 중복 시작에서는 유지합니다. 루트 대화의 등록된 Fusion 단계에서도 증가하는 비공개 출력 바이트·단계당 한 번의 성공 완료를 반영합니다. 단계 시작만 있는 경우·단계 도구·review/하위 이벤트·중복/잘못된 카운터는 제한을 늘리지 않습니다. 루트 턴당 최대 64개 단계 ID만 추적하고 비공개 내용은 읽거나 전달하지 않습니다. 감시 간격은 `min(SDK_READINESS_INTERVAL_MS, TURN_IDLE_TIMEOUT_MS, TURN_FIRST_PROGRESS_TIMEOUT_MS)`이며 `waitPhase`(`first_progress` 또는 `streaming`)·해당 제한·마지막 진행을 진단합니다. 루트 `model.call_failure`는 제한된 오류 분류·숫자 HTTP 상태만 남기고 진행으로 간주하지 않습니다. 세션 생성·모델 설정은 SDK 시작과 턴 제한 중 짧은 값을 유지하며 복구가 절대 턴 5분·요청 6분 예산을 초기화하지 않습니다.

입력 접수가 확인된 무응답 요청은 이전 세션의 abort·disconnect·delete 성공과 같은 SDK 연결의 준비 상태를 확인한 뒤, 해당 SDK 세션만 재구성하여 기존 응답 스트림에서 복구할 수 있습니다. `TURN_IDLE_RECOVERY_ATTEMPTS`는 기본 1, 0이면 비활성화, 최대 3입니다. 모델·추론 수준·지시문 권한·완료된 전체 이력·완료 호출 식별자·응답 참조 버전·보고된 사용량을 보존합니다. 완료된 도구 결과는 문맥으로만 전달하고 도구 결과 RPC를 재제출하지 않습니다. 부분 출력, 접수 미확인 입력, 대기 호출, 필터, 취소, 정리 실패, 연결 유실은 재전송하지 않습니다. 원래 턴·요청 제한을 모든 복구 시도와 재설정이 공유하며, 취소는 설정 중 MCP 확인도 중단합니다. `bridge.turn_recovering`, `bridge.turn_recovered`, `bridge.turn_recovery_skipped`는 대화 원문 없이 제한된 진단을 남깁니다. 추가 추론 사용량이 발생할 수 있으며, 완전히 조용한 추론과 정지는 구분할 수 없고 이력 재전송은 모델 행동의 정확히 한 번 실행을 보장하지 않습니다.

bridge의 상관관계·재시도 상태는 메모리에 있습니다. `store:false`는 여기서 Responses 조회용 저장소를 만들지 않는다는 뜻이지, Copilot·Codex·SDK가 로컬 세션 파일이나 서비스 측 데이터를 전혀 남기지 않는다는 보장은 아닙니다. bridge는 요청 본문과 인증정보를 로그에 기록하지 않습니다. SDK 오류에는 서비스 진단 내용이 포함될 수 있습니다.

이웃 프로젝트의 테스트·검증 실행기·결과는 사용하지 않습니다. 오프라인 테스트는 이 구현에 한정하며 fake SDK와 로컬 HTTP 연결을 사용합니다.

## 안정성·복구 경계

- `request-queue.mjs`는 대화별 취소 가능한 FIFO와 전체 요청 deadline·상한을 담당합니다. 취소 응답과 정리 완료를 구분하고, 정리가 끝날 때까지 대화 lock을 유지합니다.
- `sdk-lifecycle.mjs`는 bounded ping·단일 연결 복구 작업·새 client generation을 담당합니다. 연결을 잃은 대화는 명시적으로 실패하고 추론·도구 결과를 자동 재전송하지 않습니다. 정상 연결에서 수행하는 위의 제한적 무응답 복구와는 별개입니다.
- 도구 목록 순서는 메타데이터로 취급하고 실제 정책 변경은 도구 대기 중 위의 완료 결과 핸드오프 조건을 요구합니다. 409 진단은 원문 대신 field·hash·개수를 기록합니다.
- 스트림의 delta/final 일치 검사를 성공 cache·pending 상태 확정 전에 수행합니다.
- `/health`는 HTTP 생존·마지막 준비 상태·실행 중인 `turnWatchdog` 설정을 반환합니다. 해당 필드가 없는 이전 프로세스는 이 구현을 로드하지 않은 상태입니다. 인증된 `/readyz`는 SDK ping 검사이며 모델 목록 요청은 필요 시 안전한 연결 복구를 시도합니다.

기본값·오류 코드·별도 66건 안정성 계약은 [안정성 검증 안내](STABILITY_TESTING_KO.md)에 있습니다. 과거 v3 안정성 및 v4 호환성 증거는 동결 소스로 검증하며 재채점하지 않습니다.

- SDK 시스템·보호 지시는 append 모드로 유지합니다. 요청 지시문과 대화 중간을 포함한 모든 최상위 system/developer 메시지를 원문 그대로 덧붙입니다. 지시문이 바뀌면 idle 세션을 재구성하거나 검증된 완료 결과 핸드오프를 사용합니다. SDK 기본 도구 제외와 권한 요청 거절도 유지합니다.
- 도구 결과와 함께 온 새 사용자 메시지는 결과를 반환하기 전에 SDK immediate steering으로 별도 전달합니다. 도구 출력에 섞지 않으며 결과 원문과 재시도 멱등성을 보존합니다.
- 도구 호출을 Codex에 반환하기 전에 SDK pending 요청의 request ID·session ID·도구 이름·JSON 인자를 대조합니다. 최상위 `agentId`와 구형 payload의 `agentId`·`parentToolCallId`로 하위 이벤트를 루트 응답에서 제외합니다.
- 텍스트 완료는 중간 `assistant.turn_end`가 아닌 루트 `session.idle`까지 기다립니다. 도구 반환은 SDK가 Codex 결과를 기다리므로 idle 대신 대응하는 pending 요청을 확인합니다. 텍스트와 도구가 모두 없는 빈 응답은 성공 캐시에 저장하지 않고 실패합니다.
