# 호환성

[English](COMPATIBILITY.md) · [빠른 시작](../README_KO.md) · [사용법](USAGE_KO.md) · [구조](ARCHITECTURE_KO.md)

## 범위

대상은 Codex CLI **0.154.0**, `@github/copilot-sdk` **1.0.14**입니다. 검증한 버전이며, 새 버전은 프로토콜이 바뀌어 adapter 수정이 필요할 수 있습니다. bridge는 텍스트 대화와 Codex가 실행하는 도구를 지원하며, OpenAI Responses API 전체를 구현하지는 않습니다. Copilot에서 모델이 활성화됐다고 해서 모든 Codex 기능이 그 모델로 동작하는 것은 아닙니다. 오프라인 테스트는 모의 SDK 응답으로 bridge를 검사하며, 실제 모델의 동작은 실모델 실행에서만 확인할 수 있습니다.

[지원 모델 6개](../README_KO.md#모델)만 안내된 피커 순서대로 허용합니다. 실제 사용 가능 여부는 계정 정책에 따릅니다. 지원 종료 모델을 포함한 다른 ID는 거절합니다. 다른 공급자의 이름으로 치환하거나 대체 모델을 선택하지 않고 해당 ID를 SDK에 전달합니다.

## 이 기능을 사용할 수 있나요?

| 작업 | 지원 여부와 제한 |
| --- | --- |
| 대화, 로컬 파일 읽기·편집, 셸 명령 실행 | **Codex 도구**를 통해 지원하며 Codex의 승인·샌드박스를 따릅니다. 도구의 파일 접근은 모델에 파일을 직접 첨부하는 것과 다릅니다. |
| Codex MCP 도구 사용 | 지원합니다. Copilot 런타임 자체의 MCP 서버는 계속 비활성화합니다. |
| 모델 전환, 로컬 압축, 대화 재개 | [문맥·상태 제한](USAGE_KO.md#모델-선택과-문맥) 안에서 지원합니다. bridge 재시작 시 미완료 호출은 사라집니다. |
| `apply_patch` 등 custom 도구 사용 | 지원하지만 grammar는 생성 강제가 아닌 안내입니다. |
| 이미지·음성·영상·파일 직접 첨부 | 지원하지 않습니다. 모델 입력과 도구 결과는 텍스트여야 합니다. |
| schema로 JSON 출력 강제, 공급자 호스팅 웹 검색 | 지원하지 않습니다. 프롬프트로 JSON을 요청해도 schema 준수는 보장하지 않습니다. 구조화 출력을 요구하는 네이티브 reviewer 경로도 실패할 수 있습니다. |
| WebSocket, 원격 Responses 압축 | 지원하지 않습니다. 실행기의 HTTP/SSE·로컬 압축 기본값을 사용하세요. |

아래는 프로토콜과 오류 처리의 상세 설명이며 추가 설치 절차가 아닙니다.

## 구현한 동작

- JSON 또는 HTTP/SSE 텍스트 응답의 `POST /v1/responses`, 인증된 `GET /v1/models`·`GET /readyz`, 공개 `GET /health`.
- 텍스트 메시지, 대화 이력 전체의 system/developer 지시문, 클라이언트 function/custom 도구.
- Codex namespace와 `additional_tools` 선언. function 인자는 JSON 의미를, custom 입력은 문자열 원문을 유지합니다.
- 여러 도구 호출과 그 호출 모두에 대한 후속 결과 배치.
- `parallel_tool_calls=false`: 응답당 최대 한 호출만 전달합니다. SDK가 여러 호출을 반환하면 아무 호출도 전달하지 않고 `parallel_tool_calls_violation`으로 실패시킵니다. 모델의 생성 방식을 강제하는 것이 아니라 출력을 검사합니다.
- live 전체 이력 prefix 비교, 대화별 직렬화, 프로세스 내 `previous_response_id` 후속 연결.
- 가장 최근 요청의 동일한 재시도에서 프롬프트·도구 결과 중복 제출 방지.
- 연결 취소, SDK 제한 시간, 메모리 상태 상한 및 유휴/용량 만료.
- 선택 모델의 catalog가 지원하는 reasoning effort. Haiku 4.5는 effort를 설정할 수 없습니다.
- 실행별 주요 모델 피커 목록, 최대 지원 tier의 입력 예산, 전체 도구 결과 반환 직후의 네이티브 로컬 자동 압축. `npm run test:context:runtime`은 실제 Codex CLI와 SDK 대역으로 이를 확인하며 최대 문맥·장시간 실모델 검사는 아닙니다.

## 정확히 같지 않은 부분

**Custom grammar:** SDK에서는 필수 `input` 문자열을 가진 JSON-schema 도구로 표현합니다. grammar를 모델 설명에 포함하지만 decoder가 강제하지 않습니다. 반환된 원문을 파싱하고 실행하는 책임은 Codex에 있습니다.

**과거 대화 replay:** 새 SDK 세션에 임의의 Responses 이력을 원래 역할 그대로 가져올 수 없습니다. 완료된 과거 턴은 직렬화된 프롬프트 문맥으로 전달합니다. 정상적으로 연결된 live 대화는 기존 SDK 세션과 실제 대기 도구 결과 RPC를 사용합니다.

**지시문 경계:** SDK의 시스템·보호 지시는 그대로 유지합니다.

- 요청 지시문과 모든 최상위 system/developer 메시지를 원문 그대로 덧붙입니다. 대화 중간의 지시문도 포함하며 `systemMessage.mode="append"`를 사용하고 `replace`는 사용하지 않습니다.
- 두 지시문 역할은 SDK의 같은 필드를 사용합니다. 과거 user/assistant 메시지는 직렬화된 replay가 필요하며, 역할을 그대로 보존하는 범용 이력 가져오기는 아닙니다.
- 설정이 같은 live 세션에서 대기 결과와 함께 온 새 사용자 메시지는 SDK immediate steering으로 별도 전달합니다. 도구 출력에 섞지 않습니다.
- 모든 대기 결과와 함께 신뢰된 지시문이 갱신되면 정리를 확인한 뒤 세션을 재구성합니다. 지시문 권한과 직렬화한 이력 안의 도구 결과 원문을 보존합니다. 결과 누락·기존 대화 변조는 이전 세션을 제거하기 전에 거절합니다.

SDK 기본 도구는 계속 비활성화합니다. 클라이언트 도구는 Codex만 자신의 샌드박스·승인 정책 아래 실행합니다. [핸드오프 절차](ARCHITECTURE_KO.md#완료된-도구-결과와-함께-설정-바꾸기)를 참고하세요.

**Assistant phase와 완료 경계:** [Responses phase 의미](https://developers.openai.com/api/docs/guides/reasoning#phase-parameter)에 따라 `commentary`와 `final_answer`를 정규화·replay에서 보존합니다. 과거 phase가 생략되면 기존 값을 유지하고 명시적으로 바뀌면 live prefix가 달라진 것으로 처리합니다.

텍스트 응답은 루트 `session.idle`까지 기다려 중간 보정·사용량·오류를 수집합니다. 도구 응답은 대신 대응하는 외부 pending 호출의 상관관계를 검증한 뒤 반환합니다. 비어 있고 도구도 없는 응답이나 pending 호출 불일치는 성공 상태를 저장하기 전에 실패합니다.

**사용량:** SDK가 실제 토큰 수를 제공하면 반환하고, 없으면 추정하지 않고 `null`로 표시합니다. 사용량·캐시·과금은 Copilot 기준이며 OpenAI API의 과금 의미와 같다고 보장하지 않습니다.

**보관:** 응답 상관관계는 메모리에만 있습니다. 재시작·TTL·용량 제거로 response ID나 미완료 호출이 만료됩니다. `store:false`는 Codex/SDK 로컬 파일을 끄거나 Copilot의 무보관을 보장하는 옵션이 아닙니다.

**추론 요약 정책:** SDK 세션 생성과 모델 설정 변경에 `reasoningSummary: "none"`을 명시하여 실행기의 요약 비활성화 정책과 일치시킵니다. 요청한 추론 강도는 별도로 유지합니다. 이는 설정 일관성 수정이며 상위 서비스 거절의 원인이나 해결책으로 확정한 것은 아닙니다.

## 거절하거나 비활성화하는 기능

- WebSocket, 압축 요청, 원격 Responses compaction.
- 이미지·오디오·영상·파일 모델 입력, 텍스트가 아닌 도구 결과.
- 공급자 호스팅 웹 검색, code interpreter, file search 등 서버 측 내장 도구.
- strict 도구 schema 강제, 구조화 JSON 출력, required/지명 tool choice.
- temperature, top-p, 명시적 출력 토큰/도구 호출 횟수 상한, 자동 요청 truncation.
- reasoning summary/암호화 reasoning replay, 영구 응답 조회, stored/background Responses 작업, 별도 service tier.

실행기가 호환되지 않는 전송·검색 기능을 끕니다. 그 밖에 의미를 지킬 수 없는 요청은 지원한다고 가장하지 않고 명시적으로 거절합니다. 캐시 키·metadata·text verbosity·암호화 reasoning 포함 요청 등 일부 힌트는 무시됨을 진단할 수 있지만, 이것이 해당 서비스 기능을 구현한다는 뜻은 아닙니다.

Codex 0.154는 대화의 첫 프롬프트 뒤에 짧은 작업 제목을 만들기 위한 요청을 하나 더 보내며, 이 요청은 JSON schema를 사용합니다. bridge는 이를 HTTP 400(`Structured output is not supported`)으로 거절하고, Codex는 제목 생성 없이 정상적으로 계속 진행합니다.

## 상위 서비스에서 필터링한 응답

루트 SDK의 명시적인 필터 신호는 `upstream_content_filter`로 알립니다(JSON HTTP 422, 이미 시작된 SSE는 마지막 `response.failed` 이벤트). 해당 턴의 성공 캐시·pending 호출을 확정하거나 자동 재실행하지 않습니다. 이미 전송한 부분 텍스트는 미완료로 표시합니다. 구조화된 필터 신호 없이 거절처럼 보이는 문구는 원래 모델 출력 그대로 유지하고, 하위 에이전트 신호로 루트 응답을 대신 판정하지 않습니다.

## 운영 시 주의

- 초기 모델은 `--ghcp-model`로 선택하고, `/model`은 계정에서 사용 가능한 모델을 고정 순서로 표시합니다. 임시 목록은 Codex 설정을 편집하지 않지만, Codex가 `/model` 선택을 `~/.codex/config.toml`에 저장할 수 있습니다. [모델 선택과 저장](USAGE_KO.md#모델-선택과-문맥)을 참고하세요.
- 결과 배치는 대기 중 호출을 모두 정확히 한 번 포함해야 합니다. 도구 없는 압축을 포함한 설정 변경은 지시문을 제외한 이력이 그대로이고 정리·준비 상태가 확인된 완료 결과 핸드오프를 요구합니다. 완료 ID와 stale 응답 버전을 보존하고 기존 결과 RPC를 다시 제출하지 않습니다. 직렬화된 이력은 모델이 새 ID로 같은 작업을 요청하지 않는다는 보장은 아닙니다.
- SDK 세션은 최대 지원 context tier(지원 시 `long_context`, 아니면 `default`)를 선택하고 Codex는 목록의 유효 입력 예산 80%에서 압축합니다. 문맥 초과는 `context_length_exceeded`로 전달하며 실행기는 HTTP·스트림 자동 추론 재시도를 끕니다. 첫 진행에는 별도 180초, 이후 스트리밍 무진행에는 90초를 적용하고 모두 절대 턴·요청 제한 안에서 처리합니다.
- 가장 최근 결과 재시도는 가능하지만 임의의 과거 response 분기는 지원하지 않습니다. 분기하려면 전체 이력을 가진 새 대화를 시작하세요.
- Codex의 승인·샌드박스 정책은 유지합니다. bridge가 승인 우회 옵션을 대신 추가하지 않습니다.
- 백그라운드 daemon 상태는 프로젝트 전용입니다. 재사용/종료 전에 자신이 소유한 인스턴스를 확인합니다.
- 새 CLI 버전에 필드·도구가 추가되면 어댑터를 수정해야 할 수 있습니다. 확인하기 전에는 버전을 고정하세요.

필터 감시는 도구 handoff와 idle 뒤에도 유지합니다. 늦은 루트 신호는 다음 캐시 재시도나 pending 결과 재개를 차단하며, 이미 보낸 출력은 회수할 수 없습니다. 뒤이은 SDK 종료 오류가 최초 원인을 덮어쓰지 않습니다. 원문을 저장하지 않는 선택적 상위 refusal 진단은 [Opus 진단](OPUS_DIAGNOSTICS_KO.md)을 참고하세요.
