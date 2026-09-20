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
- 실행기·daemon 모듈 및 `bin/`: 프로젝트 소유 bridge 시작, 프로세스별 Codex 설정 전달, 선택적 백그라운드 실행 관리.

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
- 전체 이력 요청은 정규화된 prefix를 비교해 처리한 내용을 다시 보내지 않습니다. wire 전용 ID/status/phase는 비교에서 제외하지만 custom 입력 문자열은 그대로 비교합니다.
- `previous_response_id`는 현재 프로세스 안에서의 후속 연결만 제공합니다. 영구 Responses 저장소가 아니며 최신 대화 버전만 이어갈 수 있습니다.
- 가장 최근 정규화 요청의 동일한 재시도는 캐시를 반환하므로 프롬프트·도구 결과를 중복 제출하지 않습니다.
- 대기 중 도구가 있으면 모델·도구·지시문·기존 이력을 바꿔 세션을 교체할 수 없습니다. 다만 Codex가 function 도구 설명 뒤에 덧붙이는 플러그인 출처 문장은 이름·스키마·원래 설명이 일치할 때만 메타데이터로 허용합니다. 대기가 없고 전체 이력이 기존 세션과 맞지 않으면 새 세션을 만들 수 있습니다.

SDK의 send API는 임의의 Responses 이력을 그대로 복원하는 API가 아닙니다. 과거 대화가 포함된 최초 요청은 그 이력을 직렬화하여 새 사용자 프롬프트의 문맥으로 제공합니다. 이는 **역할을 그대로 복원하는 네이티브 replay가 아니며**, 동일한 답변을 보장하지 않습니다. 정상적으로 이어지는 live 세션에서는 이 replay 경로를 사용하지 않습니다.

## 수명주기와 보안 경계

HTTP는 루프백에만 바인딩하고 `/health` 외에는 bridge 전용 인증이 필요합니다. 실행기가 생성한 로컬 토큰은 자식 프로세스 환경 변수로 전달하며, Copilot 인증을 Codex 설정으로 복사하지 않습니다.

세션 수·유휴 시간·본문 크기·이력 크기·응답 시간에 상한을 둡니다. 연결 중단·실패·시간 초과 시 해당 bridge 소유 세션을 제거합니다. abort, disconnect, delete를 각각 시간 제한 안에서 시도하며, 종료 시 정상 정리가 실패하면 이 프로젝트의 SDK client를 강제로 정리합니다. TTL 또는 용량에 따른 제거로 대기 호출이 사라질 수 있으며, 이 경우 가짜 결과를 만들지 않고 명시적으로 오류를 반환합니다.

bridge의 상관관계·재시도 상태는 메모리에 있습니다. `store:false`는 여기서 Responses 조회용 저장소를 만들지 않는다는 뜻이지, Copilot·Codex·SDK가 로컬 세션 파일이나 서비스 측 데이터를 전혀 남기지 않는다는 보장은 아닙니다. bridge는 요청 본문과 인증정보를 로그에 기록하지 않습니다. SDK 오류에는 서비스 진단 내용이 포함될 수 있습니다.

이웃 프로젝트의 테스트·검증 실행기·결과는 사용하지 않습니다. 오프라인 테스트는 이 구현에 한정하며 fake SDK와 로컬 HTTP 연결을 사용합니다.
