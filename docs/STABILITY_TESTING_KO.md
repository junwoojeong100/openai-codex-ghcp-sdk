# 브릿지 안정성·복구 검증

[English](STABILITY_TESTING.md) · [구조](ARCHITECTURE_KO.md) · [새 검증 기록](validation/README_KO.md)

## 새 실모델 검증

새 전체 실행은 실행 전에 동결하는 v5 기준으로 11개 시나리오 × 6개 모델의 66건을 검증합니다. 실패를 포함한 기존 보고서는 과거 기록으로 보존하며 점수를 재사용하거나 실패 셀만 재실행하지 않습니다. [검증 기록](validation/README_KO.md)에서 구현과 계약을 구분합니다.

## 선택적 application-data 프로필과 현재 상태

기본값은 `v5`(`codex-ghcp-stability-11-v5`)입니다. `--profile application-data-v3`를 명시하면 `codex-ghcp-stability-11-application-data-v3`를 선택합니다. 이는 기존 application-data의 read/remember/recall 문구를 v5 기반에 적용한 별도 catalog ID·hash입니다. 두 프로필은 6개 모델·11개 시나리오·fixture·장애 주입·예산·literal-output·정리 판정이 같습니다. production 사용자 요청을 재작성하지 않습니다. 보고서·worker·artifact에 프로필 identity를 전달하며, 다른 프로필의 통과 셀 대입이나 `--verify --profile` 재채점을 거절합니다.

v5는 S03의 거절 경계만 바꿉니다. 정책 변경 제어 요청에서 도구 결과를 의도적으로 누락하고, 대기 상태를 잃지 않은 채 `tool_result_mismatch`를 반환해야 합니다. 올바른 결과가 모두 있으면 기존의 일괄 409 대신 안전한 설정 핸드오프를 허용합니다. `v4`/`application-data-v2`와 이전 프로필은 더 이상 선택할 수 없습니다. 해당 66건 또는 과거 77건 기록은 각 실행의 동결된 `source-snapshot/scripts/stability.mjs`로만 검증하며 v5로 재채점하거나 합산하지 않습니다.

최신 배포 전 확인에서 구현 `320d502c`의 기본 **v5 전체 행렬은 57/66(86.36%)**이며 Opus 5.5의 명시적 상위 필터 실패 9건과 종료 코드 1을 유지합니다. 나머지 5개 모델은 각각 11/11입니다. 별도 실제 TUI 행렬은 72/72이며 점수를 합산하지 않습니다. 두 보고서 모두 현재·동결 소스로 독립 검증했습니다. 요청된 '이상없으면 커밋·푸시' 조건은 충족하지 못했습니다. [증거와 커밋 조건](validation/2026-09-23-pending-handoff.json).

6개 모델 구현 `68f92d74`의 독립 전체 실측은 **v4 57/66(86.36%)**, **application-data-v2 63/66(95.45%)**입니다. 두 실행 모두 실패·`fullMatrixPassed=false`·종료 코드 1을 유지합니다. application-data-v2는 95% 참고 기준(63/66 이상)을 충족하지만, v4는 Opus 5.5의 읽기 턴이 모두 상위 필터에 걸려 미달입니다. 이후 freeform `apply_patch` 목록 변경(`54c7eb77`)은 이 행렬을 다시 돌리지 않고 별도 [실제 TUI 행렬](validation/2026-09-23-tui-scenarios/README_KO.md)로 검증했습니다. [결과·실행 이력·MCP 격리](validation/2026-09-23-six-model-switch/README_KO.md)를 참고하세요.

이전 터미널 통합 구현은 과거 7개 모델 v3/application-data-v1 계약에서 독립 전체 실측으로 **v3 66/77(85.71%)**, **application-data-v1 72/77(93.51%)**를 기록했습니다. 두 실행 모두 실패·`fullMatrixPassed=false`·종료 코드 1을 유지하며 이번에는 95% 목표도 미달입니다. [현재 결과·원인 분류·추가 실제 터미널 확인](validation/2026-09-22-terminal-integration/README_KO.md)을 참고하세요.

앞선 도구 메타데이터 수정 실행은 과거 7개 모델 v3 계약에서 **74/77(96.10%), Opus 9/11**로 당시 목표를 달성했습니다. 모델이 보는 메타데이터 변경과 3건의 실패는 해당 기록에 유지하며 현재 구현의 점수로 사용하지 않습니다. 더 앞선 두 50/77 및 v3 66/77 과거 기록도 별도 보존합니다. 기본 프로필·고정 계약·과거 실패를 바꾸거나 재채점하지 않습니다. [과거 목표 달성 실행](validation/2026-09-22-runner-repair/README_KO.md) · [앞선 추가 검증](validation/2026-09-22-fidelity-followup/README_KO.md).

```sh
# 계획만 출력, 모델 호출 없음
npm run test:stability -- --plan --profile application-data-v3
# 모의 SDK / 명시적 실모델 실행. 각각 새 디렉터리 사용
npm run test:stability -- --runtime --profile application-data-v3 --output .runtime/application-offline-new
npm run test:stability -- --execute --profile application-data-v3 --output .runtime/application-live-new
npm run test:stability -- --verify .runtime/application-live-new/report.json
```

## 범위와 실행 전 판정 기준

`codex-ghcp-stability-11-v5`는 **11개 시나리오 × 6개 모델 = 66건**의 별도 계약입니다. Codex **0.154.0**, Copilot SDK **1.0.14**를 사용합니다. 과거 18개 워크플로 v4 호환성 결과를 대체·재채점하지 않으며, 자동 케이스 재실행·모델 대체·부분 선택·OpenAI 기준선은 없습니다.

실검증 통과에는 실제 Codex app-server → 생산 Responses bridge → 실제 SDK → 정확한 모델 경로, 네이티브 fixture 도구 호출, 독립 판정과 자원 정리가 모두 필요합니다. 관찰용 프록시·계층이 아래 장애만 명시적으로 주입합니다. live 모드에서 SDK나 모델 출력을 대역으로 바꾸지 않습니다. 복제·거절·취소하는 제어용 HTTP 요청은 별도 실모델 셀로 세지 않습니다.

| ID | 시나리오 | 주입 조건 | 케이스 제한 |
|---|---|---|---:|
| S01 | 네이티브 읽기·유니코드 SSE·준비 상태 | 없음 | 90초 |
| S02 | pending 결과 반환 중 도구 순서 변경 | 도구 목록 순서만 변경 | 90초 |
| S03 | 결과가 누락된 정책 변경 거절 후 완전한 원래 요청 수락 | 도구 결과를 모두 누락한 제어 요청 1회 | 90초 |
| S04 | 결과 요청 재시도·중복 제출 방지 | 동일 HTTP 요청 1회 복제 | 90초 |
| S05 | 네이티브 작업 중 대기 요청 취소 | 제한된 SDK ACK 대기·연결 취소 | 120초 |
| S06 | 전체 요청 시간 제한 후 새 네이티브 턴 복구 | 45초 요청 제한·제한된 ACK 대기 | 180초 |
| S07 | 유휴 SDK 연결 상실·새 thread 복구 | 시험 소유 SDK만 강제 종료 | 150초 |
| S08 | 도구 결과 pending 중 SDK 상실·비재실행 | 소유 네이티브 callback 시점 SDK 종료 | 150초 |
| S09 | 상태 확정 전 스트림 불일치 거절 | SDK delta 메시지 ID 1개 손상 | 120초 |
| S10 | 새 프로세스 resume·도구 중복 방지 | 소유 host·bridge의 계획된 재시작 | 150초 |
| S11 | 도구 6회 왕복·장문 문맥·로컬 압축 | 12 KiB 이상 padding·명시적 네이티브 압축 | 240초 |

성공한 읽기·회상은 최종 답에 `value:`와 `receipt:`를 포함한 **완전한 두 literal 토큰**을 보존해야 합니다. 주변 설명·fence는 **표현 진단**으로 별도 기록하며 안정성 실패로 보지 않습니다. 이는 실검증 전에 명시한 새 계약이며, 호환성 시험(과거 v4, 현재 v5)의 정확한 출력 조건을 사후 완화하는 데 사용하지 않습니다. 접두사·값 손실, 불필요한 도구, 연결되지 않은 증거, 복구 실패는 여전히 실패입니다. 장애 턴은 지정된 오류로 실제 실패해야 하며 정답처럼 보이는 설명만으로 통과하지 못합니다.

모든 체크·증거를 충족해야 통과입니다. 실패·미지원·차단·시간 초과·미실행도 분모 **66**에 남습니다. 최대 4개 모델 lane, 케이스별 정리 예약 30초, 전체 강제 종료 제한 없음. 최악 스케줄 추정은 preflight 90초 + 1,470초씩 두 wave(6개 모델, 4개 lane) = **50분 30초**이며 OS·I/O 오버헤드는 별도입니다. **수시간 내구성 시험·제품 기능 지원율·모든 과거 먹통의 해결 인증이 아닙니다.**

## Fixture 도구 반환형식 메타데이터

네이티브 `read_fixture` 설명은 실제 반환형식을 명시합니다. 필드 값만 추출한 레코드가 아니라 UTF-8 파일의 전체 원문이며, 레이블과 구분자도 그 내용에 포함됩니다. 모든 모델과 두 프로필에 같은 도구 메타데이터를 전달하며 callback은 여전히 파일 원문을 네이티브 텍스트 결과로 반환합니다.

이는 모델이 보는 **도구 설명 문구**의 변경입니다. 사용자 프롬프트·fixture 값·스키마·장애 흐름·예산·판정기·생산 브릿지는 바꾸지 않습니다. 프로필 해시는 유지되고, 구현 해시와 동결 소스가 바뀐 설명을 구분합니다. 따라서 프로필 해시가 같다고 모든 모델 입력 메타데이터가 같은 것은 아닙니다. 효과는 새 전체 실행으로만 판단하며 과거 케이스의 설명과 결과는 기존 source snapshot에 보존합니다. 생산 브릿지가 호출자의 도구 설명이나 모델 출력을 보정하지는 않습니다.

## SDK 기본 지시 보존

브릿지는 SDK 기본 시스템 지시를 교체하지 않고, 클라이언트 지시문 전체를 원문 그대로 덧붙입니다. 설치된 SDK가 replace 모드의 보호 지시 제거를 명시하므로 프로토콜 적응 과정에서 기본 지시를 보존하도록 수정했습니다. 클라이언트 지시 삭제·SDK 기본 도구 허용·권한 자동 승인은 하지 않습니다. 모든 모델에 같은 운영 수정을 적용하며 프롬프트(v3·v4 동일)와 판정기는 그대로입니다. 새 전체 실검증 결과로만 성공 여부를 확인합니다.

## 과거 v3 프롬프트 명확화

모든 모델에 같은 프롬프트를 사용해 실제 작업이 비민감 합성 Unicode 표식을 복사하는 시험임을 설명합니다(과거 v3는 7개 모델, 현재 v4는 6개 모델에 같은 프롬프트 사용). 강한 plain-text-only 명령 대신 도구가 반환한 원래 두 줄을 text 코드 블록에 그대로 제시하도록 요청합니다. 기존 판정기는 원래부터 주변 fence를 허용했고 **변경하지 않았습니다**. 접두사 안에 공백을 넣으면 여전히 실패합니다. fixture·필수 도구 작업·안전 설정·실패 집계는 그대로이며, 상위 서비스가 필터링한 응답을 우회하거나 가공해 성공으로 만들지 않습니다.

아래 v2 운영 수정사항도 유지합니다.

## v2 수정사항과 반복 검증 원칙

v4의 분모 66건, 정확한 모델 라우팅, 원문 value/receipt 검사, 필요한 도구 실행, 장애 증거 및 정리 요구사항은 그대로입니다. 응답 가공·실패 제외·오프라인 점수 합산은 하지 않습니다. 다음 v2 변경을 실행 전에 명시합니다.

- 읽기·기억·회상 프롬프트 모두 원문 두 줄 그대로 출력을 명시합니다. 기억 단계도 지금 원문을 반환하고, **이번 턴에서 한 번** 새로 읽도록 요구합니다. 판정기를 완화하지 않고 지시문을 기존 판정 조건에 맞췄습니다.
- 작업별 정리 제한은 운영 기본값과 같은 **5,000ms**, 정리 예약 시간은 **30초**입니다. 정리 오류는 여전히 실패이며, 민감한 오류 원문 없이 abort/disconnect/delete 및 시간 초과/RPC 실패를 구분합니다.
- ACK 준비 대기는 **45초**이며 SDK 클라이언트 시작·카탈로그 초기화 제한은 **30초**입니다. 세션 생성에는 별도의 턴·요청 제한 시간도 적용되므로 ACK gate 도달을 가정하지 않고 실제 증거를 요구합니다. S06은 전체 요청 제한 **45초**, ACK gate 제한 **60초**로 의도한 요청 제한 시간이 먼저 적용됩니다. S05/S06 시나리오 제한은 120초/180초입니다.
- 감독자는 남은 시나리오 제한 안에서 최대 2초 동안 테스트 소유 프로세스 그룹의 비동기 종료를 기다립니다. 여전히 살아 있으면 실패입니다.

과거 v3 사용자 요청 목표는 **최소 74/77(96.1%)**이며 73/77은 95% 미만이었습니다. 현재 66건 v4 행렬에서 같은 95% 참고 기준은 최소 63/66(95.45%)입니다. 이 참고 기준은 `fullMatrixPassed`를 바꾸지 않으며, `fullMatrixPassed`는 66/66에서만 참입니다. 사용자 요청으로 이번 수정 전에 과거 검증 기록을 삭제했습니다. [이번 수정 기록](validation/2026-09-22-bridge-repair/README_KO.md)은 예비·최종 전체 실행을 실패와 시간 초과까지 각각 보존하며, 이전 셀을 조합해 최신 점수를 만들지 않습니다. 행렬 안에서 실패 셀만 골라 다시 실행하거나 다른 결과로 교체하지 않습니다.

## 명시적인 상위 서비스 필터 차단

루트 SDK `assistant.usage`의 `contentFilterTriggered=true` 또는 `finishReason="content_filter"` 신호는 `upstream_content_filter` 오류로 처리합니다. JSON 요청은 HTTP **422**, 이미 시작된 SSE는 HTTP 200 헤더를 유지하면서 **`response.failed`**로 끝나며 `response.completed`를 보내지 않습니다. 이미 전송한 부분 텍스트는 회수할 수 없고 미완료 상태로 남습니다.

거절처럼 보이는 문구가 아니라 SDK 구조화 신호만 사용합니다. 필터 해제·자동 추론 재시도·도구 결과 재제출·차단 턴의 성공 캐시는 하지 않으며, 실패한 세션 상태와 응답 참조를 무효화합니다. 이는 오류 보고 수정이지 상위 서비스 거절을 검증 통과로 바꾸거나 거절의 내부 원인을 확정하는 수정이 아닙니다. 현재 분모 66건과 판정기는 유지합니다.

## 구현한 복구 경계

- 도구 배열 순서가 아니라 identity로 동등성을 비교합니다. 대기 중 설정 변경은 모든 대응 결과와 지시문을 제외한 기존 이력의 일치를 요구합니다. abort·disconnect·delete와 같은 generation의 준비 상태 확인 후 교체하며, 완료 결과는 직렬화된 이력으로만 전달하고 결과 RPC를 반복하지 않습니다. 결과 누락·중복·불일치·대화 변조는 계속 거절합니다. 완료 ID와 응답 버전은 보존하지만 모델이 새 ID로 같은 작업을 제안할 수는 있습니다. 충돌 로그에는 원문 대신 요청 ID·변경 field·hash·개수만 남깁니다.
- SDK 제어 연결 `ping`으로 상실을 감지합니다. 공유된 복구 작업 하나가 시간 제한·backoff 안에서 **새 client generation**을 만들며 동시 요청마다 SDK를 중복 생성하지 않습니다. 잃은 대화는 무효화하고 연결 유실 이후 추론·불확실한 도구 결과를 자동 재전송하지 않습니다.
- 연결이 정상이라면 모델 진행 감시가 무응답 턴을 기존 응답 스트림에서 기본 한 번 복구할 수 있습니다. 입력 접수 확인, 출력·대기 호출 없음, 이전 세션 정리 확인이 필요합니다. 완료 이력은 문맥으로만 전달하며 완료된 도구 결과 RPC는 반복하지 않습니다. 부분 출력·필터·취소·불확실한 제출·정리 실패는 제외합니다. 진단에는 복구 시도·성공·구체적인 생략 이유가 남습니다. 이는 제한적인 추론 재전송이며 정확히 한 번 실행의 보장이나 외부 프로세스 재시작 감시가 아닙니다.
- 공개 `/health`는 **HTTP 프로세스 생존**이며 마지막 `ready`·`upstreamState`도 제공합니다. 인증된 `/readyz`는 제한 시간 안에서 SDK를 검사해 200/503을 반환하며 그 자체로 재연결하지 않습니다. 인증된 `/v1/models`는 필요하면 SDK 복구 후 목록을 제공합니다. 준비 상태는 모델 서비스·쿼터까지 보증하지 않습니다.
- 같은 대화의 FIFO 대기열에 상한·취소를 적용합니다. 취소한 대기 요청은 즉시 제거돼 나중에 실행되지 않습니다. 실행 중 요청의 취소는 먼저 반환하되, 자원 정리가 끝나기 전에는 같은 대화의 다음 작업을 시작하지 않습니다.
- 스트림 구조를 확인한 **뒤에** pending·history·retry 상태를 확정합니다. 정상 동일 요청 재시도는 캐시를 사용하지만, 스트림 프로토콜 불일치를 성공으로 캐시하지 않습니다. 네트워크 전달과 모델 실행을 완전한 exactly-once 트랜잭션으로 보증하는 것은 아닙니다.

### 운영 기본값

| 설정 | 기본값 | 의미 |
|---|---:|---|
| `TURN_TIMEOUT_MS` | 300000 | 모든 복구 시도·재설정이 공유하는 절대 모델 턴 예산 |
| `TURN_FIRST_PROGRESS_TIMEOUT_MS` | 180000 | 시도별 첫 진행 대기; 턴 시작 메타데이터·재시도 안내·keepalive는 초기화하지 않음 |
| `TURN_IDLE_TIMEOUT_MS` | 90000 | 실제 첫 진행 이후 무진행 제한; 루트 텍스트·추론·도구 입력·증가하는 SDK/루트 단계 바이트로 갱신 |
| `TURN_IDLE_RECOVERY_ATTEMPTS` | 1 | 요청당 최대 세션 복구 횟수; 정수 0–3, 0은 비활성화 |
| `REQUEST_TIMEOUT_MS` | 360000 | 대기열·SDK 작업·복구를 포함한 manager 요청; HTTP 본문 수신은 별도 |
| `MAX_REQUESTS_PER_SESSION` | 8 | 대화별 실행 중 + 대기 요청 수 |
| `MAX_REQUESTS` | 128 | 전체 실행 중 + 대기 요청 수 |
| `SDK_READINESS_TIMEOUT_MS` | 2000 | 로컬 SDK ping 제한 |
| `SDK_STARTUP_TIMEOUT_MS` | 30000 | SDK 시작·ping·모델 목록 초기화 및 세션 생성·모델 설정 RPC; 세션 설정에는 턴 제한도 적용 |
| `SDK_READINESS_INTERVAL_MS` | 15000 | 백그라운드 연결 검사·내용 없는 턴 감시 진단 간격; 턴 감시 간격은 무진행 제한 이하 |
| `SDK_RECOVERY_BACKOFF_MS` | 5000 | 실패한 복구 시도 간 최소 간격 |

`TURN_IDLE_RECOVERY_ATTEMPTS`만 0–3을 허용하고 나머지는 양의 정수입니다. 복구해도 절대 턴·전체 요청 제한은 초기화하지 않습니다. 기존 바이트·세션·정리 한도는 유지합니다. `copilot_idle_timeout`·`copilot_timeout`·`request_timeout`은 504, `request_queue_full`은 429, `upstream_session_lost`는 새 대화를 요구하는 409입니다. 부작용 있는 도구를 무조건 다시 실행하지 마세요. 업데이트를 적용하려면 연결된 Codex 세션을 먼저 닫고 프로젝트 소유 bridge를 재실행해야 합니다. 개발·검증 실행기는 사용 중인 bridge를 재시작하지 않습니다. `/health.turnWatchdog`는 소스 파일의 기본값이 아니라 실행 중인 설정을 표시합니다. background 상태에도 표시하지만 foreground 브릿지는 검색하지 않습니다.

## 명령과 증거

전용 pending-handoff 회귀 검사는 실제 Codex TUI·실행기·fixture MCP 서버·headless Playwright를 사용합니다. 모든 도구 결과를 반환하는 요청에 명시적으로 최상위 지시문 갱신을 주입하고, fixture 실행 1회·기존 결과 RPC 제출 0회·결과 원문 보존·`/new` 없는 같은 TUI의 다음 턴 성공을 요구합니다. 기본 runtime 검사는 SDK 대역을 사용합니다. live 옵션은 6개 모델 전체를 실행하고 새 디렉터리에 각 케이스 증거를 보존하며, 이 집중 회귀 검사는 66건 안정성 행렬 재실행과 다릅니다.

`pending-result-instruction-handoff-v2`는 기존 TUI marker 판정에 맞춰 샘플을 독립된 한 줄로 출력하도록 명시합니다. 최초 검사에서는 이 형식 요구가 빠져, 6개 모델 모두 핸드오프에 성공했지만 올바른 inline 답변 2건이 화면 검사에서 실패하고 다음 턴에 도달하지 못하여 4/6으로 남았습니다. 해당 실패 기록을 보존하고 재채점하지 않습니다. 수정 검사는 새 6개 모델 전체 실행을 요구하며 production 프롬프트나 출력을 재작성하지 않습니다.

```sh
node --test test/runtime/pending-handoff.test.mjs
GHCP_LIVE_HANDOFF_OUTPUT=.runtime/pending-handoff-live-new \
  node --test --test-concurrency=1 test/runtime/pending-handoff.test.mjs
```

핸드오프 정리·준비 상태를 확인하지 못하면 `session_handoff_failed`(503)입니다. 취소·연결 유실·대체 세션 실패 후에는 결과 재시도를 새 대화로 처리하지 않고 해당 대화를 유실 상태로 유지합니다. 결과 누락·불일치는 `tool_result_mismatch`(409), 기존 대화 변조는 `pending_session_changed`(409)로 거절합니다.

실패 보고서는 이제 `upstream-content-filter`, `literal-output`, `cleanup`을 원인 미확정 실패와 구분합니다. 필터 분류에는 실제 native Responses 오류 코드가 필요하며 거절처럼 보이는 문구·제어 요청·SDK 힌트만으로 판단하지 않습니다. 정리 실패를 우선 표시하고, 분류가 실패 판정·상태·분모·종료 코드를 바꾸지는 않습니다. 검증기는 증거로 분류를 다시 계산하며 과거 보고서는 동결된 검증기를 사용합니다. CI에서는 한 검사 실패가 이후 결과를 가리지 않도록 오프라인 검사를 나눠 실행하고 민감정보를 제거한 실패 진단을 artifact로 보존합니다.

```bash
npm test
npm run test:stability:stress       # 기계적 100회 반복, 모델 호출 없음
npm run test:compatibility:runtime # 기존 18개, 실제 Codex + SDK 대역
npm run test:stability:runtime     # 새 11개, 실제 Codex + SDK 대역
npm run test:stability -- --plan   # 오프라인 목록, 인증 접근 없음

# 명시적 실행: Copilot 인증 필요, 모델 사용량 발생
npm run test:stability -- --execute --output .runtime/stability-new-run
npm run test:stability -- --verify .runtime/stability-new-run/report.json
```

오프라인 stress는 도구 왕복 100회, 정확한 결과 재시도 100회, 대기 취소 10회, SDK 복구 10회, 상태 상한·마지막 listener/queue 정리를 검사합니다. 상태 전환을 빠르게 반복하는 검사이며 경과시간 기반 장기 인증은 아닙니다. 오프라인 통과를 실모델 통과로 합산하지 않습니다.

매 실행은 새 폴더를 사용하고 preflight 전에 소스·구현/계약 hash·판정 기준을 동결합니다. 네이티브 이벤트, SDK 메시지·사용량, HTTP/SSE, 표시된 제어 작업, 독립 체크, 케이스별 supervisor 정리 기록과 전체 행렬을 보존합니다. 검증기는 저장된 통과 flag를 믿지 않고 체크·메트릭·artifact 내용을 재계산합니다. 원시 로그는 ignored `.runtime`에 남기고 공유 전에 개인정보를 검토하세요. hash는 제3자 인증이 아닙니다.

소스 변경 후에는 과거 실행의 동결 소스로 검증합니다. 같은 의존성이 필요합니다.

```bash
node .runtime/stability-new-run/source-snapshot/scripts/stability.mjs \
  --verify .runtime/stability-new-run/report.json
```

종료 코드 **0**은 정상 plan·오프라인 전체 통과·실모델 66건 전체 통과, **1**은 유효한 증거의 미통과/미완료 실행, **2**는 인자·증거 오류입니다. 오프라인 11/11은 실모델 66/66이 아닙니다.

[Opus 진단](OPUS_DIAGNOSTICS_KO.md)은 fixture 요청이나 채점 행렬을 바꾸지 않고 상위 refusal 메타데이터를 대조합니다. 별도 대조군과 불완전한 관측은 행렬 결과에 섞지 않습니다.
