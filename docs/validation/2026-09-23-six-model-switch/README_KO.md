# 6개 주요 모델 전환·브릿지 MCP 격리·실검증

[English](README.md) · [검증 목록](../README_KO.md) · [안정성 계약](../../STABILITY_TESTING_KO.md)

## 결과

지원 모델을 **`claude-opus-5.5`, `claude-sonnet-5`, `claude-haiku-4.5`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`** 6개로 바꾸고, 모델 피커를 이 순서로 고정했습니다. 최종 구현(`68f92d74…`)으로 두 계약의 전체 66건을 각각 새로 실행했습니다. **두 행렬 모두 66/66은 아닙니다.**

| 모델 | 기본 v4 | 별도 application-data-v2 |
|---|---:|---:|
| claude-opus-5.5 | 2/11 | 10/11 |
| claude-sonnet-5 | 11/11 | 11/11 |
| claude-haiku-4.5 | 11/11 | 10/11 |
| gpt-6-astra | 11/11 | 11/11 |
| gpt-6-sol | 11/11 | 11/11 |
| gpt-6-luna | 11/11 | 10/11 |
| **합계** | **57/66 (86.36%)** | **63/66 (95.45%)** |

- 두 실행 모두 현재·동결 소스 독립 검증에서 `evidenceIntegrity=true`, `implementationUnchanged=true`, `userSettingsUnchanged=true`입니다. `fullMatrixPassed=false`와 종료 코드 1은 유지합니다.
- v4에서 Opus 5.5를 제외한 5개 모델은 각각 11/11로 모델별 판정을 받았습니다. Opus 5.5의 실패 9건은 모두 SDK의 명시적 상위 서비스 필터 신호입니다.
- application-data-v2는 기존 95% 참고 기준(66건 중 63건)을 충족하지만 모델별 판정은 Sonnet·Astra·Sol만 받았습니다.
- 7개 모델 v3·application-data-v1 결과(66/77, 72/77)는 과거 계약 기록입니다. 이번 점수와 합산하거나 재채점하지 않습니다.
- **이후 변경:** [실제 TUI 검증](../2026-09-23-tui-scenarios/README_KO.md)에서 Codex 기본 `apply_patch` 도구가 제공되지 않는다는 사실이 드러나, 운영 모델 목록이 이를 선언하도록 바꿨습니다(구현 `54c7eb77`). 이 행렬은 해당 구현에서 다시 실행하지 않았습니다.

## 변경 사항

1. **모델·피커:** `SUPPORTED_MODEL_IDS`를 위 6개로 바꿨습니다. 기본 모델은 그대로 `gpt-6-astra`입니다. 제거한 `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `claude-opus-5`는 실행기와 bridge가 대체 없이 거절합니다. `/model` 피커는 비공개 임시 `model_catalog_json`을 통해 이 6개만 표시합니다.
2. **계약:** 모델 구성이 바뀌었으므로 v3를 수정하지 않고 새 계약을 만들었습니다.
   - 안정성: `codex-ghcp-stability-11-v4`와 `…-application-data-v2`, 각 11×6 = 66건
   - 호환성: `codex-ghcp-workflows-18-v5`, 18×6 = 108건

   동결한 v3 소스와 비교해 달라진 필드는 `id`·`models`·`totalCases`·`acceptance` 문구·변경 설명뿐입니다. 시나리오·프롬프트·fixture·장애 흐름·예산·판정기는 같습니다.
3. **브릿지 MCP 격리:** SDK 세션 생성 시 `disabledMcpServers`로 Copilot 런타임의 사용자·plugin MCP 서버를 모두 비활성화합니다. 자세한 내용은 아래 항목을 보세요.
4. **검증 실행기 수정 2건:**
   - 호환성 실행기의 preflight가 모델 수 7을 하드코딩해 모든 셀을 차단하던 문제를 오프라인 검사에서 발견해 수정했습니다.
   - macOS에서 종료된 프로세스 그룹에 zombie만 남은 경우 `kill`이 `EPERM`을 반환합니다. supervisor가 이를 정리 실패로 기록해 통과한 케이스를 실패로 바꾸던 문제를 실검증에서 발견했습니다. 회귀 검사가 먼저 실패하는 것을 확인한 뒤 수정했습니다. 수정 후에도 `ESRCH`를 확인할 때까지 기존 2초 이내에서 기다리며, 그룹이 남으면 여전히 실패입니다.
5. **기타:** soak의 Luna lane을 `gpt-6-luna`로 바꿨고, Opus 진단 대상을 `claude-opus-5.5`로 바꿨습니다.

## 실행 이력

단계마다 구현 hash가 다르며 모든 실행을 보존합니다. 셀을 다시 골라 실행하거나 다른 단계와 합산하지 않았습니다.

| 단계 | 구현 | 시각(한국 시간) | v4 | application-data-v2 | 비고 |
|---|---|---|---:|---:|---|
| 예비 1 | `1b7e0ec8` | 08:25–08:44 | 54/66 | 64/66 | Sol S08 EPERM 오판; 사용자 Codex 세션이 `~/.codex/config.toml`을 변경해 v4 `userSettingsUnchanged=false` |
| 예비 2 (EPERM 수정) | `92f482db` | 08:51–09:08 | 57/66 | 60/66 | MCP 격리 전; 부하 평균 최대 약 18 |
| **최종 (MCP 격리)** | `68f92d74` | 09:32–09:50 | **57/66** | **63/66** | 공개 결과 |

같은 구현에서도 application-data-v2는 64→60→63으로 달라졌습니다. 모델 출력·도구 호출과 상위 지연의 실행 간 변동이며, 가장 높은 값을 골라 쓰지 않았습니다.

## 브릿지 MCP 격리

Codex 브릿지도 Claude Code 쪽과 구조가 같았습니다. bridge(`src/server.mjs`)마다 `new CopilotClient({ mode: "empty" })`로 런타임 하나를 띄우고, 런타임은 **SDK 세션마다** `~/.copilot/mcp-config.json`과 설치된 plugin의 MCP 서버를 새로 띄웠습니다. bridge는 `availableTools`를 `custom:*`로 제한하므로 이 서버들은 모델에 노출되지 않는 낭비였습니다.

| 확인(모델 추론 없음) | 결과 |
|---|---|
| 실제 등록 이름(`session.rpc.mcp.list`) | `azure`(plugin), `microsoft-learn`, `playwright`, `playwright-headless`. 설정 파일의 key와 정확히 일치 |
| bridge와 같은 세션 설정(수정 전) | 런타임 자식 3개(azmcp 1개, Playwright MCP node 2개), 약 316 MB RSS, `microsoft-learn` HTTP 연결 |
| `disabledMcpServers`에 정확한 이름 지정 | 4개 모두 `disabled`, 자식 프로세스 0개 |
| `mcpServers: {}` 덮어쓰기 | 효과 없음. 4개가 모두 연결되고 자식 3개 |
| 생성 후 `mcp.disable` | 실행 중인 자식 3개 → 0개 |
| 예열된 런타임의 세션 생성 중앙값 | 수정 전 1,171 ms, 수정 후 1,127 ms(각 4회) |

**구현:**
- `src/mcp-isolation.mjs`가 Copilot home의 `mcp-config.json`과 `installed-plugins`에서 서버 이름을 모읍니다. plugin은 루트 `.mcp.json`, 경로 또는 inline 객체로 선언한 manifest `mcpServers`를 읽습니다.
- `session-manager`는 매 세션 생성 시 이 이름을 전달합니다.
- 생성 직후 제한 시간이 있는 `mcp.list` 점검을 합니다. 모르는 출처의 서버가 떠 있으면 중지하고 이후 세션에서도 비활성화합니다. 점검이 실패해도 요청은 계속되며, 진단에는 개수만 남깁니다.
- Codex 자체 MCP 도구는 Codex가 실행하고 다른 도구처럼 선언하므로 영향을 받지 않습니다.

**실측:**
- 실제 production `SessionManager`로 `gpt-6-luna`를 한 번 호출했을 때 17회 표본 모두 런타임 자식이 0개였습니다.
- 최종 행렬 전체(533회 표본, 2초 간격, 이 저장소 런타임 최대 4개 동시)에서 **MCP 프로세스는 0개**였습니다. 관측된 자식은 런타임의 일시적인 `git` 확인뿐입니다.
- 행렬 증거 기준 SDK `disconnect` 지연은 다음과 같습니다. 부하 차이가 있어 세션 생성 시간 개선은 단정하지 않습니다.

  | 조건 | 중앙값 | p90 |
  |---|---:|---:|
  | 전날 밤 한가한 7개 모델 실행 | 312 ms | 401 ms |
  | 오늘 MCP 격리 전 | 481–565 ms | 0.8–1.9초 |
  | 오늘 MCP 격리 후 | **49–51 ms** | 259–412 ms |

## 모델 피커 실검증

실제 `bin/codex-ghcp` TUI를 격리된 `HOME`·`CODEX_HOME`의 PTY에서 실행하고 `/model`을 열었습니다.

- `Select Model and Effort`에는 정확히 6개가 위 순서대로 1–6번으로 표시됐습니다. 내장·과거 모델은 없었습니다.
- 시작 모델 `gpt-6-astra`는 `(current)`로 표시됐습니다.
- Codex 0.154.0은 catalog priority 순으로 정렬하고 첫 항목에 `(default)`를 붙이므로 `claude-opus-5.5`에 이 표시가 붙었습니다. 기존 7개 모델 구성에서도 같은 방식이었습니다.
- 피커에서 모델을 바꾼 뒤 보낸 프롬프트의 SDK 세션·usage 모델이 선택한 모델과 일치했습니다. 불일치는 0건이고 프로세스 그룹도 정리했습니다.
  - `claude-opus-5.5`: 예비 구현
  - `gpt-6-luna`: EPERM 수정 구현
  - `gpt-6-sol`: 최종 구현
- 첫 probe는 헤더 줄을 피커 행으로 세고 reasoning 선택 창을 입력창으로 오인해 실패했습니다. 피커 자체의 표시는 올바랐으며, 이 실패도 보존했습니다.
- 피커 선택은 Codex가 `~/.codex/config.toml`에 저장합니다. 다음 GHCP 실행은 여전히 `--ghcp-model` 또는 기본값을 쓰지만, `codex-original`은 저장된 값을 읽습니다.

## 남은 실패(최종)

- **상위 서비스 필터:** v4의 Opus 5.5 S01–S09와 application-data-v2의 Opus S11입니다. 모두 SDK의 명시적 필터 신호이며, 브릿지는 재시도 없이 실패로 반환했습니다.
- **SDK 정리 시간 초과:** application-data-v2 Haiku S09입니다. 의도적인 스트림 거절 후 `disconnect`가 5,004 ms로 운영 제한 5초를 넘었습니다. 복구 턴의 `disconnect`는 24 ms였고 자원은 모두 정리됐습니다. 계약상 실패로 유지하며 제한을 늘리지 않았습니다.
- **모델 도구 동작:** application-data-v2 Luna S11입니다. 6회 읽기와 회상 조건을 지키지 않았습니다.

예비 단계에서는 다음 실패도 관측했으며, 각 단계 JSON에 보존합니다.
- Luna·Opus의 `disconnect` 시간 초과
- Astra S09: 60초 동안 SDK 진행이 없어 턴 시간 초과
- Sonnet·Haiku의 literal 레이블 누락, Sonnet·Luna의 도구 반복 조건 미충족

## 추가 실제 터미널 확인

| 검사 | 예비 2(`92f482db`) | 최종(`68f92d74`) |
|---|---|---|
| PTY `gpt-6-sol`, 120초 | 9/9턴, 응답 31,118자, 통과 | 11/11턴, 응답 40,263자, 통과 |
| Playwright `claude-opus-5.5`, 24 KiB 입력·1,000단어 | 4/4턴, 입력 최대 110,013 토큰, 통과 | 4/4턴, 입력 최대 109,716 토큰, 통과 |
| soak smoke + PTY lane | 병렬 실행: 네이티브 Luna 14/15(2회 읽기), Sonnet 6/6, 터미널 Luna 0/1(세션 설정 30초 초과) | 순차 실행: 네이티브 Luna 15/17(2회 읽기 2건), Sonnet 9/9·압축 3회, 터미널 Luna 16/16 |
| soak smoke + Playwright lane | 병렬 실행: 네이티브 Luna 14/15(2회 읽기), Sonnet 3/4(세션 설정 504), 터미널 Luna 9/9 | 순차 실행: 네이티브 Luna 14/16(2회 읽기 2건), Sonnet 8/8·압축 2회, 터미널 Luna 16/16 |

모든 standalone 검사에서 필터·모델 불일치·스트림 실패는 0건이었고 프로세스 그룹을 정리했습니다. soak 실패의 원인은 두 가지입니다. 하나는 `gpt-6-luna`가 한 턴에 샘플을 두 번 읽은 모델 동작입니다. 두 호출은 call ID가 서로 다르고 별도의 모델 메시지에서 나왔으므로 bridge 재전송이 아닙니다. 다른 하나는 예비 단계에서 두 soak를 병렬로 돌렸을 때 발생한 세션 설정 시간 초과입니다. 최종 soak는 하나씩 실행했으며 설정 시간 초과가 없었고, 터미널 lane은 32/32턴을 통과했습니다. 제한된 실행의 확인이며 **수시간·5시간 무중단 인증이 아닙니다.**

## 환경 요인

실검증은 사용자가 사용 중인 장비에서 진행했습니다. 같은 Copilot 계정으로 별도 `claude-code-ghcp-sdk` 검증과 대화형 세션이 동시에 돌았고, macOS `mediaanalysisd`·Microsoft Defender 부하도 있었습니다. 1분 부하 평균은 약 3.6–17.8이었습니다(10코어). 예비 1 단계에서는 사용자가 새 Codex 세션에서 피커로 모델을 바꿔 `~/.codex/config.toml`이 변경됐습니다. 실행기는 출처를 가릴 수 없으므로 해당 실행의 `userSettingsUnchanged`를 false로 기록했습니다.

## 증거와 재현

- [최종 v4](final-v4.json) · [최종 application-data-v2](final-application-data-v2.json)
- [EPERM 수정 후 v4](post-eperm-v4.json) · [EPERM 수정 후 application-data-v2](post-eperm-application-data-v2.json)
- [예비 v4](preliminary-v4.json) · [예비 application-data-v2](preliminary-application-data-v2.json)
- [요약·환경·지연 통계](summary.json) · [추가 실검증·피커·MCP](additional-live.json)
- [로컬 검사](local-checks.json) · [최종 소스 명세](source-manifest.json)

커밋한 JSON은 정제한 결과표입니다. 원시 SDK·네이티브·HTTP 증거는 무시되는 `.runtime` 폴더에 있으며, 그 증거로 검증했습니다. hash는 추적용이며 제3자 인증은 아닙니다.

```sh
npm test
npm run test:stability -- --execute --output .runtime/new-v4
npm run test:stability -- --execute --profile application-data-v2 --output .runtime/new-application-data-v2
npm run test:stability -- --verify .runtime/new-v4/report.json
npm run test:terminal -- --execute --driver pty --model gpt-6-sol --duration-seconds 120 --output .runtime/new-pty
```
