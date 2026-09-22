# 브릿지·터미널 검증 실행기 통합

[English](README.md) · [검증 목록](../README_KO.md) · [터미널 실행 명령](../../SOAK_TESTING_KO.md)

## 결과

구현과 실행은 완료했지만 **두 실모델 행렬 모두 77/77은 아닙니다.** 최종 실행마다 정확한 7개 모델·변경하지 않은 11개 시나리오를 모두 실행했습니다. 실패 셀만 재실행하거나 다른 프로필의 성공 셀을 가져와 합산하지 않았습니다.

| 모델 | 기본 v3 | 별도 application-data-v1 |
|---|---:|---:|
| gpt-5.6-sol | 11/11 | 11/11 |
| gpt-5.6-terra | 11/11 | 11/11 |
| gpt-5.6-luna | 11/11 | 11/11 |
| gpt-6-astra | 11/11 | 11/11 |
| claude-opus-5 | 0/11 | 9/11 |
| claude-sonnet-5 | 11/11 | 8/11 |
| claude-haiku-4.5 | 11/11 | 11/11 |
| **합계** | **66/77 (85.71%)** | **72/77 (93.51%)** |

현재·동결 구현으로 독립 검증한 결과 모두 `evidenceIntegrity=true`입니다. 두 실행의 `fullMatrixPassed=false`와 종료 코드 1을 유지합니다. 이전의 독립 74/77 기록은 과거 결과이며 이번 구현의 점수로 사용하지 않습니다. 기존에 기록된 **95% 목표도 이번 최종 실행에서는 미달**입니다.

## 구현 변경

- 브릿지에 진행 기반 무응답 감시와 세션 설정 제한을 추가했습니다. 루트 추론·도구 입력 조각은 진행으로 인정하되 출력으로 노출하지 않습니다.
- soak worker에 실제 PTY lane을 연결했습니다. 저장소 명령 `test:terminal`과 `--terminal-driver playwright`는 모의 assistant 화면이 아닌 실제 xterm.js·PTY를 사용합니다.
- 두 드라이버가 PTY 수명·응답 판정을 공유합니다. SDK 모델·응답 대조, HTML·Python 소스 동결, 명시적 실모델 실행, 터미널·브라우저의 제한된 정리를 포함합니다.
- SDK 기본 지시·승인·샌드박스·모델 ID·11개 시나리오 계약·판정기는 유지했습니다. 필터 우회나 자동 추론 재시도를 추가하지 않았습니다.

## 추가 실검증에서 발견한 오류

첫 Astra 단독 PTY 실행은 SDK와 SSE가 올바른 완료 표식으로 끝났는데도 완료 시간 초과로 실패했습니다. Codex가 입력창 위에 ANSI 스크롤 영역을 설정했지만, 독립 터미널 파서가 이를 무시해 하단 영역을 갱신하면서 정상 표식을 지웠기 때문입니다.

실패하는 회귀 사례를 먼저 재현한 뒤 스크롤 여백·행 삽입/삭제·역방향 스크롤·alternate buffer의 여백 복원을 구현했습니다. **원래 실패한 터미널 바이트 그대로** 다시 해석하여 모델 출력을 바꾸지 않고 표식을 복구했으며, 동일 조건의 새 실모델 실행도 통과했습니다.

최초 실패는 [additional-live.json](additional-live.json)에 남습니다. 파서 수정 전 예비 v3 전체 행렬도 [preliminary-v3.json](preliminary-v3.json)으로 별도 보존합니다. 수정 뒤 최종 두 행렬을 처음부터 새로 실행했고, 예비 성공 셀을 재사용하지 않았습니다.

최종 정리 검토에서는 PTY가 예기치 않게 종료된 뒤 늦게 실패한 브라우저 입력 callback이 이미 닫힌 증거 파일에 쓰는 문제도 재현했습니다. 파일을 닫기 전에 probe의 중지 상태를 확정하도록 수정하고 결정적인 회귀 검사를 추가했습니다. 앞선 전체 실행은 [post-scroll-v3.json](post-scroll-v3.json)과 [post-scroll-application-data-v1.json](post-scroll-application-data-v1.json)에 남기며, 마지막 코드 변경 뒤 배포용 행렬도 모두 새로 실행했습니다.

이후 최대 허용 기간·입력 크기에서 사용하지 않을 프롬프트를 수 GiB씩 선할당하지 않도록 지연 생성으로 바꿨습니다. 메모리 할당 회귀와 새 장문 Playwright 실검증을 통과했습니다. 정리 수정 단계 행렬은 [post-cleanup-v3.json](post-cleanup-v3.json), [post-cleanup-application-data-v1.json](post-cleanup-application-data-v1.json)에 보존하고, 공개하는 최종 행렬은 지연 생성이 포함된 소스로 전체 실행했습니다. 여러 버전의 최고 점수만 골라 쓰지 않습니다.

## 남은 실모델 실패

- **기본 v3:** Opus 11건 모두 SDK의 명시적인 상위 서비스 필터 신호를 관측했습니다. 브릿지는 실패로 반환하고 자원을 정리했습니다.
- **application-data-v1의 Opus S10/S11:** 회상·반복 단계에서 상위 서비스가 필터링했습니다.
- **application-data-v1의 Sonnet S03/S07:** 실제 SDK 답변에서 필수 `value:`·`receipt:` 레이블이 빠졌습니다. 모델 출력을 재작성해 통과로 바꾸지 않았습니다.
- **application-data-v1의 Sonnet S11:** 필요한 6회 읽기 대신 `read_fixture` 1회만 관측했습니다. 기억한 값을 반환해도 6회 호출 판정을 만족하지 않습니다.

최종 실패 케이스도 자원·프로세스 그룹 정리 증거를 유지합니다. 상위 필터의 내부 원인이나 모델 행동의 보편적 정확성을 입증하는 결과는 아닙니다.

## 추가 확인

| 검사 | 결과·범위 |
|---|---|
| 오프라인 단위·제어 검사 | 317/317, 모델 호출 없음 |
| 네이티브 호환성 runtime | 18/18, SDK 대역 |
| 컨텍스트·TUI runtime | 8/8, SDK 대역 |
| 통합 PTY·Playwright runtime | 7/7, 시작된 터미널 취소·감독 정리·시작 실패 포함 |
| 안정성 runtime | v3 11/11, 실모델 점수와 별개 |
| 파서 수정 후 새 Astra PTY | 화면·SDK 응답·기간·정리 통과 |
| Sonnet Playwright, 24 KiB 입력·1,000단어 요청 | 실제 응답 크기·표식 대조 통과 |
| 네이티브 + Playwright 통합 smoke | 3개 lane 모두 완료, 관측 실패 없음 |
| 최종 네이티브 + PTY 통합 smoke | 3개 lane 모두 완료, 관측 실패 없음 |
| 의도적인 실모델 Playwright 취소 | 실제 추론 후 중단·프로세스 정리 확인. 부분 실행의 `passed=false`는 유지 |
| 최종 지연 생성 장문 Playwright | 전체 기간의 입력을 선할당하지 않는 경로에서 실모델 완료 확인 |

제한된 실행의 확인이며 **새로운 2시간·야간·5시간 무중단 인증이 아닙니다.** smoke 보고서의 5시간 `durationMet`는 의도적으로 참으로 만들지 않습니다.

## 증거와 재현

- [최종 v3 전체 77건·체크·artifact hash](final-v3.json)
- [최종 application-data-v1 전체 77건·체크·artifact hash](final-application-data-v1.json)
- [통합 요약](summary.json) · [추가 실검증](additional-live.json)
- [최종 소스 명세](source-manifest.json) · [로컬 검사](local-checks.json)

커밋한 JSON은 정제한 공개용 결과표이며 원시 `--verify` 입력은 아닙니다. 전체 SDK·네이티브·HTTP 증거는 명시된 ignored `.runtime` 폴더에 있고 해당 전체 증거로 검증했습니다. hash는 추적용이며 제3자 인증은 아닙니다.

```sh
npm ci
npx --no-install playwright install chromium
npm test
npm run test:terminal:runtime
npm run test:stability -- --execute --output .runtime/new-full-v3
npm run test:stability -- --execute --profile application-data-v1 --output .runtime/new-full-application
npm run test:stability -- --verify .runtime/new-full-v3/report.json
```

소스 변경 후에는 저장된 `source-snapshot/scripts/stability.mjs`로 검증하세요. 실검증에는 Copilot 사용량과 정확한 모델에 대한 접근 권한이 필요합니다.
