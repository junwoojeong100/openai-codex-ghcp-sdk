# 실제 Codex TUI 시나리오(Playwright headless)

[English](TUI_SCENARIOS.md) · [안정성 계약](STABILITY_TESTING_KO.md) · [터미널·내구성 검사](SOAK_TESTING_KO.md)

`codex-ghcp-tui-12-v1`은 최근 브릿지 개선을 **실제 Codex TUI**에서 확인하는 별도 계약입니다. **12개 시나리오 × 6개 모델 = 72건**이며, 안정성(v4)·호환성(v5) 결과와 합산하지 않습니다.

**최신 결과(한국 시간 2026-09-23): 70/72(97.22%)**, 구현 `54c7eb77`. [검증 기록](validation/2026-09-23-tui-scenarios/README_KO.md)을 참고하세요.

## 실행 경로

모든 케이스는 다음 경로를 거칩니다.
- 저장소의 실제 실행기 `bin/codex-ghcp`
- 실행기가 띄우는 bridge(`src/server.mjs`)와 실제 Copilot SDK, 지정 모델
- 실제 Codex 0.154.0 TUI를 전용 PTY에 띄우고 headless Chromium의 xterm.js로 렌더링
- 입력은 Playwright 키보드(`/model`, 방향키, Enter, Escape)와 붙여넣기로 보내며, 화면은 xterm.js 버퍼에서 읽습니다

케이스마다 격리된 `HOME`·`CODEX_HOME`·작업 폴더를 쓰며, 실제로 공유하는 것은 Copilot 인증뿐입니다. 승인 정책은 `never`이고 샌드박스는 시나리오마다 고정합니다. 표식은 케이스마다 무작위로 만듭니다. 자동 재시도, 출력 재작성, 셀 대체는 없습니다.

## 시나리오

| ID | 시나리오 | 확인하는 브릿지 동작 |
|---|---|---|
| U01 | `/model` 피커가 6개 모델을 고정 순서로 표시하고 첫 턴에 응답 | 실행기 `model_catalog_json` 고정, 시작 모델 라우팅 |
| U02 | 피커로 모델을 바꾸면 다음 턴이 선택한 모델로 라우팅 | 대화 중 모델 변경과 bridge 모델 해석 |
| U03 | 읽기 전용 샌드박스에서 Codex shell 도구가 작업 폴더 파일을 읽음 | handler 없는 도구 handoff, Codex 실행, 대기 결과 제출 |
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

모든 케이스에 다음 **공통 검사**가 적용됩니다.
- **routing:** 모든 SDK 세션·usage가 기대 모델을 씀
- **upstream:** 필터, SDK 오류, 실패 스트림이 없음
- **mcp-isolation:** 표본을 채취하는 동안 브릿지 Copilot 런타임 아래에 MCP 프로세스가 한 번도 없음
- **cleanup:** PTY 그룹, 실행기, bridge, 런타임, 브라우저가 종료되고 임시 catalog가 삭제됐으며 harness 오류가 없음

시나리오 검사는 다음 증거를 함께 씁니다.
- Codex가 저장한 rollout: 도구 호출, 파일 변경, 압축, turn별 모델·effort
- bridge SDK 관측 기록, HTTP 기록, MCP fixture ledger
- 작업 폴더 파일, 화면 스냅샷

검사는 저장된 `facts.json`에서 계산하는 순수 함수입니다. `--verify`는 저장된 통과 flag를 믿지 않고 hash를 대조한 뒤 모든 검사를 다시 계산합니다. 실패·차단·시간 초과·미실행도 분모 72에 남습니다.

## 명령

```sh
npx --no-install playwright install chromium
npm run test:tui                    # 계약 목록만 출력, 모델 호출 없음
npm run test:tui:runtime            # 실제 Codex TUI + Playwright + SDK 대역(U01·U12)
npm run test:tui -- --execute --output .runtime/tui-new   # Copilot 사용량 발생
npm run test:tui -- --verify .runtime/tui-new/report.json
```

소스를 바꾼 뒤에는 실행 폴더의 `source-snapshot/scripts/tui.mjs --verify`로 검증하세요. 종료 코드는 다음과 같습니다.

| 코드 | 의미 |
|---|---|
| 0 | 정상 plan, 또는 72/72 전체 통과 |
| 1 | 유효한 증거의 미통과 실행 |
| 2 | 인자·증거 오류 |

## 한계

- 제한된 시간의 실행이며 수시간 내구성 인증이 아닙니다.
- 데스크톱 터미널 앱 자체는 검증하지 않습니다.
- U09·U10의 회상은 모델의 요약·응답 품질에도 영향을 받습니다.
- 오프라인 runtime 검사에는 Copilot 런타임 프로세스가 없으므로, 런타임 MCP 격리는 실검증에서만 확정합니다.
