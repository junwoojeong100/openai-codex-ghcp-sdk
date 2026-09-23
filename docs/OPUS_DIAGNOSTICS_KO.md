# Opus 상위 응답 진단

[English](OPUS_DIAGNOSTICS.md) · [검증 안내](../README_KO.md#개발과-검증) · [안정성 계약](STABILITY_TESTING_KO.md)

`content_filter`라는 SDK 오류만으로 원인을 추정하지 않고, **동일 요청의 상위 프로토콜 응답과 SDK 이벤트를 대조**하기 위한 별도 진단입니다. 안정성 행렬의 실패 셀을 대체하거나 재채점하지 않습니다.

## 실행

저장소 루트에서 `npm ci`를 마친 뒤 실행합니다. 실모델 진단에는 Copilot SDK 1.0.14와 `claude-opus-5.5`를 사용할 수 있는 인증된 계정이 필요합니다. 이 진단은 Codex TUI나 브라우저를 사용하지 않습니다.

**계획만 출력 — 모델 호출 없음:**

```sh
npm run diagnose:opus
```

**실모델 진단 — Copilot 사용량 발생:** 새 디렉터리나 비어 있는 디렉터리만 사용합니다. 기존 보고서는 덮어쓰지 않습니다.

```sh
npm run diagnose:opus -- --execute --output .runtime/opus-diagnostic-new
```

`claude-opus-5`에 대한 기존 분석은 과거 기록으로 남습니다. 일곱 개의 새 세션에서 다음을 비교합니다.

- 변경하지 않은 v4 `read_fixture` 요청: SDK 직접 호출 / production `SessionManager` 경로.
- 같은 요청에서 SDK streaming 옵션과 reasoning summary 옵션의 영향.
- 별도 단순 도구 호출 대조군: SDK / 브릿지.
- 별도 산술 대조군.

대조군의 문구는 **진단 전용**이며 운영 요청이나 66건 안정성 검사를 치환하지 않습니다. 모델 ID·추론 강도(low)를 유지하고 SDK 기본 보호 지시를 제거하지 않습니다. 모든 SDK 권한 요청은 거절하며, 유일한 도구 작업은 메모리에서 생성한 합성 fixture 문자열 반환입니다. 자동 재시도, 모델 fallback, 사용자 설정 변경은 없습니다.

차단·불일치·오류·정리 실패가 있으면 종료 코드는 1입니다. 종료 코드 0도 정식 안정성 행렬 통과를 의미하지 않습니다.

## 기록과 판독

`report.json`은 다음을 구분합니다.

- **Chat Completions:** `finish_reason: content_filter`.
- **Anthropic Messages:** `stop_reason: refusal`, 허용 목록으로 제한한 `stop_details.category`.
- **SDK:** `contentFilterTriggered` / `finishReason`.
- **브릿지:** 요청 단계(`prompt`, `tool_result_continuation`, `tool_handoff`, `completed`), pending 수, 결과 제출 횟수.

실제 조사에서 Anthropic Messages의 `reasoning_extraction` 분류가 관측됐습니다. 이는 상위 서비스가 보고한 분류이지, 사용자가 실제로 추론 추출을 요청했다는 증명이 아닙니다. 왜 소유한 합성 데이터의 복사 요청을 그렇게 분류했는지는 별도 문제입니다. 이 분류를 피하도록 요청을 몰래 고치거나 보호 정책을 해제하지 않습니다.

SDK 모델 목록 조회도 request handler를 지나갈 수 있습니다. `observedHttpRequests`와 모델 ID가 확인된 `observedInferenceRequests`를 별도로 기록합니다. SDK의 `streaming:false`가 모든 공급자 경로에서 비스트리밍 HTTP를 보장하는 것은 아니므로, `wire[].request.streaming`의 실제 값을 확인하세요. 지원하지 않는 응답 형식의 `explicitBlock:null`은 **증거 없음**이지 차단되지 않았다는 뜻이 아닙니다.

단순 도구 대조군이 값을 반환하더라도 서식이 바뀌면 `exactFixture:false`와 `status:mismatch`가 유지됩니다. `fixtureValuesPreserved:true`는 값 보존 진단일 뿐 원문 복사 통과로 바꾸지 않습니다.

## 보안·제한

관찰기는 원래 `Request`와 `Response`를 변경 없이 전달합니다. 복사본만 읽으며, 256 KiB/45초 한도 초과는 `complete:false`로 표시합니다. 헤더·인증 정보·프롬프트·도구 출력·응답 본문·공급자 설명문은 저장하지 않습니다. 해시, 숫자, 허용된 프로토콜 상태만 남깁니다. 원본 SDK/상위 데이터는 다른 곳에서 별도로 노출하지 않아야 합니다.

브릿지는 루트 필터 이벤트를 세션 수명 전체에서 감시합니다. HTTP 응답을 이미 보낸 뒤 늦게 신호가 오면 전송한 내용이나 클라이언트가 이미 실행한 도구를 되돌릴 수는 없지만, 다음 캐시 재사용·결과 재개·응답 핸들 확정을 차단합니다. 하위 에이전트 이벤트나 필터처럼 보이는 일반 문구는 루트 실패로 바꾸지 않습니다.
