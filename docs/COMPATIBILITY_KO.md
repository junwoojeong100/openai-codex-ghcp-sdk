# 호환성

[English](COMPATIBILITY.md) · [사용법](../README_KO.md) · [구조](ARCHITECTURE_KO.md)

## 범위

대상은 Codex CLI **0.154.0**, `@github/copilot-sdk` **1.0.14**입니다. 텍스트와 클라이언트 도구를 연결하며, OpenAI Responses API 전체를 구현하지는 않습니다. Copilot에서 모델이 활성화됐다는 사실만으로 모든 Codex 기능을 지원한다고 판단하지 않습니다. 오프라인 테스트와 인증된 실제 모델 실행은 별도의 확인입니다.

허용 모델은 피커 순서대로 `claude-opus-5.5`, `claude-sonnet-5`, `claude-haiku-4.5`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`뿐입니다. 계정 정책에 따라 사용하지 못할 수 있습니다. 제거된 ID(`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `claude-opus-5`)는 실행기와 bridge가 거절합니다. 다른 공급자의 이름으로 치환하거나 대체 모델을 선택하지 않고 해당 ID를 SDK에 전달합니다.

## 구현한 동작

- JSON 또는 HTTP/SSE 텍스트 응답의 `POST /v1/responses`, 인증된 `GET /v1/models`, 공개 `GET /health`.
- 텍스트 메시지, 대화 이력 전체의 system/developer 지시문, 클라이언트 function/custom 도구.
- Codex namespace와 `additional_tools` 선언. function 인자는 JSON 의미를, custom 입력은 문자열 원문을 유지합니다.
- 여러 도구 호출과 그 호출 모두에 대한 후속 결과 배치.
- `parallel_tool_calls=false`: 응답당 최대 한 호출만 전달합니다. SDK가 여러 호출을 반환하면 아무 호출도 전달하지 않고 `parallel_tool_calls_violation`으로 실패시킵니다. 모델의 생성 방식을 강제하는 것이 아니라 출력을 검사합니다.
- live 전체 이력 prefix 비교, 대화별 직렬화, 프로세스 내 `previous_response_id` 후속 연결.
- 가장 최근 요청의 동일한 재시도에서 프롬프트·도구 결과 중복 제출 방지.
- 연결 취소, SDK 제한 시간, 메모리 상태 상한 및 유휴/용량 만료.
- 선택 모델의 catalog가 지원하는 reasoning effort. Haiku 4.5는 effort를 설정할 수 없습니다.
- 실행별 주요 모델 피커 목록, 기본 tier 문맥 예산, 전체 도구 결과 반환 직후의 네이티브 로컬 자동 압축. `npm run test:context:runtime`은 실제 Codex CLI와 SDK 대역으로 이를 확인하며 최대 문맥·장시간 실모델 검사는 아닙니다.

## 정확히 같지 않은 부분

**Custom grammar:** SDK에서는 필수 `input` 문자열을 가진 JSON-schema 도구로 표현합니다. grammar를 모델 설명에 포함하지만 decoder가 강제하지 않습니다. 반환된 원문을 파싱하고 실행하는 책임은 Codex에 있습니다.

**과거 대화 replay:** 새 SDK 세션에 임의의 Responses 이력을 원래 역할 그대로 가져올 수 없습니다. 완료된 과거 턴은 직렬화된 프롬프트 문맥으로 전달합니다. 정상적으로 연결된 live 대화는 기존 SDK 세션과 실제 대기 도구 결과 RPC를 사용합니다.

**지시문 경계:** 요청 지시문과 모든 최상위 system/developer 메시지를 대화 중간에 있더라도 원문 그대로 SDK 기본 시스템 지시에 덧붙입니다. `systemMessage.mode="append"`를 사용하고 `replace`로 SDK 보호 지시를 제거하지 않습니다. 두 지시문 역할은 SDK의 같은 필드를 사용하며, 과거 user/assistant 역할은 여전히 직렬화된 replay를 사용하므로 범용적인 역할 보존 transcript 가져오기는 아닙니다. 도구 결과와 함께 온 새 사용자 메시지는 SDK immediate steering으로 별도 전달하며 도구 출력에 섞지 않습니다. 도구가 대기 중일 때 지시문이 바뀌면 결과나 steering 메시지를 보내기 전에 명시적으로 거절합니다. SDK 기본 도구는 계속 비활성화하고, 클라이언트 도구는 Codex가 자신의 샌드박스·승인 정책 아래 실행합니다.

**Assistant phase와 완료 경계:** [Responses phase 의미](https://developers.openai.com/api/docs/guides/reasoning#phase-parameter)에 따라 `commentary`와 `final_answer`를 정규화·replay에서 보존합니다. 과거 phase가 생략되면 기존 값을 유지하고 명시적으로 바뀌면 live prefix가 달라진 것으로 처리합니다. 텍스트 응답은 루트 `session.idle`까지 기다려 중간 보정·사용량·오류를 수집합니다. 도구 응답은 대신 대응하는 외부 pending 호출의 상관관계를 검증한 뒤 반환합니다. 비어 있고 도구도 없는 응답이나 pending 호출 불일치는 성공 상태를 저장하기 전에 실패합니다.

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

- 초기 모델은 `--ghcp-model`로 선택하고, `/model` 피커는 실행 시점의 허용 6개 중 계정에서 사용 가능한 목록을 고정 순서로 사용합니다. 임시 모델 목록은 사용자 Codex 설정 파일을 수정하지 않습니다.
- 결과 배치는 대기 중 호출을 모두 정확히 한 번 포함해야 합니다. 대기 중 모델·지시문·기존 이력 변경은 계속 거절합니다. 도구 없는 전체 이력 압축만 모델·지시문·이력을 유지하고 모든 결과를 검증한 뒤 기존 세션을 교체할 수 있습니다.
- SDK 세션은 기본 context tier를 유지하고 Codex는 목록의 유효 입력 예산 80%에서 압축합니다. 문맥 초과는 `context_length_exceeded`로 전달하며 실행기는 HTTP·스트림 자동 추론 재시도를 끕니다.
- 가장 최근 결과 재시도는 가능하지만 임의의 과거 response 분기는 지원하지 않습니다. 분기하려면 전체 이력을 가진 새 대화를 시작하세요.
- Codex의 승인·샌드박스 정책은 유지합니다. bridge가 승인 우회 옵션을 대신 추가하지 않습니다.
- 백그라운드 daemon 상태는 프로젝트 전용입니다. 재사용/종료 전에 자신이 소유한 인스턴스를 확인합니다.
- 새 CLI 버전에 필드·도구가 추가되면 어댑터를 수정해야 할 수 있습니다. 확인하기 전에는 버전을 고정하세요.

필터 감시는 도구 handoff와 idle 뒤에도 유지합니다. 늦은 루트 신호는 다음 캐시 재시도나 pending 결과 재개를 차단하며, 이미 보낸 출력은 회수할 수 없습니다. 뒤이은 SDK 종료 오류가 최초 원인을 덮어쓰지 않습니다. 원문을 저장하지 않는 선택적 상위 refusal 진단은 [Opus 진단](OPUS_DIAGNOSTICS_KO.md)을 참고하세요.
