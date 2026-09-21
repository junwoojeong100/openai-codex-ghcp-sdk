# Opus 검증 종료 기록 — 2026-09-22

[English](README.md) · [검증 목록](../README_KO.md) · [안정성 계약](../../STABILITY_TESTING_KO.md)

## 최종 상태: 미해결, 사용자 요청으로 작업 종료

마지막 실제 검증 `application-data-v1`은 **50/77 (64.94%)**, Opus는 **9/11**입니다. **95% 목표와 전체 통과 모두 미달성**입니다. 사용자 요청에 따라 이 실행 이후 추가 모델 실험·재시도를 하지 않았습니다. 최종 로컬 점검의 추가 모델 호출은 0회입니다.

이 프로필은 도구의 반환 데이터를 표시하도록 요청 문구를 간결하게 작성한 **별도 검증 계약**입니다. 기존 v3의 최신 실측 **66/77 (85.71%), Opus 0/11**은 그대로 보존합니다. 두 결과의 통과 셀을 조합하지 않으며, 새 프로필의 일부 성공을 기존 거절 문제의 해결로 보고하지 않습니다. 기본 프로필은 여전히 `v3`입니다.

## 마지막 전체 실측

| 모델 | 통과 |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 2/11 |
| gpt-5.6-luna | 5/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 9/11 |
| claude-sonnet-5 | 11/11 |
| claude-haiku-4.5 | 1/11 |

- 전체 77건 실행 완료: 50건 통과, 27건 실패. 미실행·차단·시간 초과 셀은 없습니다.
- **Opus S10:** 새 프로세스에서 대화를 재개한 뒤 `recall` 요청에 명시적인 SDK 필터 신호가 발생했습니다.
- **Opus S11:** 첫 도구 왕복은 성공했지만 `repeat-2`에서 명시적인 SDK 필터 신호가 발생했습니다.
- 나머지 **25건은 `final-values` 실패**입니다. gpt-5.6-terra 9건, gpt-5.6-luna 6건, claude-haiku-4.5 10건에서 요구한 literal value/receipt 보존 조건을 충족하지 못했습니다. 이 실패를 서식 차이라는 이유로 통과 처리하지 않았습니다.
- 자원 정리 및 supervisor 프로세스 그룹 종료: 각각 **77/77**. 실행 중 소스·사용자 설정 불변 확인.

이번 채점 실행은 SDK 필터 메타데이터를 수집했으며 native refusal category는 수집하지 않았습니다. 이전 별도 진단에서 관측한 `reasoning_extraction`을 이번 두 실패 셀에 소급해서 확정하지 않습니다. 상세 관측은 [실패 분석](failure-analysis.json)을 참고하세요.

## 반영한 작업과 보존한 경계

앞선 브릿지 수정은 system/developer 지시와 assistant phase 보존, 도구 결과와 새 사용자 메시지 분리, pending 호출 identity 검증, idle까지의 완료 대기, 늦은 필터 감시와 최초 오류 보존을 포함합니다. SDK foundation과 권한 거절, 정확한 모델 라우팅은 유지했습니다.

이번 마지막 단계에서는 선택적 `application-data-v1` 프로필과 **서로 다른 프로필의 증거를 섞지 못하게 하는 검증**을 추가했습니다. 원래 `catalog.mjs`와 기본 v3 계약 해시는 변하지 않았습니다. 모델·fixture·장애 주입·예산·literal-output 판정도 유지했습니다. 브릿지가 실제 사용자 요청을 자동으로 재작성하지 않으며, 프로필 도입 전후 production `src/`는 같습니다.

짧은 문구의 단일 진단 성공은 반복·재개까지 보장하지 않았습니다. 최종 행렬은 이를 실패로 드러냈고, 전 모델 공통 대안으로 채택할 근거도 얻지 못했습니다. **새 프로필을 해결책이나 기본값으로 승격하지 않습니다.**

## 최종 로컬 점검

| 검사 | 결과 |
|---|---:|
| 단위·회귀 테스트 | **266/266** |
| 실제 Codex + 모의 SDK 호환성 | **18/18** |
| 새 프로필 실제 Codex + 모의 SDK 안정성 | **11/11** |
| 시나리오 설계·생성 문서 검사 | 통과 |
| 오프라인 스트레스 | 통과 |

스트레스는 도구 결과 100회, 동일 재시도 100회, 대기 취소 10회, generation 복구 10회이며 종료 후 queue/state/listener는 0입니다. 모의 SDK 및 오프라인 결과를 실모델 통과로 합산하지 않습니다. 현재 소스와 동결 소스의 증거 검증도 일치했습니다.

## 명시적 프로필 선택

아래는 재현용 문서이며, 작업 종료 후 새로 실행하지 않았습니다. `--execute`는 실제 모델 사용량을 발생시킵니다.

```sh
# 기본값: 원래 v3, 모델 호출 없는 계획
npm run test:stability -- --plan

# 별도 프로필 계획 / 모의 SDK 검사
npm run test:stability -- --plan --profile application-data-v1
npm run test:stability -- --runtime --profile application-data-v1 --output .runtime/application-offline-new

# 실제 전체 77건: 새 디렉터리만 사용
npm run test:stability -- --execute --profile application-data-v1 --output .runtime/application-live-new
npm run test:stability -- --verify .runtime/application-live-new/report.json
```

검증기는 보고서에 기록한 profile·catalog hash를 사용합니다. `--verify`에 `--profile`을 지정해 재채점할 수 없습니다. 소스 변경 후에는 해당 실행의 `source-snapshot` 검증기를 사용해야 합니다.

## 증거

[77개 전체 상태](summary.json) · [실패 분석](failure-analysis.json) · [프로필 정의와 차이](profiles.json) · [최종 로컬 검사](local-checks.json) · [채점 전 진단 요약](prior-diagnostics.json) · [현재/동결 소스 검증](verification.json) · [최종 감사](final-audit.json) · [소스 해시](source-manifest.json) · [원시 증거 해시](evidence-manifest.json)

이전 기록: [브릿지 수정](../2026-09-22-bridge-repair/README_KO.md) · [Opus/Sonnet 대조](../2026-09-22-opus-analysis/README_KO.md). 원시 자료는 ignored `.runtime/opus-resolution-20260922/`에 남겼으며 커밋·푸시에 포함하지 않습니다. 게시 자료는 요약·허용된 메타데이터·해시이며 계정 인증정보나 원시 대화 로그를 포함하지 않습니다. 이 결과는 수시간 soak나 제품 전체 신뢰성을 인증하지 않습니다.

실행 ID: `2ffc04e3-7d48-4c5a-9183-878092a56bf5`

실행 종료: `2026-09-21T23:34:30.349Z` (한국 시간 2026-09-22 08:34:30)

구현 해시: `74a337f0e2c388707393ba51da9b1c539d4bb37b0979395651e6e1760eff549f`

별도 프로필 계약 해시: `ae362ca209a9de118d4d6b74b6931c348ac0231e642023b1595e44766e37fc9a`
