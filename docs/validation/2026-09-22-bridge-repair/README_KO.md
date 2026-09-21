# 브릿지 구현 수정 및 신규 검증 — 2026-09-22

[English](README.md) · [검증 목록](../README_KO.md) · [안정성 계약](../../STABILITY_TESTING_KO.md)

## 결과

변경하지 않은 v3 11개 시나리오 × 7개 모델 전체 결과는 **66/77 (85.71%)**입니다. 95% 이상 목표에는 74/77이 필요하며 **미달성**입니다. 모델 제외·대체·재채점을 하지 않았고 실패 셀만 재실행하여 점수를 바꾸지 않았습니다. 전체 77건 합격: **false**.

| Model | Passed |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 11/11 |
| gpt-5.6-luna | 11/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 0/11 |
| claude-sonnet-5 | 11/11 |
| claude-haiku-4.5 | 11/11 |

case artifact의 정리 표시는 77/77건입니다. 이 표시가 있어도 supervisor 제한 시간을 초과하면 실패로 유지합니다. 실행 중 소스·사용자 설정 불변: true / true. 현재 소스와 동결 소스 양쪽 검증기가 증거 무결성을 확인했습니다. 제한된 회귀·장애 주입 검증이며 장시간 soak나 제품 지원율을 뜻하지 않습니다.

## 확인한 구현 원인과 수정

| 수정 전 | 구현 수정 |
|---|---|
| 대화 중간 system/developer 지시문을 사용자 이력 문맥으로 전달 | 모든 최상위 지시문을 SDK append 채널로 모으고 pending 중 정책 변경은 거절 |
| assistant phase 손실 및 도구 데이터의 이력 구분자 간섭 | commentary/final_answer 보존, 구분자 문자의 무손실 이스케이프 |
| 새 사용자 문맥을 도구 출력에 이어 붙임 | 별도 immediate 사용자 메시지를 보낸 뒤 도구 결과 원문 반환 |
| 중간 turn_end에서 텍스트 완료 가능 | session.idle까지 기다려 뒤늦은 사용량·오류·보정 수집, 빈 응답 실패 처리 |
| 구형 하위 이벤트와 pending 호출 불일치가 루트 상태에 섞일 수 있음 | 두 하위 이벤트 형식 제외, request/session/name/arguments 대조 |
| S05 ACK 대기가 상위 오류를 가림; 선언된 정리 예산을 사용하지 않음 | 원본 스트림 전달과 probe 병행, 취소 복사본 정리, 기존 bounded 예산 적용 |

모의 SDK도 실제 SDK처럼 immediate 메시지를 pending 결과가 도착할 때까지 대기하도록 수정했습니다. C15/C17 판정 조건은 바꾸지 않았습니다. SDK 시스템·보호 지시, 권한 요청 거절, 모델 목록, 요청 추론 강도, 명시적 필터 오류 처리를 유지했습니다. 추론 요약 비활성화도 유지했습니다. 과거 역할 replay는 여전히 근사 변환이며 [호환성 한계](../../COMPATIBILITY_KO.md)를 참조하세요.

## 회귀 검증

- 시작 상태: 195/202 통과. 기존 검증 러너 회귀 테스트 7개 실패.
- 새 회귀 테스트 19개는 구현 수정 전 모두 실패했고, 모의 SDK의 steering 조기 실행을 재현하는 테스트 2개도 추가했습니다.
- 구현 수정 후 **223/223 통과**, 건너뜀·취소 없음.
- 실제 Codex + 모의 SDK: 호환성 **18/18**, 안정성 **11/11**. 실제 모델 호출은 0회입니다.
- 오프라인 스트레스: 도구 결과 100회, 동일 재시도 100회, 대기 취소 10회, generation 복구 10회. 종료 후 상태·대기열·리스너 0.
- 별도 실제 SDK 진단: 사용자 메시지 분리, 도구 결과 원문, 동일 재시도에도 결과 제출 1회, 두 합성 표식의 응답 반영을 확인했습니다. 77건 점수에는 포함하지 않습니다.

## 남은 실패

11건이 실패했으며 11건에서 루트 SDK의 명시적인 필터 신호가 관측됐습니다. 모두 실패로 유지합니다. 이것만으로 필터의 근본 원인을 확정하거나 브릿지에 남은 결함이 없다고 결론 내리지 않습니다. 위 구현 결함은 별도로 재현·수정·검증했으며, 상위 필터까지 해결했다고 주장하지 않습니다.

| 모델 | 시나리오 | 상태 | 관측 증거 |
|---|---|---|---|
| claude-opus-5 | S01 | failed | explicit SDK content_filter |
| claude-opus-5 | S02 | failed | explicit SDK content_filter |
| claude-opus-5 | S03 | failed | explicit SDK content_filter |
| claude-opus-5 | S04 | failed | explicit SDK content_filter |
| claude-opus-5 | S05 | failed | explicit SDK content_filter |
| claude-opus-5 | S06 | failed | explicit SDK content_filter |
| claude-opus-5 | S07 | failed | explicit SDK content_filter |
| claude-opus-5 | S08 | failed | explicit SDK content_filter |
| claude-opus-5 | S09 | failed | explicit SDK content_filter |
| claude-opus-5 | S10 | failed | explicit SDK content_filter |
| claude-opus-5 | S11 | failed | explicit SDK content_filter |

## 앞선 전체 실행과 제한된 진단

첫 전체 실행은 **65/77**이었습니다. Opus 11건 실패 외에 gpt-5.6-luna/S07은 case artifact가 26초 만에 통과해도 프로세스 종료가 늦어 supervisor 제한 시간을 초과했습니다. 이를 통과로 바꾸지 않고 **timed-out으로 유지**합니다. 늦은 종료의 원인은 아직 미확정이며, 별도 3회·추론 0회 SDK 연결 손실/복구 진단에서는 잔여 Node 핸들이 재현되지 않았습니다. 첫 실행도 보관하고 동결 소스로 검증하여 summary.json에 기록했습니다. 모의 SDK 수정과 테스트 2개 추가 뒤 실패 셀만이 아니라 77건 전체를 새로 실행했습니다. 두 실측 실행 사이 production 소스와 판정 조건은 동일합니다.

Opus의 단순 산술 질문은 SDK 직접 호출과 production manager 양쪽에서 성공했습니다. 전체 클라이언트 지시문만 추가하거나 전체 7개 도구 목록만 추가한 산술 질문도 성공했습니다. 반면 동일한 fixture 요청과 fixture 도구 하나만 사용해도, 대화 replay 없는 단일 사용자 메시지에서 명시적 필터가 재현됐습니다. 재현 범위를 좁혔지만 요청의 어느 요소 또는 도구 호출 단계가 원인인지는 아직 확정하지 못했습니다. 브릿지 무결함의 증거로 보지 않습니다. 축소 요청은 진단 전용이며 77건 점수에 포함하지 않고, SDK 보호 지시·필터 정책·권한 거절도 유지했습니다.

## 재현 가능한 증거

- [요약 및 77건 상태](summary.json)
- [현재/동결 소스 검증](verification.json)
- [재채점하지 않은 실패 관측](failure-analysis.json)
- [로컬 검증과 별도 실제 SDK 진단](local-checks.json)
- [동결 소스 해시](source-manifest.json) · [원시 증거 해시](evidence-manifest.json)

로컬 원시 자료는 `.runtime/bridge-repair-20260922/`에 있습니다. 삭제된 과거 검증 문서는 복원하지 않았습니다. 계약 해시: `bcb5958d066a1628552f059aecd6e4fb04808acab0d0443ec70075df6e1b23fd`. 구현 해시: `9d261cf6bef109968c8c72586b421fbd964f785c24eeef85af8af7389bbb1379`.
