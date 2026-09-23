# 실제 Codex TUI 시나리오(Playwright headless)

[English](TUI_SCENARIOS.md) · [검증 안내](../README_KO.md#개발과-검증) · [안정성 계약](STABILITY_TESTING_KO.md) · [터미널·내구성 검사](SOAK_TESTING_KO.md)

`codex-ghcp-tui-12-v3`는 **실제 Codex TUI → 운영 브릿지 → Copilot SDK → 지정 모델** 연결을 검증합니다. **12개 시나리오 × 6개 모델 = 72건**을 유지하며 안정성·호환성·이전 TUI 결과와 합산하지 않습니다. 목표는 **변경되지 않은 구현의 전체 실검증 한 회에서 95% 이상, 즉 69/72건 이상 통과**입니다. v3는 첫 진행·스트리밍 제한의 분리를 추가로 요구하며 이전 결과는 당시 동결 소스로만 검증합니다.

## 준비와 실행

`npm ci` 후 저장소 루트에서 계획을 확인합니다. 기본 동작이며 Codex·브라우저 설치나 Copilot 로그인 없이 모델 호출 0회로 실행합니다.

```sh
npm run test:tui -- --plan
```

검사를 실행하려면 [CLI 설치](../README_KO.md#빠른-시작)를 마치고 Python 3를 준비하세요. runtime·실모델 경로 모두 Codex 0.154.0과 headless Chromium이 필요합니다. 브라우저는 한 번 설치합니다.

```sh
npx --no-install playwright install chromium
```

**오프라인 — 모델 호출 없음:** runtime은 실제 Codex와 SDK 대역으로 U01·U02·U11·U12를 검사합니다.

```sh
npm run test:tui:runtime
```

**실모델 — Copilot 인증·사용량 필요:** 새 출력 폴더에서 72건 전체를 한 번 실행한 뒤 실패를 포함한 보고서를 검증합니다.

```sh
npm run test:tui -- --execute --output .runtime/tui-new
```

```sh
npm run test:tui -- --verify .runtime/tui-new/report.json
```

날짜별 v3 결과와 보존한 v1/v2 실행은 [검증 기록](validation/README_KO.md)에 있습니다. 과거 72/72 결과가 향후 서비스 가용성이나 다른 구현의 동작을 보장하지는 않습니다.

## 실행 경로

모든 케이스는 다음 경로를 거칩니다.
- 저장소의 실제 실행기 `bin/codex-ghcp`
- 실행기가 띄우는 bridge(`src/server.mjs`)와 실제 Copilot SDK, 지정 모델
- 실제 Codex 0.154.0 TUI를 전용 PTY에 띄우고 headless Chromium의 xterm.js로 렌더링
- 입력은 Playwright 키보드(`/model`, 방향키, Enter, Escape)와 붙여넣기로 보내며, 화면은 xterm.js 버퍼에서 읽습니다

케이스마다 격리된 `HOME`·`CODEX_HOME`·작업 폴더를 쓰며, 실제로 공유하는 것은 Copilot 인증뿐입니다. 승인 정책은 `never`이고 샌드박스는 시나리오마다 고정합니다. 표식은 케이스마다 무작위로 만듭니다. 케이스 자동 재시도, 출력 재작성, 셀 대체는 없습니다. 운영 브릿지의 제한적인 출력 전 복구는 활성화하고 관측하며, 하네스 재시도와 구분합니다. 사용 중인 브릿지·사용자 설정은 재시작하거나 변경하지 않습니다.

## 시나리오

| ID | 시나리오 | 확인하는 브릿지 동작 |
|---|---|---|
| U01 | `/model` 피커가 6개 모델을 고정 순서로 표시하고 첫 턴에 응답 | 실행기 `model_catalog_json` 고정, 시작 모델 라우팅 |
| U02 | 피커로 모델을 바꾸면 다음 턴이 선택한 모델로 라우팅 | 대화 중 모델 변경과 bridge 모델 해석 |
| U03 | 읽기 전용 샌드박스에서 Codex shell 도구가 합성 애플리케이션 샘플을 읽음 | handler 없는 도구 handoff, Codex 실행, 대기 결과 제출 |
| U04 | workspace-write 샌드박스에서 `apply_patch`로 파일 생성 | freeform 도구 입력의 바이트 단위 보존 |
| U05 | Codex 자체 MCP 도구가 동작하고 Copilot 런타임 MCP는 꺼져 있음 | `disabledMcpServers` 격리, Codex MCP 무영향 |
| U06 | 긴 답변(약 700단어)을 렌더링한 뒤에도 마지막 표식이 보임 | 긴 SSE, delta/final 대조, TUI 스크롤 영역 |
| U07 | 24 KiB 붙여넣기 입력을 전달하고 응답 | 요청 크기 제한과 이력 처리 |
| U08 | Escape로 실행 중 턴을 중단하고 같은 프로세스에서 복구 | 연결 끊김 취소, SDK abort, 동일 프로세스 복구 |
| U09 | `/compact` 뒤에도 중요 정보가 남고 대화가 이어짐 | 도구 없는 요약 세션으로의 로컬 압축 handoff |
| U10 | `resume --last`로 새 bridge 프로세스에서 대화를 재개 | 실행기·bridge·런타임 재시작 후 cold-start 이력 재생 |
| U11 | `/model`에서 고른 reasoning 수준이 bridge까지 전달 | 대화 중 reasoning effort 변경, 또는 미지원 모델에서 선택 창이 없음 |
| U12 | `/new`로 대화를 격리하고 `/quit`으로 모두 종료 | 대화 identity, 실행기 종료, 자식 bridge·런타임 종료, 임시 catalog 삭제 |

U04에는 Codex 기본 `apply_patch` 도구가 필요합니다. 이 계약의 첫 실제 실행에서 운영 실행기가 이 도구를 제공하지 않는다는 사실이 드러났습니다. 모델들은 해당 도구가 없다고 답했고, 한 모델은 shell로 파일을 대신 썼습니다. 이제 운영 목록은 `apply_patch_tool_type: "freeform"`을 선언하며, U04는 bridge 도구 handoff 뒤 Codex rollout에 patch 적용이 기록되어야 통과합니다. `apply_patch` 도구 호출이거나, Codex가 `apply_patch` shell 명령을 직접 가로채 적용한 경우를 인정합니다. 일반 shell 쓰기는 인정하지 않습니다. 또한 파일 내용이 요청한 한 줄과 정확히 같아야 합니다.

## 판정

v2에서는 U03의 자격 증명처럼 보이던 `notes/token.txt`·`token=`을 `notes/sample.txt`·`sample_id=`로 바꿉니다. 무작위 값은 여전히 프롬프트에 없으며 실제 Codex 도구를 통해 읽어야 합니다. 안전 필터·승인을 우회하지 않으며 v1의 거절은 과거 결과에서 실패로 유지합니다.

모든 케이스에 다음 **공통 검사**가 적용됩니다.
- **routing:** 모든 SDK 세션·`session.rpc.model.getCurrent()`의 실제 모델 상태·usage가 기대 모델을 씀
- **connection:** 실제 SDK 입력·모델 출력·HTTP 200의 Responses SSE 완료가 기록됨. U08의 명시적 진행 중 취소만 예외
- **context-tier:** 세션 생성·추론 수준 변경에서 최대 지원 tier가 유지되고 SDK 실제 상태·공개 catalog의 입력 예산·압축 기준이 일치함
- **watchdog:** 새 브릿지의 `/health`가 첫 진행 180초·스트리밍 무진행 90초·복구 1회·감시 15초를 보고함
- **upstream:** 필터, SDK 오류, 실패 스트림이 없음
- **mcp-isolation:** 표본을 채취하는 동안 브릿지 Copilot 런타임 아래에 MCP 프로세스가 한 번도 없음
- **cleanup:** PTY 그룹, 실행기, bridge, 런타임, 브라우저가 종료되고 임시 catalog가 삭제됐으며 하네스·SDK 세션 정리 오류가 없음. 대기 중 TUI는 `/quit`으로 정상 종료한 뒤에만 제한적인 강제 종료를 고려함

시나리오 검사는 다음 증거를 함께 씁니다.
- Codex가 저장한 rollout: 도구 호출, 파일 변경, 압축, turn별 모델·effort
- bridge SDK 관측 기록, HTTP 기록, MCP fixture ledger
- 작업 폴더 파일, 화면 스냅샷

보고서에는 OS/커널 버전·아키텍처·Node 버전·사용 가능한 CPU 수·메모리·프록시/CI 설정 유무를 기록합니다. 프록시 주소·자격 증명·호스트/사용자 식별자는 기록하지 않습니다. 실제 측정한 환경을 구분하기 위한 정보이며 다른 환경의 지원을 입증하지는 않습니다.

Codex의 선택적인 자동 제목 생성은 여전히 미지원인 구조화 JSON 출력을 요청합니다. 정확한 제목 전용 스키마와 명시적 HTTP 400 거절만 `auxiliaryTitleRejections`로 별도 집계하며 성공한 모델 응답으로 인정하지 않습니다. 다른 HTTP 4xx/5xx, 제목 형태이지만 다른 오류인 요청, 모든 실패 스트림은 본 요청 검사를 실패시킵니다. 자동 제목은 계속 미지원입니다. [호환성 범위](COMPATIBILITY_KO.md)를 참고하세요.

검사는 저장된 `facts.json`에서 계산하는 순수 함수입니다. `--verify`는 실제 동결 소스·실행 및 케이스 identity·파일 hash·프로세스 종료 증거를 확인하고 모든 검사를 다시 계산합니다. 실패·차단·시간 초과·미실행도 분모 72에 남습니다. 중단·구현 변경·미완료 실행은 목표를 달성할 수 없습니다. `thresholdMet`는 69/72 이상, `fullMatrixPassed`는 계속 72/72를 요구하며 모델별·시나리오별 실패를 표시합니다.

기대와 다른 답변으로 완료되거나 HTTP·스트림 오류가 발생하면 원래 증거를 남기고 즉시 실패 처리합니다. 시나리오 제한 시간까지 기다렸다가 무응답으로 오분류하지 않습니다. 실패 전 관측값도 보존합니다. 개선 후에는 새 출력 폴더에서 72건 전체를 다시 실행하며, 다른 구현의 성공 셀을 합치거나 이전 보고서를 덮어쓰지 않습니다.

## 과거 실행 검증과 종료 코드

```sh
node .runtime/tui-new/source-snapshot/scripts/tui.mjs \
  --verify .runtime/tui-new/report.json
```

작업 트리를 바꾼 뒤에는 동결 소스를 사용하며 같은 의존성이 필요합니다. `--verify`는 모델 호출 없이 증거를 확인합니다. 계획·실모델 실행·검증의 종료 코드는 다음과 같습니다.

| 코드 | 의미 |
|---|---|
| 0 | 정상 plan, 또는 전체 실검증의 95% 목표 달성 |
| 1 | 실행에서 95% 목표를 확립하지 못함 |
| 2 | 인자·증거 오류 |

## 한계

- 제한된 시간의 실행이며 수시간 내구성 인증이 아닙니다.
- 데스크톱 터미널 앱 자체는 검증하지 않습니다.
- U09·U10의 회상은 모델의 요약·응답 품질에도 영향을 받습니다.
- tier·watchdog 설정 검사는 최대 문맥을 채운 추론이나 장애 주입 복구를 입증하지 않습니다. `npm run test:context:runtime`은 운영 제한값으로 첫 진행을 실제 95초 지연시키는 항목, 루트 단계의 비공개 바이트 진행, 무응답·설정 제한·취소·반복 도구 검사를 SDK 대역으로 따로 실행하며 실검증 점수에 합산하지 않습니다.
- 오프라인 runtime 검사에는 Copilot 런타임 프로세스가 없으므로, 런타임 MCP 격리는 실검증에서만 확정합니다.
