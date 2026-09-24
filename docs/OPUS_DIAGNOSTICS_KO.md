# Opus 상위 응답 진단

[English](OPUS_DIAGNOSTICS.md) · [검증 안내](../README_KO.md#개발과-검증) · [안정성 계약](STABILITY_TESTING_KO.md)

Opus에서 `upstream_content_filter`가 발생해 오류 이름 외의 증거가 필요할 때 사용하세요. **동일 요청의 상위 프로토콜 응답과 SDK 이벤트를 대조**하는 선택적 진단이며, `content_filter`라는 SDK 오류만으로 원인을 단정하지 않습니다. 안정성 행렬의 실패 케이스를 대체하거나 재채점하지 않습니다.

## 실행

저장소 루트에서 `npm ci`를 마친 뒤 실행합니다. Codex CLI나 브라우저는 필요하지 않습니다. 진단 내용을 확인하려면 계획을, 증거를 수집하려면 실모델 실행을 선택하세요.

### 계획

**모델 호출·Copilot 로그인이 필요하지 않습니다.** 기본 모드는 진단 내용을 설명할 뿐 실행하지 않습니다.

```sh
npm run diagnose:opus
```

### 실모델 진단

**Copilot 사용량이 발생합니다.** Copilot SDK **1.0.14**와 `claude-opus-5.5`를 사용할 수 있는 인증된 계정이 필요합니다. 먼저 `./bin/ghcp-models`에서 해당 모델이 `disabled`나 `not available`이 아닌지 확인하세요. 목록 접근이 실패하면 [인증 문제 해결](USAGE_KO.md#시작과-설정)을 참고하세요.

새 디렉터리나 비어 있는 디렉터리만 사용하며 기존 보고서는 덮어쓰지 않습니다.

```sh
npm run diagnose:opus -- --execute --output .runtime/opus-diagnostic-new
```

진단 7개는 각각 새 세션에서 실행되며 보고서에 해당 `id`로 기록됩니다.

| 진단 `id` | 경로 | 보내는 요청 |
| --- | --- | --- |
| `sdk-exact-fixture` | SDK 직접 호출 | 변경하지 않은 v4 fixture 요청 |
| `bridge-exact-fixture` | 운영 bridge 관리자 | 같은 요청 |
| `sdk-exact-nonstreaming` | SDK 직접 호출 | SDK `streaming: false`로 보낸 같은 요청 |
| `sdk-exact-default-summary` | SDK 직접 호출 | SDK 기본 reasoning summary로 보낸 같은 요청. 나머지 진단은 `reasoningSummary: "none"`을 보냄 |
| `sdk-simple-tool-control` | SDK 직접 호출 | 대조군: `read_fixture`를 한 번 호출해 결과 반환 |
| `bridge-simple-tool-control` | 운영 bridge 관리자 | 같은 단순 도구 대조군 |
| `sdk-arithmetic-control` | SDK 직접 호출 | 대조군: 도구 없는 산술 질문 |

바뀌지 않는 조건:

- 대조군 문구는 진단 전용입니다. 운영 요청이나 66건 안정성 케이스를 대신하지 않습니다.
- 모델 ID·낮은 추론 수준(low)·SDK 기본 보호 지시문·공급자 필터 정책은 그대로 둡니다.
- 모든 권한 요청은 거절합니다. 유일한 도구 작업은 메모리에서 생성한 합성 문자열을 반환하는 것입니다.
- 자동 재시도·대체 모델·사용자 설정 변경은 없습니다. `claude-opus-5`에 대한 기존 분석은 과거 기록으로 남습니다.

| 종료 코드 | 의미 |
| --- | --- |
| 0 | 유효한 계획, 또는 진단 7개가 모두 완료되고 정리에 성공했으며 소스가 바뀌지 않음 |
| 1 | 필터링·원문 출력 불일치·오류·정리 실패·소스 변경 중 하나라도 있음 |
| 2 | 인자 또는 러너 오류 |

종료 코드 0이어도 안정성 행렬 통과를 뜻하지는 않습니다.

## 기록과 판독

출력 디렉터리의 `report.json`(예: `.runtime/opus-diagnostic-new/report.json`)을 여세요. **실행이 종료 코드 1로 끝났어도** 마찬가지입니다. 이 진단에는 `--verify` 모드가 없으므로, 실모델 진단을 다시 실행할지 정하기 전에 저장된 증거부터 확인하세요.

먼저 `cases`의 각 항목을 읽습니다.

| `status` | 의미 |
| --- | --- |
| `completed` | 해당 진단의 출력·도구 결과 제출 횟수 조건을 충족함. |
| `filtered` | SDK 또는 bridge에서 명시적인 상위 필터 신호를 받음. 공급자의 필터 이유를 설명하는 값은 아님. |
| `mismatch` | 출력 또는 도구 결과 제출 횟수가 해당 진단의 조건과 다름. |
| `error` | 진단 실행 오류가 발생함. `errorCode` 확인. |
| `not-run` | 실행하지 않은 진단이며 통과가 아님. |

`cases[].cleanup[].passed`와 보고서의 `implementationUnchanged`도 확인하세요. 응답이 완료됐다는 사실만으로 진단 전체가 성공한 것은 아니며, 진단 성공도 행렬 통과를 뜻하지 않습니다.

공급자 원인 조사에는 다음 프로토콜 관측을 사용합니다.

- **Chat Completions:** `finish_reason: content_filter`.
- **Anthropic Messages:** `stop_reason: refusal`, 허용 목록으로 제한한 `stop_details.category`.
- **SDK:** `contentFilterTriggered` / `finishReason`.
- **bridge:** 요청 단계(`prompt`, `tool_result_continuation`, `tool_handoff`, `completed`), pending 수, 결과 제출 횟수.

공급자 분류는 **각 실행의 관측값이지 확정된 근본 원인이 아닙니다.**

| 기록 | 관측한 분류 |
| --- | --- |
| [2026-09-22 조사](validation/2026-09-22-opus-analysis/README_KO.md) | `reasoning_extraction` |
| [2026-09-23 진단](validation/2026-09-23-failure-iterations.json) | 원문 fixture 검사 4건 모두 `other` |

어느 분류도 사용자 의도나 합성 데이터 복사 요청을 필터링한 이유를 입증하지 않습니다. 남은 S11 행렬 실패에는 네이티브 refusal 분류가 기록되지 않았으므로 별도 진단의 분류로 채우지 마세요. 분류를 피하려고 요청을 몰래 바꾸거나 보호 정책을 해제하지 않습니다.

SDK 모델 목록 조회도 request handler를 지나갈 수 있습니다. `observedHttpRequests`와 모델 ID가 확인된 `observedInferenceRequests`를 별도로 기록합니다. SDK의 `streaming:false`가 모든 공급자 경로에서 비스트리밍 HTTP를 보장하는 것은 아니므로, `wire[].request.streaming`의 실제 값을 확인하세요. 지원하지 않는 응답 형식의 `explicitBlock:null`은 **증거 없음**이지 차단되지 않았다는 뜻이 아닙니다.

단순 도구 대조군이 값을 반환하더라도 서식이 바뀌면 `exactFixture:false`와 `status:mismatch`가 유지됩니다. `fixtureValuesPreserved:true`는 값 보존 진단일 뿐 원문 복사 통과로 바꾸지 않습니다.

## 보안·제한

관찰기는 원래 `Request`와 `Response`를 변경 없이 전달합니다. 복사본만 읽으며, 256 KiB/45초 한도 초과는 `complete:false`로 표시합니다. 헤더·인증 정보·프롬프트·도구 출력·응답 본문·공급자 설명문은 저장하지 않습니다. 해시, 숫자, 허용된 프로토콜 상태만 남깁니다. 원본 SDK/상위 데이터는 다른 곳에서 별도로 노출하지 않아야 합니다.

bridge는 루트 필터 이벤트를 세션 수명 전체에서 감시합니다. HTTP 응답을 이미 보낸 뒤 늦게 신호가 오면 전송한 내용이나 클라이언트가 이미 실행한 도구를 되돌릴 수는 없지만, 다음 캐시 재사용·결과 재개·응답 핸들 확정을 차단합니다. 하위 에이전트 이벤트나 필터처럼 보이는 일반 문구는 루트 실패로 바꾸지 않습니다.
