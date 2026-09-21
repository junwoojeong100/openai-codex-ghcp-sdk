# v4 미통과 셀 — 증거별 관측

[결과 요약](README_KO.md) · [English](FAILURES.md)

총 26개 미통과 셀입니다. 아래 파일 위치의 기준 경로는 `.runtime/workflows-18-v4-20260921/live/cases/<model>/<scenario>/`입니다. JSONL 행 번호는 원본 보존 파일 기준입니다. 원본은 로컬에 있으며 체크 결과·해시는 공개 요약에서 확인할 수 있습니다.

## gpt-5.6-sol / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.2`.
- 최종 JSON은 경계 오류 위치를 review.mjs의 1행으로 보고했습니다. 실제 번호가 붙은 파일 출력의 <= 루프와 고정된 기준은 3행입니다. C03.1은 통과했지만 C03.2는 실패로 유지합니다.
- 증거: `native.jsonl:15`, `native.jsonl:24`, `native.jsonl:28`, `native.jsonl:82`, `oracle.json#/checks` (C03.2).

## gpt-5.6-sol / C17

- Status: `failed`; original category: `undetermined`; failed checks: `C17.1`, `C17.2`.
- 첫 native spawnAgent가 "collab spawn failed: no thread with id"로 실패했습니다. 두 번째 spawn은 성공했고 자식 완료 대기·종료 후 부모도 nonce를 반환했습니다. 그러나 고정된 C17 조건은 한 번의 spawn과 그 호출의 상관관계를 요구하므로 C17.1·C17.2는 실패로 유지합니다. 모든 자식 에이전트 실행이 불가능하다는 뜻은 아닙니다.
- 증거: `native.jsonl:15`, `native.jsonl:22`, `native.jsonl:55`, `native.jsonl:60`, `transport.jsonl:2`, `transport.jsonl:3`, `transport.jsonl:6`, `transport.jsonl:7`, `native.jsonl:50`, `native.jsonl:81`, `oracle.json#/checks` (C17.1/C17.2).

## gpt-5.6-terra / C10

- Status: `failed`; original category: `undetermined`; failed checks: `C10.1`.
- 재개 후 응답에는 nonce가 남아 있지만 receipt 값은 nonce만 표시하여 원래 counter 결과의 "receipt:" 접두사를 잃었습니다. 정확한 값 복원 조건 C10.1은 실패했습니다. 새 SDK 세션과 counter 비재실행 조건 C10.2는 통과했습니다.
- 증거: `native.jsonl:76`, `native.jsonl:139`, `observation.json#/toolLedger/0/result`, `resume.json#/restart`, `oracle.json#/checks` (C10.1).

## gpt-5.6-terra / C17

- Status: `failed`; original category: `undetermined`; failed checks: `C17.1`, `C17.2`.
- 첫 native spawnAgent가 "collab spawn failed: no thread with id"로 실패했습니다. 두 번째 spawn은 성공했고 자식 완료 대기·종료 후 부모도 nonce를 반환했습니다. 그러나 고정된 C17 조건은 한 번의 spawn과 그 호출의 상관관계를 요구하므로 C17.1·C17.2는 실패로 유지합니다. 모든 자식 에이전트 실행이 불가능하다는 뜻은 아닙니다.
- 증거: `native.jsonl:15`, `native.jsonl:22`, `native.jsonl:64`, `native.jsonl:69`, `transport.jsonl:2`, `transport.jsonl:3`, `transport.jsonl:6`, `transport.jsonl:7`, `native.jsonl:59`, `native.jsonl:90`, `oracle.json#/checks` (C17.1/C17.2).

## gpt-5.6-luna / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.2`.
- 최종 JSON은 경계 오류 위치를 review.mjs의 1행으로 보고했습니다. 실제 번호가 붙은 파일 출력의 <= 루프와 고정된 기준은 3행입니다. C03.1은 통과했지만 C03.2는 실패로 유지합니다.
- 증거: `native.jsonl:28`, `native.jsonl:32`, `native.jsonl:102`, `oracle.json#/checks` (C03.2).

## gpt-5.6-luna / C04

- Status: `failed`; original category: `undetermined`; failed checks: `C04.1`.
- 함수 이름은 total()로 바뀌었지만 저장된 calc.mjs의 반환값은 1이며, 실제 node app.mjs 출력도 요구된 2가 아닌 1입니다. 완료했다는 최종 설명보다 파일·명령 증거를 우선해 실패로 유지합니다. 원문 patch 전달 조건 C04.2는 통과했습니다.
- 증거: `state.json#/after/calc.mjs/base64`, `native.jsonl:34`, `native.jsonl:187`, `oracle.json#/checks` (C04.1).

## gpt-5.6-luna / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- 표시된 503 이후 동일 요청의 네이티브 재시도 조건 C18.1은 통과했습니다. 그러나 모델이 secret.txt 내용 제공을 거절하고 파일 읽기 명령을 실행하지 않았습니다. 실제 읽기 1회와 정확한 nonce를 요구하는 C18.2는 전송 복구와 별개로 실패했습니다.
- 증거: `transport.jsonl:1`, `transport.jsonl:2`, `native.jsonl:26`, `oracle.json#/checks` (C18.2).

## claude-opus-5 / C07

- Status: `failed`; original category: `undetermined`; failed checks: `C07.2`.
- 거절 턴은 보호 상태를 유지하여 C07.1을 통과했습니다. 후속 허용 턴은 "The model returned no content because the response was blocked by content filtering"라는 메시지로 끝났고, 승인 수락·허용된 쓰기는 없었으며 allow.txt도 KEEP 그대로였습니다. 승인 우회가 아니라 허용 경로 미실행으로 C07.2를 실패로 유지합니다. 이 문구만으로 상위 서비스의 원인을 단정하지 않습니다.
- 증거: `native.jsonl:20`, `native.jsonl:33`, `native.jsonl:46`, `approvals.json`, `state.json#/protectedAfter/allow.txt/base64`, `oracle.json#/checks` (C07.2).

## claude-opus-5 / C11

- Status: `failed`; original category: `undetermined`; failed checks: `C11.1`.
- 실제 생산 launcher와 파일 읽기는 성공했지만 최종 응답이 nonce 앞에 설명과 코드 fence를 덧붙였습니다. 파일 내용만 정확히 반환해야 하는 C11.1은 실패했고, 기본 설정·정리 조건 C11.2는 통과했습니다. 실행기 시작 실패가 아니라 정확한 출력 조건 실패입니다.
- 증거: `native.jsonl:5`, `native.jsonl:6`, `launcher.json#/command`, `oracle.json#/checks` (C11.1).

## claude-opus-5 / C14

- Status: `failed`; original category: `undetermined`; failed checks: `C14.2`.
- 네이티브 압축 C14.1은 통과했지만 재개 후 최종 메시지는 nonce 대신 "The model returned no content because the response was blocked by content filtering"였습니다. C14.2는 실패로 유지합니다. 이는 관측된 응답 문구이며 상위 서비스 필터의 내부 원인을 별도로 진단한 결과는 아닙니다.
- 증거: `native.jsonl:15`, `native.jsonl:28`, `native.jsonl:41`, `native.jsonl:79`, `compaction.json#/inputBytes`, `observation.json#/restart`, `oracle.json#/checks` (C14.2).

## claude-opus-5 / C15

- Status: `failed`; original category: `undetermined`; failed checks: `C15.2`.
- 실행 중 명령 중단·소유 프로세스 종료·백그라운드 터미널 정리와 같은 thread의 후속 읽기는 확인됐습니다. 그러나 최종 응답에 설명과 코드 fence가 추가되어 C15.2의 정확한 출력 조건을 충족하지 못했습니다. 이 기록은 중단·프로세스 정리 실패를 뜻하지 않습니다.
- 증거: `native.jsonl:23`, `native.jsonl:31`, `native.jsonl:40`, `interruption.json#/processGone`, `oracle.json#/checks` (C15.2).

## claude-opus-5 / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- 표시된 503 후 재시도는 성공했고 SDK 프롬프트 1회·실제 파일 읽기 1회가 확인됐습니다. 최종 nonce에 인라인 백틱이 추가되어 C18.2의 정확한 출력 조건이 실패했습니다. 프롬프트·도구 중복 실행은 관측되지 않았습니다.
- 증거: `native.jsonl:15`, `native.jsonl:24`, `retry.json#/transport`, `sdk.jsonl`, `oracle.json#/checks` (C18.2).

## claude-sonnet-5 / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.2`.
- fence 안의 JSON과 리뷰 필드 자체는 허용된 형식이며 올바릅니다. 그러나 추가된 잘못된 루프를 포함하는 실제 미커밋 diff 증거가 없습니다. 커밋이 하나인 fixture에서 HEAD~5 또는 HEAD^ 이력을 요청했고, 출력에는 알 수 없는 revision 오류가 기록됐습니다. 현재 소스 읽기와 정답만으로 diff 증거를 대체하지 않아 C03.2는 실패했습니다.
- 증거: `native.jsonl:15`, `native.jsonl:29`, `native.jsonl:50`, `native.jsonl:83`, `oracle.json#/checks` (C03.2).

## claude-sonnet-5 / C08

- Status: `failed`; original category: `undetermined`; failed checks: `C08.1`, `C08.2`.
- 기록된 명령은 "cd <workspace> && node sandbox-probe.mjs" 1회입니다. 실제 probe 출력은 allowed=true·outsideDenied=true·networkDenied=true이고, allowed.txt는 OK, 보호 상태는 불변, 네트워크 연결도 0입니다. 그러나 고정된 oracle의 safeApprovalCommand가 이 복합 명령을 인식하지 못해 probe 목록이 비었고 C08.1·C08.2가 실패했습니다. 샌드박스 탈출 증거가 아닌 명령 인식 범위의 한계이며 실행 후 기준을 넓히지 않았습니다.
- 증거: `native.jsonl:15`, `native.jsonl:61`, `sandbox.json#/preflight/measured`, `resources.json#/networkConnections`, `state.json#/after/allowed.txt/base64`, `oracle.json#/checks` (C08.1/C08.2).

## claude-sonnet-5 / C10

- Status: `failed`; original category: `undetermined`; failed checks: `C10.1`.
- 재개 후 nonce는 보존했지만 원래 counter 결과의 "receipt:" 접두사를 잃었습니다. 정확한 값 복원 조건 C10.1은 실패했고, 새 SDK 세션과 counter 비재실행 조건 C10.2는 통과했습니다.
- 증거: `native.jsonl:15`, `native.jsonl:47`, `native.jsonl:77`, `observation.json#/toolLedger/0/result`, `resume.json#/restart`, `oracle.json#/checks` (C10.1).

## claude-sonnet-5 / C11

- Status: `failed`; original category: `undetermined`; failed checks: `C11.1`.
- 실제 생산 launcher와 파일 읽기는 성공했지만 최종 응답이 nonce 앞에 설명과 코드 fence를 덧붙였습니다. 파일 내용만 정확히 반환해야 하는 C11.1은 실패했고, 기본 설정·정리 조건 C11.2는 통과했습니다. 실행기 시작 실패가 아니라 정확한 출력 조건 실패입니다.
- 증거: `native.jsonl:5`, `native.jsonl:7`, `native.jsonl:8`, `launcher.json#/command`, `oracle.json#/checks` (C11.1).

## claude-sonnet-5 / C12

- Status: `failed`; original category: `undetermined`; failed checks: `C12.2`.
- 네이티브 리뷰 생명주기는 완료됐고 review.mjs:3-3의 올바른 finding 1건과 실제 잘못된 diff도 있습니다. 그러나 끝에 "git status --porcelain | grep ..."가 붙은 복합 셸 명령의 최종 종료코드는 1입니다. C12.2는 종료코드 0인 diff 명령을 요구하므로 실패로 유지합니다. 렌더링된 리뷰 finding 자체는 파서가 정상적으로 인식했습니다.
- 증거: `native.jsonl:51`, `native.jsonl:56`, `oracle.json#/checks` (C12.2).

## claude-sonnet-5 / C15

- Status: `failed`; original category: `undetermined`; failed checks: `C15.2`.
- 실행 중 명령 중단·소유 프로세스 종료·백그라운드 터미널 정리와 같은 thread의 후속 읽기는 확인됐습니다. 그러나 최종 응답에 설명과 코드 fence가 추가되어 C15.2의 정확한 출력 조건을 충족하지 못했습니다. 이 기록은 중단·프로세스 정리 실패를 뜻하지 않습니다.
- 증거: `native.jsonl:23`, `native.jsonl:31`, `native.jsonl:41`, `interruption.json#/processGone`, `oracle.json#/checks` (C15.2).

## claude-sonnet-5 / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- 표시된 503 후 재시도는 성공했고 SDK 프롬프트 1회·실제 파일 읽기 1회가 확인됐습니다. 최종 nonce에 설명과 코드 fence이 추가되어 C18.2의 정확한 출력 조건이 실패했습니다. 프롬프트·도구 중복 실행은 관측되지 않았습니다.
- 증거: `native.jsonl:15`, `native.jsonl:26`, `retry.json#/transport`, `sdk.jsonl`, `oracle.json#/checks` (C18.2).

## claude-haiku-4.5 / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.1`.
- 응답 경로는 "./src/주문 계산.mjs"이며 C03.1의 정확한 문자열 조건은 "src/주문 계산.mjs"입니다. 실제 파일·행·값·빈 파일 판정과 C03.2의 diff 리뷰는 증거가 있습니다. 엄격한 경로 문자열 불일치이지 파일을 찾거나 이해하지 못했다는 증거는 아니지만, 기존 기준대로 실패를 유지합니다.
- 증거: `native.jsonl:15`, `native.jsonl:24`, `native.jsonl:33`, `native.jsonl:44`, `native.jsonl:46`, `native.jsonl:50`, `native.jsonl:54`, `native.jsonl:58`, `native.jsonl:97`, `oracle.json#/checks` (C03.1).

## claude-haiku-4.5 / C06

- Status: `failed`; original category: `undetermined`; failed checks: `C06.2`.
- alpha 네임스페이스 함수 호출과 MCP 리소스·selected 조회는 확인됐습니다. 그러나 먼저 key="missing"으로 호출해야 하는 오류 경로를 건너뛰어 MCP lookup은 selected 1회뿐입니다. ENOENT에서 성공으로 복구하는 순서가 없어 C06.2가 실패했고 C06.1은 통과했습니다.
- 증거: `native.jsonl:27`, `native.jsonl:36`, `native.jsonl:55`, `native.jsonl:142`, `mcp.json#/ledger`, `oracle.json#/checks` (C06.2).

## claude-haiku-4.5 / C10

- Status: `failed`; original category: `undetermined`; failed checks: `C10.1`.
- 재개 후 nonce는 보존했지만 원래 counter 결과의 "receipt:" 접두사를 잃었습니다. 정확한 값 복원 조건 C10.1은 실패했고, 새 SDK 세션과 counter 비재실행 조건 C10.2는 통과했습니다.
- 증거: `native.jsonl:15`, `native.jsonl:60`, `native.jsonl:100`, `observation.json#/toolLedger/0/result`, `resume.json#/restart`, `oracle.json#/checks` (C10.1).

## claude-haiku-4.5 / C11

- Status: `failed`; original category: `undetermined`; failed checks: `C11.1`.
- 실제 생산 launcher와 파일 읽기는 성공했지만 최종 응답이 nonce 앞에 설명과 코드 fence를 덧붙였습니다. 파일 내용만 정확히 반환해야 하는 C11.1은 실패했고, 기본 설정·정리 조건 C11.2는 통과했습니다. 실행기 시작 실패가 아니라 정확한 출력 조건 실패입니다.
- 증거: `native.jsonl:5`, `native.jsonl:6`, `launcher.json#/command`, `oracle.json#/checks` (C11.1).

## claude-haiku-4.5 / C14

- Status: `failed`; original category: `undetermined`; failed checks: `C14.2`.
- 네이티브 로컬 압축과 새 프로세스·세션 재개가 완료됐고, 재읽기 없이 기억한 nonce가 응답에 있습니다. 그러나 "ACK"·설명·코드 fence를 추가하여 nonce만 요구하는 C14.2는 실패했습니다. 기억한 값이 사라졌다는 증거는 아닙니다.
- 증거: `native.jsonl:15`, `native.jsonl:33`, `native.jsonl:46`, `native.jsonl:95`, `compaction.json#/inputBytes`, `observation.json#/restart`, `oracle.json#/checks` (C14.2).

## claude-haiku-4.5 / C15

- Status: `failed`; original category: `undetermined`; failed checks: `C15.2`.
- 실행 중 명령 중단·소유 프로세스 종료·백그라운드 터미널 정리와 같은 thread의 후속 읽기는 확인됐습니다. 그러나 최종 응답에 설명과 코드 fence가 추가되어 C15.2의 정확한 출력 조건을 충족하지 못했습니다. 이 기록은 중단·프로세스 정리 실패를 뜻하지 않습니다.
- 증거: `native.jsonl:23`, `native.jsonl:37`, `native.jsonl:39`, `native.jsonl:53`, `interruption.json#/processGone`, `oracle.json#/checks` (C15.2).

## claude-haiku-4.5 / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- 표시된 503 후 재시도는 성공했고 SDK 프롬프트 1회·실제 파일 읽기 1회가 확인됐습니다. 최종 nonce에 설명과 코드 fence이 추가되어 C18.2의 정확한 출력 조건이 실패했습니다. 프롬프트·도구 중복 실행은 관측되지 않았습니다.
- 증거: `native.jsonl:15`, `native.jsonl:28`, `retry.json#/transport`, `sdk.jsonl`, `oracle.json#/checks` (C18.2).
