# 검증 실행기 도구 설명 수정 및 실제 Codex 재검증 — 2026-09-22

[English](README.md) · [검증 목록](../README_KO.md) · [안정성 계약](../../STABILITY_TESTING_KO.md)

## 결과: 74/77 (96.10%), 95% 목표 달성

이 랩탑의 **공식 Codex CLI 0.154.0 `app-server` → 생산 브릿지 → 실제 Copilot SDK 1.0.14 → 지정 모델** 경로에서 `application-data-v1` **77건 전체를 새로 실행**했습니다. 결과는 **74건 통과, 3건 실패**로, 목표인 최소 74/77을 충족했습니다. 차단·미지원·시간 초과·미실행은 0건입니다.

**77/77 전체 통과는 아닙니다.** `fullMatrixPassed=false`와 실행·검증 종료 코드 **1**을 그대로 유지합니다. 사용자의 95% 목표와 실행기의 모든 셀 통과 조건은 다릅니다. 실패한 셀을 다시 실행하거나 이전 성공으로 교체하지 않았습니다.

| 실행 | 전체 | Opus |
|---|---:|---:|
| 이번 도구 설명 수정 후 `application-data-v1` | **74/77 (96.10%)** | **9/11** |
| 앞선 추가 실검증 — 별도 보존 | 50/77 (64.94%) | 9/11 |
| 이전 종료 기록 — 별도 보존 | 50/77 (64.94%) | 9/11 |
| 원래 v3 — 별도 보존, 이번에 실모델 재실행하지 않음 | 66/77 (85.71%) | 0/11 |

기본 프로필은 여전히 `v3`이며 이번 점수를 v3의 새 실측으로 대입하지 않습니다. 모의 SDK 검사와 별도 진단도 77건 점수에 합산하지 않습니다.

| 모델 | 이번 통과 |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 11/11 |
| gpt-5.6-luna | 11/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 9/11 |
| claude-sonnet-5 | 10/11 |
| claude-haiku-4.5 | 11/11 |

## 변경한 부분과 유지한 경계

변경한 실행 코드는 `scripts/stability/execute.mjs`의 **검증용 `read_fixture` 도구 설명 한 곳**입니다. 기존 설명은 “complete literal value and receipt”라고 했지만 반환형식이 전체 원문인지 추출된 필드 값인지 충분히 구분하지 않았습니다. 실제 callback은 UTF-8 파일 전체를 텍스트로 반환하므로 이를 명시했습니다.

```text
Read the owned UTF-8 fixture file once and return its entire plain-text contents unchanged. The result is text, not a record of extracted field values; labels and separators are part of the file content.
```

이는 **모델이 보는 도구 메타데이터를 바꾼 것**입니다. 입력 전체가 이전과 동일하다고 주장하지 않습니다. 같은 프로필 해시를 유지하지만 새 구현 해시·동결 소스가 바뀐 설명을 구분합니다. 공통 시스템 지시문 강화와 달리 이 설명을 제공한 진단 및 전체 실행에서 출력 보존 개선을 관측했습니다. 모델 내부의 해석 원리를 확정한 것은 아닙니다.

사용자 프롬프트, 도구 이름·입력 스키마, fixture 생성과 반환 문자열, 7개 모델, 11개 시나리오, 장애 흐름, 시간 제한, literal-output 판정기는 그대로입니다. **생산 `src/` 브릿지와 의존성은 수정하지 않았습니다.** 브릿지가 호출자의 도구 설명이나 모델 출력을 보정하지 않으며 SDK 기본 지시·권한 거절·필터 오류 전파도 유지합니다.

새 회귀 테스트는 두 프로필 × 7개 모델에 동일한 설명이 실제 네이티브 선언으로 전달되고, callback이 Unicode·공백을 포함한 전체 텍스트를 변경 없이 반환하는지 확인합니다. 수정 전 실패와 수정 후 통과 로그를 남겼습니다. [변경 범위 감사](change-audit.json)는 실행 코드가 정확히 그 설명 교체뿐임을 대조합니다.

## 검증 순서

먼저 독립 소스 복사본에서 후보를 선언·동결한 뒤 **7개 실제 모델의 S01을 각각 한 번** 실행했습니다. 모두 기존 13개 체크를 통과했고, 필터·재시도·자원 누수는 없었습니다. 이 진단은 전체 점수가 아닙니다.

설명 수정과 회귀 테스트를 반영한 후 아래 로컬 검사를 마쳤고, 그 다음 새 77건 실검증을 실행했습니다. 이번 전체 실행에는 자체 네이티브 모의 SDK 검사를 동시에 돌리지 않았습니다. 행렬 내부 병렬도는 원래대로 최대 4개 모델 lane입니다.

| 검사 | 결과 |
|---|---:|
| 직접 관련 회귀 | **44/44** |
| 전체 단위·회귀 | **267/267**, 실패·건너뜀·취소 0 |
| 실제 Codex + 모의 SDK 호환성 | **18/18** |
| 실제 Codex + 모의 SDK `application-data-v1` 안정성 | **11/11** |
| 실제 Codex + 모의 SDK 기본 v3 안정성 | **11/11** |
| 시나리오 설계·생성 문서·오프라인 스트레스 | 통과 |

위 로컬 검사들의 실제 모델 호출은 0회입니다. 스트레스는 도구 결과 100회, 동일 결과 재시도 100회, 대기 취소 10회, generation 복구 10회이며 잔여 queue/state/listener는 0입니다. 실제 모델을 쓴 7건 진단 및 77건 전체 실행은 별도 증거로 보존합니다.

## 남은 실패 3건

| 모델·시나리오 | 관측 |
|---|---|
| Opus S10 | `remember`는 원문을 보존했으나 새 프로세스 재개 후 `recall`에 명시적 SDK 필터 |
| Opus S11 | 이번에는 **첫 `repeat-1`의 도구 결과 반환 후** 명시적 SDK 필터. 성공한 데이터 턴이 없어 `final-values`도 실패하며, 반복·압축 단계는 완료하지 못함 |
| Sonnet S05 | 취소·도구 왕복·정리는 통과했지만 SDK 응답부터 `value:`·`receipt:` 레이블을 생략. 두 payload는 보존돼도 literal 판정은 실패 |

세 셀은 모두 실패로 유지합니다. 이번 행렬은 native refusal category를 수집하지 않았으며 이전 진단의 분류를 소급 적용하지 않습니다. **Opus 필터 문제 전체가 해결된 것은 아닙니다.**

이번 실행의 정리 계약, 최종 자원 정리 및 supervisor 프로세스 그룹 종료는 각각 **77/77**입니다. 앞선 실행의 정리 RPC 시간 초과 3건은 이번에 재현되지 않았지만 정리 코드를 고치거나 제한을 늘린 것은 아닙니다. 부하 분리와 SDK 지연 사이의 독립적 인과관계를 확정하거나 과거 실패를 취소하지 않습니다.

## 증거와 재현

[77건 결과](summary.json) · [남은 실패](failure-analysis.json) · [변경 범위](change-audit.json) · [진단 7건](diagnostics.json) · [로컬 검사](local-checks.json) · [현재/동결·과거 증거 검증](verification.json) · [최종 감사](final-audit.json) · [소스 해시](source-manifest.json) · [원시 증거 해시](evidence-manifest.json)

원시 자료는 ignored `.runtime/runner-repair-20260922/`에 보존했습니다. 게시 자료에는 원시 대화·공급자 시스템 프롬프트·인증정보가 없습니다. 현재와 동결 검증기가 같은 결과를 재계산했고, 앞선 두 50/77 실행은 각각 원래 동결 소스로 검증했습니다. 실행 중 소스·사용자 설정 불변도 확인했습니다.

```sh
# 이번 원본 증거 재검증: 74/77은 유효하지만 77/77이 아니므로 종료 코드 1.
node .runtime/runner-repair-20260922/live-01/source-snapshot/scripts/stability.mjs \
  --verify .runtime/runner-repair-20260922/live-01/report.json

# 새 실제 실행에는 새 폴더가 필요하며 Copilot 사용량이 발생합니다.
npm run test:stability -- --execute --profile application-data-v1 --output .runtime/application-repaired-new
```

실행 ID: `dc9d9eda-70d8-4a47-93ba-9172dce7377b`

실행: 한국 시간 **2026-09-22 10:27:56–10:35:24**, 약 7분 28초.

구현 해시: `58405707a80c24da513f3db492ccdec845aecf81f3ed9f0c7374a713dd5f8384`

프로필 계약 해시: `ae362ca209a9de118d4d6b74b6931c348ac0231e642023b1595e44766e37fc9a`

이 결과는 특정 11개 네이티브 시나리오의 단일 전체 실행입니다. 수시간 soak, 126건 실모델 호환성, 제품 전체 지원율이나 앞으로의 모든 실행에서 95%를 보장하는 결과가 아닙니다.

이전 기록: [추가 실패 경계 추적](../2026-09-22-fidelity-followup/README_KO.md) · [Opus 종료 기록](../2026-09-22-opus-closeout/README_KO.md).
