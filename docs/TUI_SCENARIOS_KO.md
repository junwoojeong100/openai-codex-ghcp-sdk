# 실제 Codex TUI 시나리오(Playwright headless)

[English](TUI_SCENARIOS.md) · [검증 안내](../README_KO.md#개발과-검증) · [안정성 검사](STABILITY_TESTING_KO.md) · [터미널·내구성 검사](SOAK_TESTING_KO.md)

bridge를 통해 Codex의 대화형 터미널 화면(TUI)을 검사합니다. 모델 전환·도구·중단·압축·재개를 다룹니다. 실모델 케이스는 **실제 Codex TUI → 운영 bridge → Copilot SDK → 정확한 모델** 경로를 사용합니다.

현재 검사 사양(버전별 시나리오·통과 기준)은 `codex-ghcp-tui-12-v3`이며 **12개 시나리오 × 6개 모델 = 72건**입니다. 한 케이스는 한 모델에서 시나리오 하나를 실행한 결과입니다. 변경 없이 완료한 실모델 실행 하나에서 **72/72**면 전체 통과, **69/72**면 95% 목표 달성입니다. 안정성·호환성·이전 TUI 실행의 결과와 합치지 마세요.

**바로가기:** [실행](#검사-실행) · [결과 읽기](#결과-읽기) · [시나리오](#시나리오) · [통과 기준](#통과-기준) · [실행 경로](#실행-경로) · [한계](#한계)

## 검사 실행

모든 명령은 `npm ci` 후 저장소 루트에서 실행합니다. 각 모드는 단독으로 실행할 수 있으니 목적에 맞는 것을 고르세요.

| 목적 | 모드 | 실모델 호출 |
| --- | --- | --- |
| 행렬이 검사하는 내용 확인 | [계획](#계획) | 없음 |
| 실제 Codex로 TUI 러너 확인 | [오프라인 runtime](#오프라인-runtime) | 없음 |
| 72건 전체 측정 | [실모델 행렬](#실모델-행렬) | **있음** |
| 끝난 실행 다시 확인 | [보고서 검증](#보고서-검증) | 없음 |

### 계획

Codex 설치·브라우저·Copilot 로그인이 필요하지 않습니다.

```sh
npm run test:tui -- --plan
```

### 실행 준비 사항

오프라인 runtime과 실모델 행렬에는 **Node 22.12 이상, Codex 0.154.0, Python 3, headless Chromium**이 필요합니다. Codex는 [설치 단계](../README_KO.md#2-의존성-설치)로 설치하고, 브라우저는 한 번만 설치합니다.

```sh
npx --no-install playwright install chromium
```

Linux에서 Chromium이 시스템 라이브러리 누락을 알리면 대신 `npx --no-install playwright install --with-deps chromium`을 실행하세요. OS 패키지 설치에는 관리자 권한이 필요할 수 있습니다. Copilot 로그인은 실모델 행렬에만 필요합니다.

### 오프라인 runtime

실제 Codex를 SDK 대역(Copilot SDK 대신 동작하는 로컬 구현)에 연결해 U01·U02·U11·U12를 실행합니다. 모델을 호출하지 않습니다.

```sh
npm run test:tui:runtime
```

### 실모델 행렬

**Copilot 사용량이 발생합니다.**

1. [실행 준비 사항](#실행-준비-사항)을 설치하고 [Copilot 계정 확인](../README_KO.md#3-설치와-계정-접근-확인)을 마칩니다.
2. `./bin/ghcp-models`를 실행해 기본 모델만이 아니라 **[지원 모델 6개](../README_KO.md#모델) 모두** 사용할 수 있는지 확인합니다.
3. 새 출력 디렉터리를 지정해 72건 전체를 실행합니다.

```sh
npm run test:tui -- --execute --output .runtime/tui-new
```

러너는 시작 전에 자신의 소스 사본을 출력 디렉터리에 저장합니다.

### 보고서 검증

검증은 저장된 증거로 모든 판정을 다시 계산합니다. 모델을 호출하거나 케이스를 다시 실행하지 않습니다. 실패가 있어도 끝난 실행은 모두 검증하세요.

```sh
npm run test:tui -- --verify .runtime/tui-new/report.json
```

검증은 별도 명령으로 실행하세요. 95% 목표에 못 미친 실행은 종료 코드 1로 끝나므로 `--execute` 뒤에 `&&`로 `--verify`를 연결하면 검증이 건너뛰어집니다.

**실행 후 소스가 바뀌었다면** 그 실행이 저장한 소스로 검증하세요.

```sh
node .runtime/tui-new/source-snapshot/scripts/tui.mjs \
  --verify .runtime/tui-new/report.json
```

`cases/`, `freeze.json`, `source-snapshot/`을 포함한 원래 실행 디렉터리 전체를 보존하고 같은 의존성을 설치하세요. 공개한 요약으로는 이 증거를 대신할 수 없습니다.

## 결과 읽기

출력 디렉터리의 `report.md`(예: `.runtime/tui-new/report.md`)를 여세요. 판정, 모델별 통과 수, 그리고 기록된 오류와 케이스 증거 링크가 있는 **Cases needing attention**을 표시합니다. 72건 전체는 **Complete matrix**를 펼쳐 확인합니다.

| 종료 코드 | 의미 |
|---|---|
| 0 | 유효한 계획, 또는 완료된 실모델 실행이 95% 목표를 달성 |
| 1 | 95% 목표에 도달하지 못함 |
| 2 | 인자 또는 증거 오류 |

**종료 코드 0이 72/72를 뜻하지는 않습니다.** **TARGET MET - NOT A FULL PASS**는 69/72 이상이 통과했지만 전부 통과하지는 않았다는 뜻입니다. 전체 통과는 `fullMatrixPassed`로 확인하세요. `thresholdMet`는 95% 목표만 나타내며, `evidenceIntegrity`는 검사 통과가 아니라 증거의 유효성을 나타냅니다. [필드 의미](validation/README_KO.md#결과-읽기)를 참고하세요.

날짜별 v3 결과와 보존한 v1·v2 실행은 [검증 기록](validation/README_KO.md)에 있습니다. 과거의 72/72 결과는 앞으로의 서비스 가용성을 보장하지 않으며 다른 구현의 증거도 아닙니다.

## 시나리오

| ID | 시나리오 | 확인하는 bridge 동작 |
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

**U04에는 Codex 기본 `apply_patch` 도구가 필요합니다.**

- **이유:** 이 검사 사양의 첫 실모델 실행에서 운영 실행기가 이 도구를 제공하지 않는다는 사실이 드러났습니다. 모델들은 도구가 없다고 답했고, 한 모델은 shell로 파일을 대신 썼습니다. 이제 운영 목록은 `apply_patch_tool_type: "freeform"`을 선언합니다.
- **통과 조건:** bridge 도구 handoff 뒤 Codex rollout에 patch 적용이 기록되어야 합니다. `apply_patch` 도구를 쓰거나 Codex가 `apply_patch` shell 명령을 직접 가로채 적용한 경우를 인정합니다. 이후 파일 내용이 요청한 한 줄과 정확히 같아야 합니다. 일반 shell 쓰기는 인정하지 않습니다.

## 통과 기준

모든 케이스는 다음 **공통 검사**를 통과해야 합니다.

- **routing:** 모든 SDK 세션, `session.rpc.model.getCurrent()`의 실제 모델 상태, usage 기록이 기대 모델을 사용함
- **connection:** 실제 SDK 입력·모델 출력·완료된 HTTP 200 Responses SSE 스트림이 기록됨. U08의 의도적인 진행 중 취소만 예외
- **context-tier:** 세션 생성·추론 수준 변경에서 최대 지원 tier를 유지하고, SDK 실제 상태와 공개 catalog의 입력 예산·압축 기준이 일치함
- **watchdog:** 새 bridge의 `/health`가 첫 진행 180초, 스트리밍 무응답 90초, 복구 1회, 감시 간격 15초를 보고함
- **upstream:** 필터·SDK 오류·실패 스트림이 없음
- **mcp-isolation:** 표본을 채취하는 동안 bridge의 Copilot 런타임 아래에 MCP 프로세스가 한 번도 나타나지 않음
- **cleanup:** PTY 그룹·실행기·bridge·런타임·브라우저가 종료되고 임시 catalog가 삭제됐으며 하네스·SDK 세션 정리 오류가 없음. 대기 중인 TUI는 제한적인 강제 종료 전에 `/quit`으로 종료함

시나리오 검사는 다음 증거를 함께 사용합니다.

- Codex가 저장한 rollout: 도구 호출, 파일 변경, 압축, 턴별 모델·추론 수준
- bridge SDK 관측 기록, HTTP 기록, MCP fixture ledger
- 작업 폴더 파일, 화면 스냅샷

채점 방식:

- **판정은 저장된 사실로 다시 계산합니다.** 모든 판정은 저장된 `facts.json`에서 계산하는 순수 함수입니다. `--verify`는 실제 동결 소스, 실행·케이스 식별 정보, 증거 파일 hash, 프로세스 감독 기록을 확인한 뒤 모든 판정을 다시 계산합니다.
- **모든 케이스를 셉니다.** 실패·차단·시간 초과·미실행 케이스도 분모 72에 남습니다. 중단·변경·미완료 실행은 목표를 달성할 수 없습니다. `thresholdMet`는 69/72, `fullMatrixPassed`는 72/72가 필요하며 모델별·시나리오별 실패가 표시됩니다.
- **실패는 즉시 보고합니다.** 기대와 다른 답변으로 완료되거나 HTTP·스트림 오류가 나면, 제한 시간까지 기다렸다가 시간 초과로 잘못 분류하지 않고 원래 증거와 함께 바로 실패 처리합니다. 부분 관측값도 보존합니다.
- **다시 실행할 때는 전체를 실행합니다.** 문제를 고친 뒤에는 새 출력 디렉터리에서 72건 전체를 다시 실행하세요. 다른 구현의 통과 케이스를 합치거나 이전 보고서를 덮어쓰지 마세요.
- **자동 제목은 따로 셉니다.** Codex의 선택적 자동 제목 요청은 여전히 미지원인 구조화 JSON 출력을 요청합니다. 정확한 제목 전용 스키마가 명시적 HTTP 400으로 거절된 경우만 `auxiliaryTitleRejections`로 집계하며, 성공한 모델 응답으로 인정하지 않습니다. 다른 HTTP 4xx/5xx, 제목 형태이지만 다른 오류인 요청, 모든 실패 스트림은 일반 턴 검사를 실패시킵니다. 자동 제목은 계속 미지원입니다. [호환성](COMPATIBILITY_KO.md)을 참고하세요.

보고서에는 OS·커널 버전, 아키텍처, Node 버전, 사용 가능한 CPU 수, 메모리, 프록시·CI 설정 여부도 기록합니다. 프록시 주소·인증정보·호스트·사용자 식별 정보는 기록하지 않습니다. 이 정보는 측정한 환경을 설명할 뿐 다른 환경의 지원을 입증하지 않습니다.

## 실행 경로

모든 케이스는 다음 경로를 거칩니다.

- 저장소의 실제 실행기 `bin/codex-ghcp`
- 실행기가 띄우는 bridge(`src/server.mjs`), 실제 Copilot SDK와 정확한 모델
- 전용 PTY에서 실행하고 headless Chromium의 xterm.js로 렌더링하는 실제 Codex 0.154.0 TUI
- Playwright 키보드 입력(`/model`, 방향키, Enter, Escape)과 붙여넣기. 화면은 xterm.js 버퍼에서 읽음

격리:

- 케이스마다 별도 `HOME`·`CODEX_HOME`·작업 폴더를 사용하며, 실제로 공유하는 것은 Copilot 인증뿐입니다.
- 승인 정책은 `never`이며 시나리오마다 샌드박스를 고정합니다. 표식은 케이스마다 무작위로 만듭니다.
- 케이스 자동 재시도·출력 재작성·케이스 대체는 없습니다. 운영 bridge의 출력 전 복구는 켜 두고 관측하며, 하네스 재시도가 아닙니다.
- 사용 중인 사용자 bridge·설정은 재시작하거나 바꾸지 않습니다.

## 검사 사양 변경 이력

- **v3**는 첫 진행·스트리밍 감시 설정의 분리를 요구합니다. 이전 결과는 당시 저장된 소스로만 검증합니다.
- **v2**는 U03의 인증정보처럼 보이던 `notes/token.txt`·`token=` fixture를 `notes/sample.txt`·`sample_id=`로 바꿨습니다. 무작위 샘플 값은 여전히 프롬프트에 없으며 실제 Codex 도구로 읽어야 합니다. 안전 필터나 승인을 우회하지 않습니다. v1의 거절은 해당 과거 결과에서 실패로 남습니다.

## 한계

- 제한된 시간의 실행이며 여러 시간 내구성 인증이 아닙니다.
- 데스크톱 터미널 앱 자체는 검사하지 않습니다.
- U09·U10의 회상은 모델의 요약·답변 품질에도 영향을 받습니다.
- tier·watchdog 설정 검사는 전체 문맥을 채운 추론 용량이나 장애 주입 복구를 입증하지 않습니다. `npm run test:context:runtime`은 SDK 대역으로 운영 제한값에서 첫 진행을 실제 95초 지연하는 검사, 루트 단계 비공개 바이트 진행, 무응답·설정·취소·반복 도구 회귀 검사를 따로 실행합니다. 이 결과는 실모델 점수에 더하지 않습니다.
- 오프라인 runtime에는 Copilot 런타임 프로세스가 없으므로 런타임 MCP 격리는 실모델 실행으로만 확인합니다.
