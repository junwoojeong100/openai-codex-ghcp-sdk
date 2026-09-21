# Opus / Sonnet 대조 분석·소스 수정·재검증 — 2026-09-22

[English](README.md) · [검증 목록](../README_KO.md) · [재사용 진단 명령](../../OPUS_DIAGNOSTICS_KO.md)

## 결론

**Sonnet 성공 / Opus 실패 차이를 반복 재현했고, Opus 상위 응답의 구체적인 거절 분류를 확인했습니다.** 단순히 SDK의 `content_filter`라는 이름을 보고 추정한 결론이 아닙니다.

- 동일한 소유 fixture 요청·도구·low 추론 설정으로 SDK 직접 경로와 production manager 경로를 각각 두 번 비교: **Sonnet 4/4 원문 복사 성공, Opus 4/4 명시적 거절**. 두 번째 반복은 모델 실행 순서를 뒤집었습니다.
- Copilot의 Anthropic Messages 응답은 **`stop_reason: refusal`, `stop_details.category: reasoning_extraction`, 출력 토큰 0**을 반환했습니다. SDK는 같은 거절을 `finishReason: content_filter`로 요약합니다.
- 이전 전체 실행의 **S01 요청 payload의 필드·문구를 바꾸지 않고** production manager로 다시 보내도 같은 native 거절 범주를 확인했습니다. 이 진단은 점수에 포함하지 않습니다.
- 상위 서비스가 그렇게 분류했다는 사실은 확인했지만, 합성 도구 데이터의 복사 요청을 왜 추론 추출로 판단하는지는 확정하지 못했습니다. 사용자의 실제 의도나 약관 위반을 증명하는 분류도 아닙니다.

설치된 SDK 1.0.14의 `dist/generated/session-events.d.ts`도 Anthropic `refusal`을 OpenAI 용어 `content_filter`로 정규화한다고 명시합니다. 실제 `assistant.usage`에는 native category가 없었습니다. 따라서 오류 이름만 보던 분석을 model-layer 응답까지 확장했습니다.

별도의 세션 수명 결함을 소스에서 재현·수정했습니다. 그러나 **상위 거절 자체를 해결했다고 주장하지 않습니다.** 변경하지 않은 v3 전체 행렬 신규 결과는 **66/77 (85.71%)**입니다. 95% 목표는 **미달성**이며 최소 74/77이 필요합니다.

## 다각도 대조

| 확인한 가능성 | 실제 실험·소스 확인 | 해석 |
|---|---|---|
| 계정 권한·모델 가용성·추론 강도 오류 | 두 모델 모두 enabled, tool calls/streaming/adaptive thinking/low 지원. 실제 body도 low, adaptive, display omitted, temperature 1, max_tokens 32000 | 접근 거절이나 잘못된 effort 전송이라는 증거 없음 |
| 도구 이름 해시 변환 | 전체/축소 요청에서 해시 이름·원래 이름을 비교한 6개 Opus 진단 모두 필터 | 이름 복원이 해결책이라는 가설 기각; production 이름 변환은 유지 |
| 대화 JSON replay / 사용자 역할 변환 | history 없는 단일 SDK 사용자 요청도 거절. 이전 full Codex body도 동일 범주로 거절 | replay만으로 설명되지 않음 |
| SDK summary / streaming 옵션 | summary 생략과 none 모두 거절. SDK streaming false에서도 거절 | 해당 옵션 변경을 해결책으로 채택하지 않음. native 경로는 이 옵션에서도 실제 HTTP stream=true였음 |
| SDK 오류 이름 또는 SSE 파서의 오판 | 실제 HTTP 200 응답에서 native refusal/category를 직접 관찰. Chat Completions 경로에서는 content_filter 관찰 | 브릿지에서 만들어낸 거절 문구가 아님 |
| Opus의 도구 실행 자체 불능 | 별도 단순 도구 대조군은 호출 1회와 결과 반환 완료, 두 marker 값 보존 | 일반적인 tool calling 불능 아님. 재서식화로 exact-copy는 mismatch를 유지 |
| SDK의 모델별 system prompt 차이 | 모델 ID 외에 Opus 전용 JSON/tool-string 지침과 시각 차이 발견 | payload가 모델 ID만 다른 완전 동일 입력이라는 주장은 하지 않음 |
| Opus 전용 지침 하나가 원인인가 | 그 제한 지침을 Sonnet에도 **추가**한 별도 요청은 원문 복사 성공 | 지침 하나만으로 현상을 설명하기 어려움. 모델별 상호작용까지 배제한 것은 아님 |

SDK 기본 system prompt는 모델 정체성 외에 Opus에만 “객체 인자는 실제 JSON 객체로, 도구 인자 문자열에 XML/꺾쇠 markup을 넣지 말라”는 추가 지침을 포함했습니다. 이 조사에서는 SDK 보호 지시를 빼거나 Sonnet의 foundation으로 교체하지 않았습니다. 비교한 공개 프로토콜 헤더(Anthropic version, content type, SDK integration ID, user agent)는 같았습니다. 사용자 fixture 문구와 도구 스키마 해시도 비교 경로별로 같았습니다.

모델 목록 조회 후 native Messages 경로가 사용된 것도 확인했습니다. 모델 목록 조회 없이 만든 앞선 직접 진단은 Chat Completions 경로를 사용했습니다. 따라서 **도구 선언/메시지 수가 다른 공급자 형식을 하나의 JSON schema로 오해해서는 안 됩니다.** 상세 payload 차이와 공개 헤더는 [대조 증거](model-comparison.json)에 있습니다. 서비스 내부 분류기, 보이지 않는 정책, SDK 모델별 foundation의 상호작용은 이 저장소 소스만으로 확정할 수 없습니다.

## 소스에서 재현·수정한 결함

1. **handoff/idle 뒤 필터 신호 누락** — 필터 감시가 HTTP 턴 waiter에만 붙어 있었습니다. 도구를 Codex에 넘긴 뒤 필터가 오면 cached success나 pending 결과 재개가 가능했습니다. 감시를 SDK 세션 수명 전체로 옮겼습니다.
2. **응답 확정 경합** — turn settlement와 응답 확정 사이, 또는 캐시 응답 검증 중 필터가 오면 성공을 확정할 수 있었습니다. 확정 직전 fault를 다시 확인하고 세션·핸들을 무효화합니다.
3. **최초 원인 덮어쓰기** — 필터 뒤의 SDK 종료 오류가 첫 오류를 덮을 수 있었습니다. 최초 fault를 보존합니다.
4. **제한된 로그만 유지** — phase, pending 수, 결과 제출 횟수, 유효한 token 수와 구조화된 신호를 기록합니다. 프롬프트·인자·SDK 임의 문자열은 기록하지 않습니다.
5. **재현 도구 개선** — Chat Completions 및 Anthropic Messages refusal을 모두 읽는 선택적 wire observer를 추가했습니다. native cache read/write를 포함한 입력 토큰 합계, 목록 조회와 추론 요청 구분, 불완전 관측, 알려지지 않은 프로토콜을 구분합니다.

이전 소스에서 **새 회귀 테스트 6개가 실패**하는 것을 확인한 뒤 수정했습니다. 양성 대조·privacy·HTTP continuation·native 프로토콜 테스트까지 이번에 25개가 추가됐습니다. 기존 tool 실행 권한 거절, SDK foundation, 모델 목록과 low effort, 원본 fixture, 판정 기준은 바꾸지 않았습니다. 이미 Codex가 받은 출력이나 실행한 도구를 뒤늦게 취소할 수 있다는 주장도 하지 않습니다.

## 검증 결과

| 검증 | 결과 |
|---|---:|
| 시작 시 단위·회귀 테스트 | 223/223 |
| 최종 단위·회귀 테스트 | **248/248** |
| 실제 Codex + 모의 SDK 호환성 | **18/18** |
| 실제 Codex + 모의 SDK 안정성 | **11/11** |
| 별도 Opus/Sonnet 반복 대조 | Sonnet 4/4 성공, Opus 4/4 거절 |
| 기존 전체 실제 모델 행렬 | **66/77 (85.71%)** |

| Model | Passed |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 11/11 |
| gpt-5.6-luna | 11/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 0/11 |
| claude-sonnet-5 | 11/11 |
| claude-haiku-4.5 | 11/11 |

오프라인 스트레스도 도구 결과 100회, 동일 재시도 100회, 취소 10회, 세대 복구 10회를 통과했고 종료 후 queue/state/listener는 0입니다. 전체 실측에서는 77/77 정리 표시를 확인했습니다. timeout이나 supervisor 실패는 정리 표시와 무관하게 실패로 유지합니다. 실행 중 소스 불변: true; 사용자 설정 불변: true. 현재·동결 소스 검증 결과가 일치합니다.

## 실패와 진단 이력 보존

정식 행렬의 SDK 필터 관측과 별도 진단의 native refusal 사유는 구분합니다. 모든 실패 셀에서 native category를 직접 수집한 것처럼 소급해서 덧붙이지 않습니다. [실패 분석](failure-analysis.json)의 `upstreamCategoryInScoredRun:null`이 그 한계를 표시합니다.

첫 선택적 관찰기 실행은 Anthropic JSON을 읽었지만 Chat Completions 필드만 해석해 native stop details를 놓쳤습니다. 그 불완전한 보고서와 대조군 mismatch도 [진단 이력](opus-diagnostics.json)에 그대로 보존했습니다. 모델 목록 GET의 빈 body를 JSON으로 처리하던 임시 raw-probe 오류(추론 0회) 역시 로컬 증거에 남겼습니다. 이후 native-format 파서와 테스트를 보강하고 새 요청으로 재검증했습니다. 누락 증거를 성공으로 바꾸거나 과거 보고서를 수정하지 않았습니다.

## 증거와 재현

- [전체 77개 상태](summary.json) · [실패 분석](failure-analysis.json)
- [Opus/Sonnet 대조, payload 차이, 원본 요청 재현](model-comparison.json)
- [최종·예비 Opus 진단](opus-diagnostics.json) · [로컬 검사](local-checks.json)
- [현재/동결 소스 검증](verification.json) · [최종 감사](final-audit.json)
- [소스 해시](source-manifest.json) · [원시 증거 해시](evidence-manifest.json) · [설치 SDK 소스 검토](dependency-source-evidence.json)
- [이전 65/77·66/77 실행](../2026-09-22-bridge-repair/README_KO.md)은 그대로 보존했습니다.
- [상위 이슈용 요약 초안](UPSTREAM_REPORT.md) — 외부에 제출하지 않았습니다.

원시 자료: `.runtime/opus-analysis-20260922/`. 반복 대조 재현 스크립트는 그 폴더의 `compare-claude.mjs`, 추가 payload 분석은 `compare-claude-details.mjs`, 원래 S01 body 재현은 `replay-captured-opus.mjs`입니다. 재사용 가능한 최소 진단은 `npm run diagnose:opus -- --execute --output <새 디렉터리>`, 전체 실측은 `npm run test:stability -- --execute --output <새 디렉터리>`입니다. 둘 다 실제 모델 사용량이 발생하며 진단 결과를 행렬 셀로 바꾸지 않습니다.

계약 해시: `bcb5958d066a1628552f059aecd6e4fb04808acab0d0443ec70075df6e1b23fd`

구현 해시: `7cb34838fe930672c375fcf6a68e5c6bafb1ef07ddc253c6cb77f870f5a82402`
