# 호환성

[English](COMPATIBILITY.md) · [사용법](../README_KO.md) · [구조](ARCHITECTURE_KO.md)

## 범위

대상은 Codex CLI **0.154.0**, `@github/copilot-sdk` **1.0.14**입니다. 텍스트와 클라이언트 도구를 연결하며, OpenAI Responses API 전체를 구현하지는 않습니다. Copilot에서 모델이 활성화됐다는 사실만으로 모든 Codex 기능을 지원한다고 판단하지 않습니다. 오프라인 테스트와 인증된 실제 모델 실행은 별도의 확인입니다.

허용 모델은 `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4.5`뿐입니다. 계정 정책에 따라 사용하지 못할 수 있습니다. 다른 공급자의 이름으로 치환하거나 대체 모델을 선택하지 않고 해당 ID를 SDK에 전달합니다.

## 구현한 동작

- JSON 또는 HTTP/SSE 텍스트 응답의 `POST /v1/responses`, 인증된 `GET /v1/models`, 공개 `GET /health`.
- 텍스트 메시지, 앞부분의 system/developer 지시문, 클라이언트 function/custom 도구.
- Codex namespace와 `additional_tools` 선언. function 인자는 JSON 의미를, custom 입력은 문자열 원문을 유지합니다.
- 여러 도구 호출과 그 호출 모두에 대한 후속 결과 배치.
- `parallel_tool_calls=false`: 응답당 최대 한 호출만 전달합니다. SDK가 여러 호출을 반환하면 아무 호출도 전달하지 않고 `parallel_tool_calls_violation`으로 실패시킵니다. 모델의 생성 방식을 강제하는 것이 아니라 출력을 검사합니다.
- live 전체 이력 prefix 비교, 대화별 직렬화, 프로세스 내 `previous_response_id` 후속 연결.
- 가장 최근 요청의 동일한 재시도에서 프롬프트·도구 결과 중복 제출 방지.
- 연결 취소, SDK 제한 시간, 메모리 상태 상한 및 유휴/용량 만료.
- 선택 모델의 catalog가 지원하는 reasoning effort. Haiku 4.5는 effort를 설정할 수 없습니다.

## 정확히 같지 않은 부분

**Custom grammar:** SDK에서는 필수 `input` 문자열을 가진 JSON-schema 도구로 표현합니다. grammar를 모델 설명에 포함하지만 decoder가 강제하지 않습니다. 반환된 원문을 파싱하고 실행하는 책임은 Codex에 있습니다.

**과거 대화 replay:** 새 SDK 세션에 임의의 Responses 이력을 원래 역할 그대로 가져올 수 없습니다. 완료된 과거 턴은 직렬화된 프롬프트 문맥으로 전달합니다. 정상적으로 연결된 live 대화는 기존 SDK 세션과 실제 대기 도구 결과 RPC를 사용합니다.

**지시문 경계:** 앞부분의 system/developer 메시지는 SDK replacement system prompt에 합칩니다. 이후의 문맥은 프롬프트나 도구 결과와 함께 전달되므로 범용적인 역할 보존 transcript 변환기는 아닙니다.

**사용량:** SDK가 실제 토큰 수를 제공하면 반환하고, 없으면 추정하지 않고 `null`로 표시합니다. 사용량·캐시·과금은 Copilot 기준이며 OpenAI API의 과금 의미와 같다고 보장하지 않습니다.

**보관:** 응답 상관관계는 메모리에만 있습니다. 재시작·TTL·용량 제거로 response ID나 미완료 호출이 만료됩니다. `store:false`는 Codex/SDK 로컬 파일을 끄거나 Copilot의 무보관을 보장하는 옵션이 아닙니다.

## 거절하거나 비활성화하는 기능

- WebSocket, 압축 요청, 원격 Responses compaction.
- 이미지·오디오·영상·파일 모델 입력, 텍스트가 아닌 도구 결과.
- 공급자 호스팅 웹 검색, code interpreter, file search 등 서버 측 내장 도구.
- strict 도구 schema 강제, 구조화 JSON 출력, required/지명 tool choice.
- temperature, top-p, 명시적 출력 토큰/도구 호출 횟수 상한, 자동 요청 truncation.
- reasoning summary/암호화 reasoning replay, 영구 응답 조회, stored/background Responses 작업, 별도 service tier.

실행기가 호환되지 않는 전송·검색 기능을 끕니다. 그 밖에 의미를 지킬 수 없는 요청은 지원한다고 가장하지 않고 명시적으로 거절합니다. 캐시 키·metadata·text verbosity·암호화 reasoning 포함 요청 등 일부 힌트는 무시됨을 진단할 수 있지만, 이것이 해당 서비스 기능을 구현한다는 뜻은 아닙니다.

## 운영 시 주의

- `--ghcp-model`로 모델을 선택합니다. bridge 목록과 Codex의 `/model` 선택기는 자동 연동되지 않습니다.
- 결과 배치는 대기 중 호출을 모두 정확히 한 번 포함해야 합니다. 대기 중에는 모델·지시문·도구 변경을 거절합니다.
- 가장 최근 결과 재시도는 가능하지만 임의의 과거 response 분기는 지원하지 않습니다. 분기하려면 전체 이력을 가진 새 대화를 시작하세요.
- Codex의 승인·샌드박스 정책은 유지합니다. bridge가 승인 우회 옵션을 대신 추가하지 않습니다.
- 백그라운드 daemon 상태는 프로젝트 전용입니다. 재사용/종료 전에 자신이 소유한 인스턴스를 확인합니다.
- 새 CLI 버전에 필드·도구가 추가되면 어댑터를 수정해야 할 수 있습니다. 확인하기 전에는 버전을 고정하세요.
