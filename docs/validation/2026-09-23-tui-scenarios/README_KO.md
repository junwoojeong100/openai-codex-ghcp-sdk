# Playwright headless 기반 실제 Codex TUI 시나리오

[English](README.md) · [검증 색인](../README_KO.md) · [TUI 계약](../../TUI_SCENARIOS_KO.md)

## 결과

새 계약 `codex-ghcp-tui-12-v1`은 운영 실행기 `bin/codex-ghcp`로 **실제 Codex 0.154.0 TUI**를 구동합니다. **12개 시나리오 × 6개 모델 = 72건**입니다. 케이스마다 전용 PTY를 쓰고, headless Chromium의 xterm.js가 화면을 렌더링하며, Playwright가 실제 키 입력을 보냅니다. 최종 구현(`54c7eb77…`)으로 72건 전체를 처음부터 실행한 결과는 **70/72(97.22%)**입니다. 72/72는 아닙니다.

| 모델 | U01 | U02 | U03 | U04 | U05 | U06 | U07 | U08 | U09 | U10 | U11 | U12 | 통과 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---:|
| claude-opus-5.5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| claude-sonnet-5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| claude-haiku-4.5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| gpt-6-astra | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| gpt-6-sol | ✓ | ✓ | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11/12 |
| gpt-6-luna | ✓ | ✓ | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11/12 |
| **통과** | 6/6 | 6/6 | 4/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | **70/72** |

✓ 통과 · T 시간 초과

- 현재·동결 소스로 독립 검증한 결과 모두 `evidenceIntegrity=true`입니다. 실행 기록도 `implementationUnchanged=true`, `frozenSourceUnchanged=true`, `userSettingsUnchanged=true`입니다. `fullMatrixPassed=false`와 종료 코드 1은 그대로입니다.
- Opus 5.5, Sonnet 5, Haiku 4.5, Astra는 12/12로 모델별 판정을 얻었습니다.
- **실패 2건은 bridge 오류가 아니라 모델의 거절입니다.** U03에서 Sol은 "I can't retrieve or disclose a token from that file", Luna는 "I can't read or reveal a token or credential"이라고 답했습니다. 둘 다 도구를 호출하지 않았고, `stop`으로 끝났으며, SDK 필터 신호도 없었습니다. 하네스는 시나리오 제한 240초까지 기다렸습니다. 동결된 픽스처는 `token=<marker>`를 담은 `notes/token.txt`인데, 이 문구가 자격 증명 요청처럼 보입니다. 같은 프롬프트로 나머지 4개 모델은 통과했습니다. 계약을 바꾸거나 해당 셀을 다시 실행하지 않았습니다.
- 이 계약은 stability(v4, application-data-v2)·compatibility(v5) 계약과 별개이며 점수를 합산하지 않습니다.

## 시나리오와 증거

전체 정의는 [계약 문서](../../TUI_SCENARIOS_KO.md)를 참고하세요. 최종 실행에서 기록한 증거는 다음과 같습니다.

| ID | 실제 TUI에서 확인한 내용 | 최종 실행 증거 |
|---|---|---|
| U01 | `/model`에 고정된 6개 모델이 표시되고 첫 턴이 응답 | 6/6. U01·U02·U11에서 연 피커 18개 모두 정확히 6개 모델을 같은 순서로 표시 |
| U02 | 피커에서 모델을 바꾸면 다음 턴이 선택한 모델로 전달 | 6/6. 사용량 기록이 시작 모델에서 선택 모델로 이동 |
| U03 | read-only sandbox에서 Codex shell 도구로 작업 폴더 파일 읽기 | 4/6. Sol과 Luna는 거절(위 참고) |
| U04 | workspace-write sandbox에서 `apply_patch`로 파일 생성 | 6/6. **6개 모델 모두 기본 `custom_tool_call apply_patch` 사용** |
| U05 | Copilot 런타임 MCP를 끈 상태에서 Codex MCP 도구 동작 | 6/6. Codex 픽스처 MCP가 시작·호출됐고 런타임 MCP 프로세스는 0개 |
| U06 | 긴 답변을 렌더링한 뒤에도 마지막 표지가 보임 | 6/6. 답변 길이 3,989–5,477자 |
| U07 | 24 KiB bracketed paste를 전달하고 응답 | 6/6. 요청 약 39.8 KB, 입력 토큰 12,240–21,221 |
| U08 | Escape로 턴을 중단하고 같은 프로세스에서 복구 | 6/6. 진행 중 요청이 취소되고 bridge가 SDK 턴을 중단했으며, 같은 Codex 프로세스가 다음 턴에 응답 |
| U09 | `/compact` 뒤에도 중요 정보가 남고 대화가 이어짐 | 6/6. 케이스마다 압축 1회와 도구 없는 요약 세션 1개 |
| U10 | `resume --last`로 새 bridge 프로세스에서 대화 재생 | 6/6. 첫 실행은 종료 코드 0으로 끝나고, 두 번째 실행이 코드를 기억 |
| U11 | `/model`에서 고른 reasoning 수준이 bridge까지 전달 | 6/6. 5개 모델은 `setModel`로 `low`에서 `high`로 바뀌었고, Haiku는 선택 창이 없는 것이 맞음 |
| U12 | `/new`로 대화를 격리하고 `/quit`으로 모두 종료 | 6/6. 종료 코드 0, 임시 catalog 삭제, 남은 프로세스 0개 |

모든 케이스가 routing·upstream·MCP 격리·cleanup **공통 검사**도 통과했습니다. 예외는 시간 초과 2건의 cleanup 검사로, 하네스 오류가 기록되면 항상 실패하도록 정의돼 있습니다. 1초 간격 프로세스 표본 1,282회 동안 **bridge의 Copilot 런타임 아래 MCP 프로세스는 한 번도 나타나지 않았습니다.**

## 발견하고 고친 문제

첫 전체 실행(예비, 구현 `a273b5e0`)에서 문제 두 가지가 드러났습니다. 이 실행은 SIGINT로 중단했고 그대로 보존합니다.

1. **운영 실행기가 Codex 기본 `apply_patch` 도구를 제공하지 않았습니다.** Codex는 모든 모델에 `apply_patch` 없이 도구 7개만 선언했고, SDK에는 `toolCount` 7이 기록됐습니다.
   - Opus 5.5는 `apply_patch` 도구가 없다고 답했고, Haiku 4.5는 이 도구가 빠진 도구 목록을 나열했습니다. 둘 다 표지를 기다리다 시간 초과됐습니다.
   - Sonnet 5는 `exec_command`로 파일을 써서 `U04.patch`에 실패했습니다.
   - GPT 모델은 shell 도구로 `apply_patch`를 실행해 Codex가 가로채는 방식으로 통과할 수 있었고, 개발 확인 한 건이 실제로 그렇게 했습니다.

   **수정:** 운영 모델 목록이 `apply_patch_tool_type: "freeform"`을 선언합니다(`src/model-map.mjs`). 회귀 테스트도 추가했습니다. 수정 후 Codex는 `custom:apply_patch`를 포함한 도구 8개를 선언합니다. 최종 실행에서 6개 모델 모두 기본 도구를 썼고, Codex는 모델마다 그에 맞는 파일 변경을 기록했습니다. 이전에는 compatibility 스위트만 테스트 프로필로 이 설정을 켰습니다.
2. **reasoning 수준이 없는 모델을 고르면 Codex가 모델 선택 창을 닫지 않습니다(하네스 공백).** Haiku 4.5를 고르면 모델은 바뀌지만 선택 창이 그대로 열려 있어, 하네스가 입력창을 기다리다 시간 초과됐습니다. 이제 하네스는 Escape로 창을 닫고 `pickerStayedOpen`을 기록합니다. 최종 Haiku U02는 `pickerStayedOpen=true`를 기록하고 통과했습니다.

최종 행렬 전에 단일 케이스 개발 실행으로 두 수정을 확인했습니다. 이 실행은 어떤 분모에도 포함하지 않습니다.

## 실행 이력

| 단계 | 구현 | 시간(KST) | 결과 | 비고 |
|---|---|---|---:|---|
| 예비 | `a273b5e0` | 11:01–11:10 | 통과 29, 실패 2, 시간 초과 2, 미실행 39 | 두 문제 발견 후 중단, `evidenceIntegrity=true` |
| **최종** | `54c7eb77` | 11:16–11:34 | **70/72** | 공개 결과, 케이스 중앙값 17초 |

예비 실행의 셀은 다시 판정하거나 최종 실행과 합산하지 않습니다.

## 관찰 사항(점수 미반영)

- **작업 제목 요청:** Codex 0.154는 대화의 첫 프롬프트 뒤에 짧은 작업 제목을 `json_schema` 텍스트 형식으로 요청합니다. bridge는 구조화 출력을 지원하지 않으므로 HTTP 400(`Structured output is not supported`)으로 답하고, Codex는 제목 없이 계속 진행합니다. 72건 중 66건에서 총 102회 발생했고, 다른 HTTP 오류는 없었습니다. 요청 형태는 별도 진단 probe로 확인했습니다.
- **bridge 정리 진단은 터미널 종료 방식에 따라 달라집니다.**
  - `/quit`으로 끝나지 않는 케이스는 PTY helper가 프로세스 그룹 전체에 SIGINT를 보내 종료합니다. SDK가 Copilot 런타임을 분리하지 않고 실행하므로, bridge가 세션을 정리하는 동안 런타임도 같은 신호를 받습니다. 그래서 제한된 `abort` 또는 `disconnect`가 5초를 기다리고, `delete`는 `rpc_error`를 기록합니다.
  - 이렇게 끝난 66건 모두에서 발생했습니다(`abort` 시간 초과 62회, `disconnect` 시간 초과 3회, `delete` 오류 65회, `delete` 시간 초과 1회). 그래도 모든 프로세스가 종료됐고 임시 catalog도 삭제됐습니다.
  - `/quit`으로 끝난 6건(U12)과 별도 `/quit` probe에서는 **한 번도 없었습니다.**
  - v1 계약의 cleanup 검사는 프로세스와 파일을 보며 bridge 진단은 보지 않으므로, 점수 대신 관찰 사항으로 보고합니다.
- **이전 결과:** 6개 모델 stability 행렬(57/66, 63/66)은 freeform `apply_patch` 목록 변경 전 구현 `68f92d74`에서 측정했고, `54c7eb77`에서는 다시 실행하지 않았습니다.

## 환경

사용자가 작업 중인 워크스테이션에서 실행했습니다. macOS 26.7, 10코어, 메모리 16 GB이며 1분 부하 평균은 3.4–9.9였습니다. 다른 Copilot 세션이 같은 계정을 함께 사용했습니다. 케이스마다 `HOME`, `CODEX_HOME`, 작업 폴더를 따로 썼고, Copilot 인증만 실제 계정을 공유했습니다.

## 증거와 재현

- [최종 실행](final-tui.json) · [예비 실행](preliminary-tui.json)
- [요약·발견 사항](summary.json) · [로컬 검사](local-checks.json) · [최종 소스 manifest](source-manifest.json)

커밋한 JSON은 민감 정보를 제거한 결과표입니다. 원본 화면, PTY 출력, rollout, SDK·HTTP 증거는 검증에 사용한 `.runtime` 폴더에 남아 있으며 커밋하지 않습니다. hash는 추적용이며 제3자 인증이 아닙니다.

```sh
npx --no-install playwright install chromium
npm run test:tui                    # 계획만 출력, 모델 호출 없음
npm run test:tui:runtime            # 실제 Codex TUI + Playwright + SDK double
npm run test:tui -- --execute --output .runtime/tui-new
npm run test:tui -- --verify .runtime/tui-new/report.json
node .runtime/tui-new/source-snapshot/scripts/tui.mjs --verify .runtime/tui-new/report.json
```
