# Codex × GitHub Copilot SDK 검증 리포트 — 2026-09-20

[English](VALIDATION_REPORT_2026-09-20.md) · [한국어 README](../README_KO.md) · [호환성 및 제한](COMPATIBILITY_KO.md)

## 1. 결론

**검증 시점의 환경과 아래 범위에서 Codex → 로컬 bridge → GitHub Copilot SDK → `gpt-6-astra` 연결이 정상 동작했다.**

| 구분 | 결과 |
| --- | --- |
| 저장소 자동화 테스트 (`npm test`) | **63개 통과, 0개 실패**, 취소·건너뜀·TODO 각 0개 |
| 실제 연결 통합 검증 | **12개 항목 통과, 0개 실패** |
| 실행 중이던 기존 bridge | health 및 인증된 모델 목록 조회 성공 |
| 실제 Codex CLI E2E | 읽기 전용 명령 1회 실행, 도구 결과 전달 및 최종 응답 성공, 종료 코드 `0` |
| JavaScript/Bash 문법 및 `git diff --check` | 통과 |

자동화 테스트는 fake SDK를 사용하므로 실제 서비스 연결 검증과 구분했다. 통합 검증의 12개 항목에는 준비 상태, 인증·요청 거절, 종료 정리도 포함되며, 12개 모델을 호출했다는 뜻이 아니다.

이 문서는 특정 커밋·버전·계정 권한에서 관측한 결과 기록이다. 모든 모델, 모든 Codex 기능 또는 이후 시점의 서비스 상태를 보장하지 않는다.

## 2. 검증 대상과 환경

| 항목 | 값 |
| --- | --- |
| 검증 대상 소스 커밋 | [`acefc14d722df787a14d4af5ca4efcaef4df2e4d`](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/commit/acefc14d722df787a14d4af5ca4efcaef4df2e4d) |
| 검증일 | 2026-09-20, Asia/Seoul (UTC+09:00) |
| 실제 연결 검증 시작 | 2026-09-20 15:00:29.053 KST |
| 실제 연결 검증 종료 | 2026-09-20 15:01:30.813 KST |
| 실제 연결 검증 총 경과 시간 | 61.760초; 성능 벤치마크가 아닌 단일 실행 관측값 |
| Node.js | `v22.16.0` |
| npm | `10.9.2` |
| Codex CLI | `0.154.0` |
| 설치된 Copilot CLI | `1.0.87-0` |
| `@github/copilot-sdk` | `1.0.14` |
| `proper-lockfile` | `4.1.2` |
| 실제 추론 모델 | `gpt-6-astra` |
| 직접 Responses API 검증의 추론 강도 | `reasoning.effort = "max"` |
| Codex CLI E2E 설정 | 기존 사용자 설정 사용, `--ephemeral`, `--sandbox read-only`; 추론 강도 추가 override 없음 |

`./bin/ghcp-doctor`의 버전·설치 진단은 통과했다. 이 명령 자체는 인증을 검사하지 않으므로, 인증과 서비스 접근은 `./bin/ghcp-models --json` 및 실제 연결 검증으로 별도 확인했다.

`max`는 직접 API 테스트 요청에 지정한 값이다. 이번 검증으로 사용자의 영구 설정이나 실행 중인 대화의 추론 강도를 변경하지 않았다.

## 3. 저장소 자동화 테스트

실행 명령:

```bash
npm test
```

Node 내장 테스트 러너가 다음 7개 파일의 테스트를 실행했다.

| 테스트 파일 | 주요 검증 범위 |
| --- | --- |
| `test/bridge-daemon.test.mjs` | daemon 상태·레지스트리, 인스턴스 확인, 인증, 잘못된 프로세스 종료 방지 |
| `test/launcher.test.mjs` | 모델 선택, Codex 인자 전달, 공급자·전송 설정 충돌 차단, 인증정보 분리 |
| `test/model-map.test.mjs` | 허용 모델 목록, 사용 불가 모델의 자동 대체 방지, catalog 및 reasoning effort |
| `test/request-policy.test.mjs` | 요청 정규화, 도구 namespace, 이력·도구 결과, 미지원 입력 거절 |
| `test/responses.test.mjs` | Responses 출력 및 SSE 이벤트·수명주기 변환 |
| `test/server.test.mjs` | HTTP 인증, JSON/SSE 응답, 요청 오류, 연결 취소, 서버 설정 |
| `test/session-manager.test.mjs` | 세션 격리·연속성·재시도, 도구 왕복, 권한 거절, 취소·제한 시간·정리 |

### 최초 실행 실패와 재실행

| 실행 환경 | 통과 | 실패 | 판정 |
| --- | ---: | ---: | --- |
| 루프백 포트 바인딩이 차단된 실행 샌드박스 | 54 | 9 | 로컬 HTTP 서버를 여는 테스트에서 `listen EPERM: operation not permitted 127.0.0.1` 발생 |
| 승인 후 루프백 바인딩을 허용한 환경 | 63 | 0 | 전체 통과 |

최초 9개 실패는 모델·SDK 또는 bridge 로직의 실패가 아니라 실행 환경의 포트 제한 때문이었다. 소스 수정 없이 재실행해 전체 통과를 확인했다. 이 환경 변경과 별개로 실제 Codex E2E의 도구 실행에는 `read-only` 샌드박스를 유지했다.

추가로 `src/*.mjs`, `test/*.mjs`에 `node --check`, `bin/*`에 `bash -n`을 실행했고, `git diff --check`도 통과했다.

## 4. 실제 SDK·모델 연결 검증

기존 bridge에는 읽기 전용 상태·모델 목록 조회만 수행했다. 실제 추론과 도구 왕복은 같은 저장소 구현·설치 버전·Copilot 인증을 사용하는 별도 테스트용 bridge에서 수행해 기존 대화를 건드리지 않았다.

아래 시간은 원본 `report.json`의 항목별 경과 시간이며, 네트워크·서비스 상태에 따라 달라질 수 있다.

| # | 원본 검증 항목 | 확인 내용 | 결과 | 시간 (ms) |
| ---: | --- | --- | --- | ---: |
| 1 | `current_connection_read_only_probe` | 기존 bridge의 Responses 프로토콜, `gpt-6-astra`, health 및 인증 성공 | PASS | 18 |
| 2 | `isolated_real_sdk_bridge_start` | 실제 SDK를 사용하는 별도 bridge 기동, health 및 모델 7개 확인 | PASS | 1,807 |
| 3 | `authenticated_live_model_catalog` | 인증된 `/v1/models` 조회; OpenAI 형식 `data`와 Codex 형식 `models` 모두 7개 | PASS | 2 |
| 4 | `live_authentication_and_request_policy` | 잘못된 인증·입력·전송·미지원 기능의 명시적 거절 | PASS | 6 |
| 5 | `real_model_json_response_at_max_effort` | `max` 요청으로 실제 모델이 지정된 표식을 JSON 응답으로 반환; `status=completed` | PASS | 5,140 |
| 6 | `real_model_previous_response_id_continuity` | `previous_response_id` 후속 요청에서 이전 사용자 메시지의 표식 유지 | PASS | 2,632 |
| 7 | `identical_retry_preserves_cached_result` | 동일 후속 요청 재시도의 출력과 사용량이 직전 응답과 일치 | PASS | 2 |
| 8 | `real_model_sse_lifecycle_and_text` | SSE 텍스트와 최종 출력 일치, 이벤트 순서·종료 상태 확인 | PASS | 7,305 |
| 9 | `real_model_function_tool_roundtrip` | `probe.read_fixture` function 호출, JSON 인자·namespace·실제 도구 결과·최종 응답 확인 | PASS | 11,058 |
| 10 | `real_model_custom_tool_roundtrip` | custom 호출 입력의 공백·개행·마지막 개행 보존 및 도구 결과 왕복 확인 | PASS | 9,343 |
| 11 | `actual_codex_launcher_read_only_tool_e2e` | 실제 실행기와 Codex CLI로 읽기 전용 명령 실행 후 알 수 없던 파일 표식 반환 | PASS | 23,714 |
| 12 | `owned_test_bridge_cleanup` | 테스트 소유 bridge 종료 및 health 응답 중단 확인; 기존 bridge 종료 작업 없음 | PASS | 716 |

### 인증·오류 처리 상세

| 입력/조건 | 관측한 HTTP 상태 |
| --- | ---: |
| bridge 인증정보 없음 | `401` |
| 잘못된 bridge 인증정보 | `401` |
| 잘못된 JSON | `400` |
| `content-encoding: zstd` 요청 | `415` |
| `/v1/responses/compact` 요청 | `400` |
| 이미지 입력과 `stream: true` | `400`, SSE 시작 전 JSON 오류 응답 |

오류 조건 검증 중 남은 `bridge.request_failed` 진단 로그는 의도한 거절 결과이며, 실제 모델 응답 실패로 집계하지 않았다.

### 스트리밍 상세

- 총 SSE 이벤트 **33개**, `response.output_text.delta` **25개**를 관측했다.
- 첫 이벤트는 `response.created`, 마지막 이벤트는 `response.completed`였다.
- `response.completed`는 정확히 1회 발생했고, sequence number는 단조 증가했다.
- delta를 결합한 텍스트가 최종 응답의 표식과 일치했다.
- `response.failed` 또는 `error` 이벤트는 없었다.

## 5. 실제 Codex CLI E2E

E2E는 저장소의 `bin/codex-ghcp` 실행기를 실제로 호출했다. fake Codex나 fake SDK로 대체하지 않았다.

검증 절차:

1. 임시 파일에 무작위 표식을 생성했다. 표식 값 자체는 모델 프롬프트에 포함하지 않았다.
2. Codex에 지정된 읽기 전용 셸 명령을 정확히 한 번 실행하도록 요청했다.
3. 명령은 저장소의 `package.json`에서 패키지 이름과 SDK 의존성 버전을 읽고, 임시 파일의 표식을 읽었다.
4. JSONL 이벤트에서 `command_execution` 완료, 명령 종료 코드 `0`, 실제 출력의 기대값 일치를 검사했다.
5. 최종 assistant 응답이 도구 출력과 일치하고 `turn.completed`가 발생했는지 검사했다.
6. Codex 실행기 프로세스의 종료 코드가 `0`인지 확인했다.

반환 형식은 다음과 같았다. 아래 `<무작위 표식>`은 실제 값을 대체한 설명용 자리표시자다.

```text
PACKAGE=openai-codex-ghcp-sdk;SDK=1.0.14;MARKER=<무작위 표식>
```

모델에 제공하지 않은 파일 값을 도구 출력과 최종 응답 양쪽에서 확인했으므로, 단순 텍스트 응답 성공과 구분해 실제 도구 왕복을 검증했다.

## 6. 재확인 방법과 증거 범위

설치·자동화 테스트·인증된 모델 목록은 저장소에서 다음 명령으로 재확인할 수 있다.

```bash
npm test
./bin/ghcp-doctor
./bin/ghcp-models --json
```

실제 CLI E2E에 사용한 실행 형태는 다음과 같다. `<읽기 전용 검증 프롬프트>`는 위 E2E 절차에 맞게 생성한 실제 프롬프트로 바꿔야 한다.

```bash
./bin/codex-ghcp --ghcp-model gpt-6-astra -- \
  exec --ephemeral --sandbox read-only --json --color never \
  '<읽기 전용 검증 프롬프트>'
```

- 실제 연결 검증의 요청 제한 시간은 `TURN_TIMEOUT_MS=90000`, CLI E2E 외부 제한 시간은 240초로 설정했다.
- 전체 12개 항목은 저장소 외부의 일회성 `live-check.mjs`로 검증했다. **이 보고서 추가는 `npm test`에 실제 모델 테스트를 추가하는 변경이 아니며, 위 명령만으로 12개 항목 전체가 자동 재현되는 것은 아니다.**
- 항목·시간·결과는 로컬 `report.json`, Codex 도구 실행은 `codex-events.jsonl`, 스트리밍은 `sse-events.json`, 오류 거절은 `bridge-diagnostics.jsonl`과 대조했다.
- 원본 스크립트와 로그는 로컬 임시 산출물이다. 이 문서에는 요약 결과만 반영하며, 원본 파일이나 로컬 절대 경로를 저장소에 포함하지 않는다.
- 실제 SDK·모델 검증에는 기존 Copilot 인증, 네트워크 및 루프백 접근이 필요하며 계정 사용량이 발생한다.

## 7. 제한 및 변경 사항

- 실제 추론 검증은 **`gpt-6-astra`에 한정**했다. 아래 7개 모델 모두가 인증된 catalog에 노출되는 것은 확인했지만, 나머지 6개 모델의 추론·도구 호출을 실행하지는 않았다.
  - `gpt-5.6-sol`
  - `gpt-5.6-terra`
  - `gpt-5.6-luna`
  - `gpt-6-astra`
  - `claude-opus-5`
  - `claude-sonnet-5`
  - `claude-haiku-4.5`
- 짧은 텍스트·도구 왕복의 성공이 장시간 대화, 대규모 동시 요청, 장애 복구, 모든 Codex 기능의 호환성을 보장하지 않는다. 별도 부하·장기 안정성 검증은 수행하지 않았다.
- 취소·제한 시간·용량 정리 등의 자동화 테스트 통과와 실제 서비스 장애 상황 재현은 다르다. 실제 장애를 주입하는 검증은 수행하지 않았다.
- 이미지 입력 거절처럼 의도된 미지원 동작은 성공 조건으로 검사했다. 지원 범위는 [호환성 문서](COMPATIBILITY_KO.md)를 따른다.
- 검증 수행 중 저장소 소스·테스트 파일·사용자 영구 설정을 변경하지 않았다. 기존 연결은 유지했고 테스트용 bridge는 정리했다.
- 이 보고서를 반영하는 변경은 문서에 한정된다. 인증 토큰, 사용자 계정 정보, 원본 대화 로그는 커밋하지 않는다.
