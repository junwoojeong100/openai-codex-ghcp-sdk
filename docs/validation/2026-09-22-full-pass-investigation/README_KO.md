# 전체 통과 후속 조사 - 2026-09-22

[English](README.md)

## 결과: 77/77은 아직 입증되지 않음

완료된 전체 행렬의 최고 실측은 `application-data-v1` 프로필 **74/77 (96.10%)**입니다. **77/77 목표는 미달성**입니다. 기준 커밋 [`fec3519ba89b6f7782318b3d583aa00ebba93d8c`](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/commit/fec3519ba89b6f7782318b3d583aa00ebba93d8c)은 이번 조사 전에 커밋·푸시되었습니다. 남은 실패는 명시적인 SDK 필터 신호가 발생한 Opus S10/S11과 literal 출력 보존에 실패한 Sonnet S05입니다.

이 기록은 새 전체 행렬이 아니라 **사전 선언된 비채점 native 진단 시도 47건**입니다. **32건은 각자의 원래 검사를 통과했고, 완전한 기록이 있는 14건은 실패했으며, 1건은 판정 불가**입니다. 원래 진단 요약의 실패 상태 15건에는 이 판정 불가 사례도 포함됩니다. 케이스 재시도는 없었고, 이번 조사에서 새 전체 77건 실행은 하지 않았습니다. 서로 다른 실험의 성공 셀을 합치거나 기존 74/77을 재채점하지 않습니다.

**모든 후보는 미채택 상태로 보존합니다.** 동결 기준 구현 해시는 `58405707a80c24da513f3db492ccdec845aecf81f3ed9f0c7374a713dd5f8384`입니다. 이 진단들로 main 소스를 변경하지 않았습니다. 이후 별도로 진행 중인 soak 개발과 여기서 검증한 과거 구현을 혼동하지 않습니다.

## 사전 선언 범위와 결과

| 진단 | 시도 | 통과 | 완전한 기록의 실패 | 판정 불가 | SDK 필터 이벤트 | 자체 동시 실행 상한 |
|---|---:|---:|---:|---:|---:|---:|
| 도구 반환 형식의 긍정형 설명 | 11 | 8 | 3 | 0 | 3 | 3 |
| 기준 Opus wire 관측 | 2 | 0 | 2 | 0 | 2 | 1 |
| A: 현재 요청을 인용 이력 밖에 배치 | 11 | 8 | 3 | 0 | 2 | 3 |
| B: 동일 작성자 user-only 투영 | 11 | 9 | 2 | 0 | 2 | 3 |
| 읽을 수 있는 SDK 도구 별칭 | 6 | 4 | 2 | 0 | 2 | 2 |
| 공개 SDK 작업 디렉터리 정렬 | 6 | 3 | 2 | 1 | 2 | 1 |
| **시도 목록 합계이며 행렬 점수가 아님** | **47** | **32** | **14** | **1** | **13** | - |

11건짜리 세 범위는 정확한 7개 모델의 S01에 Opus S10/S11, Sonnet S05, Haiku S11을 더한 구성입니다. 6건짜리 범위는 Astra S01, Opus S01/S10/S11, Sonnet S05, Haiku S11입니다. 별도 wire 관측은 Opus S10/S11만 실행했습니다.

모든 진단은 기존 `application-data-v1` 사용자 요청, fixture 생성과 바이트, 시나리오 예산, 모델 identity 및 원래 `evaluate()`/`readCase()` 판정을 유지했습니다. 시나리오에 원래 포함된 반복 턴, 도구 반환 후속 처리, 재개와 compaction은 재시도가 아닙니다. SDK foundation·권한·필터·reasoning 설정을 완화하지 않았습니다. 케이스별 정확한 상태, 실패 check ID, 실행·미실행 phase, 필터 플래그와 선언 범위는 [sanitizeddiagnostics.json](sanitizeddiagnostics.json)에 있습니다.

## 각 실험이 확인한 범위

| 실험 | 격리된 차이와 한정된 증거 | 한계 |
|---|---|---|
| 반환 형식 설명 | 복사본의 `read_fixture` 설명만 기존 `value:`/`receipt:` 접두사와 줄바꿈을 명시하도록 변경했습니다. 원래·후보 설명 문자열은 공개 JSON에 보존하되 생성된 fixture 값은 넣지 않았습니다. | Opus S01·S10·S11에 필터가 발생했습니다. 미채택입니다. |
| Opus wire 관측 | 원래 요청·응답 객체를 그대로 전달하면서 S10 recall과 S11 repeat-2의 native provider 거절 메타데이터를 관측했습니다. | 관측일 뿐 production 수정이 아닙니다. |
| A: 현재 요청 배치 | 복사본 `renderPrompt`만 마지막 실제 사용자 메시지를 기존 escaped 이력 envelope 밖으로 옮겼습니다. 모델 호출 없는 반례 검사에서 기준 구현은 해당 불변조건에 실패하고 A는 통과했으며, SDK send 해시로 실제 경로를 확인했습니다. | Opus S10 recall·S11 repeat-2 필터가 지속됐고 Sonnet S05도 literal 보존에 실패했습니다. |
| B: user-only 투영 | 복사본 `renderPrompt`만 연속 user-only 메시지를 두 줄바꿈으로 연결하여 기존 동일 사용자 multipart 정규화와 일치시켰습니다. 기준 구현과 A는 동등성 검사에 실패하고 B는 통과했습니다. 단일 메시지, Unicode·공백, 혼합 이력과 도구 데이터 경계를 보존했습니다. | Opus S10 recall·S11 repeat-2 필터가 지속됐습니다. Sonnet S05 한 번의 통과는 지속적인 해결 증거가 아닙니다. |
| 읽을 수 있는 별칭 | 복사본 `addTools`만 예약 접두사 `ghcp_` 뒤에 정제된 qualified name을 최대 24자 넣고 기존 128비트 해시 접미사를 유지했습니다. 네 접두사 충돌 그룹도 구분됐고, ASCII·최대 62자·function/custom 출력 복원·custom-only 권한 검사가 통과했습니다. | 기존 호출 상관관계도 이미 정확했습니다. 실제 매핑은 통과했지만 Opus S10 remember와 S11 repeat-2 필터가 남았습니다. |
| 작업 디렉터리 정렬 | 진단 wrapper가 공개 SDK 세션 설정에 `workingDirectory: executor.fixture.cwd`만 추가했습니다. 동결 production 소스는 기준과 동일하며, 기록된 공개 session-start cwd로 정렬을 확인했습니다. | 완전한 기록의 Opus S10/S11은 계속 필터링됐고, Astra S01의 모델 결과·정리 증거는 불충분합니다. |

계획·반례 검사·소스·driver 해시는 manifest에 보존했습니다. 작업 디렉터리 변경은 수정된 production 해시인 것처럼 표시하지 않고 진단 driver와 설정 차이로 식별합니다. 짧은 성공만으로 인과관계나 해결을 주장하지 않습니다.

## 거절 원인 범주는 직접 관측된 wire 사례에만 적용

완전한 기록에서 **명시적 SDK 필터 이벤트 13건**이 확인됐습니다. 그중 native provider 거절 4건에서 stop reason `refusal`, 범주 **`reasoning_extraction`**, 출력 토큰 0을 직접 관측했습니다. 대상은 wire 관측 실험의 Opus S10/S11과 작업 디렉터리 정렬 실험의 Opus S10/S11입니다.

이 범주는 **해당 네 wire 관측 사례에만** 게시합니다. 다른 필터 이벤트나 기존 74/77 행렬에 소급 적용하지 않습니다. provider가 보고한 범주는 숨겨진 reasoning 내용이나 합성 애플리케이션 요청이 그 범주에 걸린 이유를 입증하지 않습니다. 실제 필터는 계속 실패로 유지합니다.

## Astra 작업 디렉터리 진단은 계속 판정 불가

작업 디렉터리 정렬의 Astra S01에는 부분 자료만 있고, 최종 result manifest와 완전한 원래 검사 결과가 없습니다. 원래 supervisor 영수증은 **종료 코드 1, `processGroupGone=false`, `kill EPERM`**을 기록했습니다. 모델로 향한 inference를 관측하지 못했으므로 모델 결과와 실제 inference 횟수는 알 수 없습니다.

나중의 읽기 전용 확인에서는 기록된 native host PID가 존재하지 않았습니다. 하지만 이것으로 전체 owned process group의 정리를 입증할 수 없으므로 원래 실패와 정리 불확실성을 그대로 남겼습니다. 후속 우회 kill이나 재실행은 하지 않았고, 근본 원인은 **미확인**입니다. 정리가 확인된 것은 다른 **완전한 시도 46건**이며 47건 전체가 아닙니다.

## 시도 수·정상 workflow 요청 수·모델 호출 수는 다름

완전한 기록 46건에는 **SDK send 요청 97회, 도구 결과 제출 70회, SDK usage 이벤트 167건과 서로 다른 SDK API-call 식별자 167개**가 있습니다. 부분 Astra 기록에는 SDK send 1회가 추가로 보이지만 usage 이벤트가 없습니다. 이것은 실제 inference가 없었다는 증거가 아닙니다.

Wire observer는 **완전한 7개 사례에서 모델로 향한 inference 요청 31회**를 직접 기록했습니다. 이는 SDK usage 증거와 겹치며 167에 더할 별도 호출 수가 아닙니다. 모델 목록·제어 트래픽이나 정상 workflow 요청도 추가 진단 케이스로 세지 않습니다. 특히 불완전한 Astra 시도 때문에 47건 전체의 정확한 실제·과금 모델 호출 수는 **확정하지 않습니다**.

## 동결 증거 검증과 게시 경계

게시 과정에서는 동결 기준 소스로 기존 전체 보고서를 다시 검증하고, **최종 자료가 있는 진단 46건 모두 각자의 동결 소스로 `readCase()`를 다시 실행**했습니다. 누락된 Astra 최종 manifest를 재구성하거나 검증된 것처럼 취급하지 않았습니다. 여섯 사전 계획과 세 개의 모델 호출 없는 반례 검사 영수증도 확인했습니다. 소스 manifest로 격리된 변경 범위를 확인하고 원래 상태와 acceptance 검사를 유지했습니다.

현재 worktree 구현 해시로 과거 실행을 무효화하거나 인증하지 않습니다. 진행 중인 별도 soak 변경은 이 검증 범위 밖입니다. 게시 작업 자체의 **모델 호출은 0회**입니다.

| 자료 | 내용 |
|---|---|
| [sanitizeddiagnostics.json](sanitizeddiagnostics.json) | 전체 47개 시도, 사전 범위, 개수, 설정 차이, phase 및 관측된 필터 메타데이터 |
| [source-manifest.json](source-manifest.json) | 동결 기준 파일 해시, 후보별 변경 및 진단 driver 해시 |
| [evidence-manifest.json](evidence-manifest.json) | ignored 원시 증거의 SHA-256·바이트 수. 원시 내용은 미포함 |
| [verification.json](verification.json) | 동결 소스 검증 영수증과 불완전한 사례의 명시적 한계 |
| [audit.json](audit.json) | 게시 자료 무결성·로컬 링크·개인정보 검사 |

원시 증거는 ignored `.runtime/full-pass-20260922/`에 남아 있습니다. 게시 자료는 선별된 메타데이터·개수·해시·승인된 설정 차이·phase 결과뿐입니다. 원시 대화, 전체 system 지시, 인증정보, 생성된 fixture 값이나 개인 home 경로는 포함하지 않았습니다.

## 별도 endurance 작업은 사용자 요청으로 중지

별도의 **최소 5시간 실제 Codex 장기 턴·멈춤 시험**을 시작했으나, 한국 시간 2026-09-22 13:55에 사용자 요청으로 중지했습니다. 5시간을 완료하지 않았습니다. 장기검사 실행기·부분 로그·미완료 터미널 통합은 중단 상태로 보존하며 완료된 내구성 인증이 아닙니다. 이 짧은 진단들로 5시간 완주나 77/77 안정성을 인증하지 않습니다. 이번 커밋은 테스트 재개를 뜻하지 않습니다.
