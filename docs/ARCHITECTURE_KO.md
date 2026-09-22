# 구조

[English](ARCHITECTURE.md) · [사용법](../README_KO.md) · [호환성](COMPATIBILITY_KO.md)

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
- `model-map.mjs`: 허용된 7개 ID, 기본 모델, OpenAI/Codex catalog 메타데이터 및 reasoning effort 검사. 모델 문맥 한도와 지원 effort는 SDK catalog에서 가져오며, 자동 대체 모델은 없습니다.
- `copilot-home.mjs`, `list-models.mjs`: 기존 Copilot 홈 경로 해석과 계정별 모델 조회.
- 실행기·daemon 모듈 및 `bin/`: 프로젝트 소유 bridge 시작, 프로세스별 Codex 설정과 비공개 임시 모델 목록 전달, 선택적 백그라운드 실행 관리. 임시 목록은 피커의 내장·캐시 목록을 대체하며 Codex 종료 시 삭제합니다.
- `scripts/terminal.mjs`, `scripts/soak/terminal-lane.mjs`: 명시적 실모델 터미널 실행, 소스 동결 worker, 격리 환경과 SDK 응답 대조. 통합 soak worker도 같은 terminal lane을 사용합니다.
- `scripts/soak/terminal.mjs`, `browser.mjs`: 동일한 소유 PTY 수명주기에 독립 파서 또는 Playwright/xterm 표시기를 연결합니다. 브라우저 입출력은 실제 PTY를 사용하며 모의 assistant 화면이 아닙니다. 취소 시 터미널 그룹과 소유 브라우저를 함께 정리합니다.

## 도구 호출 왕복

1. Codex가 function 또는 custom/freeform 도구를 선언합니다. `additional_tools` 입력 안의 중첩 선언도 처리합니다.
2. bridge는 **handler 없는** SDK 도구를 등록하고 `custom:<name>` 항목만 노출합니다. SDK 내장 도구와 tool search는 활성화하지 않습니다.
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
- 대기 중 도구가 있으면 모델·도구·지시문·기존 이력을 바꿔 세션을 교체할 수 없습니다. 다만 Codex가 function 도구 설명 뒤에 덧붙이는 플러그인 출처 문장은 이름·스키마·원래 설명이 일치할 때만 메타데이터로 허용합니다. 대기가 없고 전체 이력이 기존 세션과 맞지 않으면 새 세션을 만들 수 있습니다.

로컬 압축에는 명시적인 도구 반환 경계를 허용합니다. 도구 없는 전체 이력 요청이 기존 이력·모델·지시문을 그대로 유지하고 새 부분에 모든 대기 호출의 결과를 포함하면, 결과를 검증한 뒤 기존 SDK 세션을 중단하고 완료된 이력을 도구 없는 요약 세션으로 전달합니다. 기존 세션에 결과를 재제출하지 않습니다. 결과 누락·중복·잘못된 종류·기존 이력 변경은 원래 세션을 제거하기 전에 거절합니다. 따라서 도구 실행 직후 자동 압축에서도 `pending_session_changed` 반복이나 도구 중복 실행을 피합니다.

SDK의 send API는 임의의 Responses 이력을 그대로 복원하는 API가 아닙니다. 과거 대화가 포함된 최초 요청은 지시문을 제외한 이력을 assistant phase와 함께 직렬화하여 새 사용자 프롬프트의 문맥으로 제공합니다. JSON 안의 구분자 문자는 이스케이프하지만 디코딩된 원문은 바꾸지 않습니다. 이는 **역할을 그대로 복원하는 네이티브 replay가 아니며**, 동일한 답변을 보장하지 않습니다. 정상적으로 이어지는 live 세션에서는 이 replay 경로를 사용하지 않습니다.

SDK 세션은 기본 context tier를 사용하고 SDK 자체 압축은 비활성화합니다. 모델 목록의 입력 예산은 기본 tier·prompt 한도·출력 예약량을 반영하며 Codex가 80%에서 로컬 자동 압축을 시작합니다. SDK의 구조화된 문맥 초과 오류는 Responses의 `context_length_exceeded`로 전달하여 단순 전송 실패와 구분합니다. 실행기는 HTTP·스트림 자동 재시도를 끄지만, 클라이언트가 명시적으로 보낸 동일한 최신 요청은 기존 성공 캐시를 사용할 수 있습니다.

## 수명주기와 보안 경계

HTTP는 루프백에만 바인딩하고 `/health` 외에는 bridge 전용 인증이 필요합니다. 실행기가 생성한 로컬 토큰은 자식 프로세스 환경 변수로 전달하며, Copilot 인증을 Codex 설정으로 복사하지 않습니다.

세션 수·유휴 시간·본문 크기·이력 크기·응답 시간에 상한을 둡니다. 연결 중단·실패·시간 초과 시 해당 bridge 소유 세션을 제거합니다. abort, disconnect, delete를 각각 시간 제한 안에서 시도하며, 종료 시 정상 정리가 실패하면 이 프로젝트의 SDK client를 강제로 정리합니다. TTL 또는 용량에 따른 제거로 대기 호출이 사라질 수 있으며, 이 경우 가짜 결과를 만들지 않고 명시적으로 오류를 반환합니다.

모델 진행 감시는 유휴 세션 만료와 전체 턴 제한과 별개입니다. 루트 모델의 활동만 갱신하며 추론·도구 입력 조각은 전달하지 않고 생존 확인에만 사용합니다. heartbeat나 하위 에이전트 활동으로 루트 무응답이 가려지지 않습니다. `bridge.turn_stalled` 진단에는 모델·단계·정해진 이벤트 이름·시간만 기록합니다. 세션 생성·모델 설정에는 SDK 시작과 턴 제한 중 짧은 값을 적용하여 제어 RPC 하나가 기본 5분의 전체 턴 시간을 소모하지 않도록 합니다.

bridge의 상관관계·재시도 상태는 메모리에 있습니다. `store:false`는 여기서 Responses 조회용 저장소를 만들지 않는다는 뜻이지, Copilot·Codex·SDK가 로컬 세션 파일이나 서비스 측 데이터를 전혀 남기지 않는다는 보장은 아닙니다. bridge는 요청 본문과 인증정보를 로그에 기록하지 않습니다. SDK 오류에는 서비스 진단 내용이 포함될 수 있습니다.

이웃 프로젝트의 테스트·검증 실행기·결과는 사용하지 않습니다. 오프라인 테스트는 이 구현에 한정하며 fake SDK와 로컬 HTTP 연결을 사용합니다.

## 안정성·복구 경계

- `request-queue.mjs`는 대화별 취소 가능한 FIFO와 전체 요청 deadline·상한을 담당합니다. 취소 응답과 정리 완료를 구분하고, 정리가 끝날 때까지 대화 lock을 유지합니다.
- `sdk-lifecycle.mjs`는 bounded ping·단일 복구 작업·새 client generation을 담당합니다. SDK를 잃은 대화는 명시적으로 실패하고 부작용을 자동 replay하지 않습니다.
- 도구 목록의 순서만 달라진 경우 허용하지만 실제 정책 변경은 계속 거절합니다. 409 진단은 원문 대신 field·hash·개수를 기록합니다.
- 스트림의 delta/final 일치 검사를 성공 cache·pending 상태 확정 전에 수행합니다.
- `/health`는 HTTP 생존과 마지막 준비 상태, 인증된 `/readyz`는 SDK ping 검사입니다. 모델 목록 요청은 필요 시 안전한 연결 복구를 시도합니다.

기본값·오류 코드·별도 77건 계약은 [안정성 검증 안내](STABILITY_TESTING_KO.md)에 있습니다. 기존 v4 증거는 동결 소스로 검증하며 재채점하지 않습니다.

- SDK 시스템·보호 지시는 append 모드로 유지합니다. 요청 지시문과 대화 중간을 포함한 모든 최상위 system/developer 메시지를 원문 그대로 덧붙입니다. 지시문이 바뀌면 idle 세션을 재구성하고, 도구 대기 중이면 거절합니다. SDK 기본 도구 제외와 권한 요청 거절도 유지합니다.
- 도구 결과와 함께 온 새 사용자 메시지는 결과를 반환하기 전에 SDK immediate steering으로 별도 전달합니다. 도구 출력에 섞지 않으며 결과 원문과 재시도 멱등성을 보존합니다.
- 도구 호출을 Codex에 반환하기 전에 SDK pending 요청의 request ID·session ID·도구 이름·JSON 인자를 대조합니다. `agentId`와 구형 `parentToolCallId` 양쪽으로 하위 이벤트를 루트 응답에서 제외합니다.
- 텍스트 완료는 중간 `assistant.turn_end`가 아닌 루트 `session.idle`까지 기다립니다. 도구 반환은 SDK가 Codex 결과를 기다리므로 idle 대신 대응하는 pending 요청을 확인합니다. 텍스트와 도구가 모두 없는 빈 응답은 성공 캐시에 저장하지 않고 실패합니다.
