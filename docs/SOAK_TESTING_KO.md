# 실제 Codex 장기 대화 내구성 검증

[English](SOAK_TESTING.md) · [검증 안내](../README_KO.md#개발과-검증) · [TUI 시나리오](TUI_SCENARIOS_KO.md) · [검증 기록](validation/README_KO.md)

한 모델의 제한된 시간 터미널 작업은 `test:terminal`, 장기 네이티브 대화와 선택적 터미널 검사는 `test:soak`를 사용합니다. 둘 다 66건 안정성 행렬과 별개입니다. **soak의 `--smoke`도 실모델을 호출합니다.** 계획과 SDK 대역 runtime 검사만 추론 사용량이 없습니다.

아래는 재현 안내이지 5시간 안정성의 증거가 아닙니다. 중단한 실행은 미완료로 유지합니다. Playwright는 실제 Codex PTY 바이트를 xterm.js로 표시하며 데스크톱 터미널 앱 자체를 검증하지는 않습니다.

**목적별 바로가기:** [준비 사항](#준비-사항과-오프라인-검사) · [짧은 터미널 실행](#재현-가능한-터미널-검사) · [smoke](#짧은-실모델-smoke) · [5시간 실행](#5시간-실모델-실행) · [결과 읽기](#결과-읽기).

## 준비 사항과 오프라인 검사

### 계획

`npm ci` 후 저장소 루트에서 필요한 계획을 확인합니다. 계획은 **모델 호출 없이** 실행하며 Codex·Python·Chromium이나 Copilot 로그인이 필요하지 않습니다.

```sh
npm run test:terminal -- --plan --driver playwright
npm run test:soak -- --plan
```

### 오프라인 runtime

실행·runtime 검사에는 **Node 22.12 이상과 Codex 0.154.0**, 터미널 경로에는 **Python 3**도 필요합니다. [CLI 설치 단계](../README_KO.md#2-의존성-설치)를 따르면 되며 오프라인 검사에는 Copilot 로그인이 필요하지 않습니다. Chromium은 Playwright 드라이버와 터미널 runtime 검사에만 필요합니다.

```sh
npx --no-install playwright install chromium
```

Linux의 라이브러리 오류는 [Chromium 설치 안내](TUI_SCENARIOS_KO.md#오프라인-runtime)를 참고하세요. 실제 Codex와 SDK 대역으로 두 터미널 드라이버를 **모델 호출·Copilot 로그인 없이** 확인합니다.

```sh
npm run test:terminal:runtime
```

## 재현 가능한 터미널 검사

**Copilot 사용량이 발생합니다.** [runtime 준비 사항](#오프라인-runtime)과 [Copilot 계정 확인](../README_KO.md#3-설치와-계정-접근-확인)을 마치세요. 아래 두 예시는 준비 절차가 아니라 **하나를 선택하는 대안**입니다. 출력 디렉터리는 매번 새로 선택하세요.

아래는 테스트 실행기의 옵션입니다. `test:terminal`은 launcher의 `--ghcp-model`과 달리 `--model`을 사용합니다.

PTY 드라이버로 실측 대화 120초:

```sh
npm run test:terminal -- --execute --driver pty --model gpt-6-astra \
  --duration-seconds 120 --output .runtime/terminal-pty-new
```

또는 더 큰 입력·출력으로 Playwright 드라이버 실행:

```sh
npm run test:terminal -- --execute --driver playwright --model claude-sonnet-5 \
  --duration-seconds 120 --payload-bytes 24576 --response-words 1000 \
  --output .runtime/terminal-browser-new
```

단독 검사의 기간은 1~86,400초이며 준비 이후의 최소 실측 대화 시간입니다. 5시간 인증이 아니며 마지막 진행 중 턴에는 별도 제한 시간이 있습니다. `Ctrl+C`/`SIGTERM`은 작업을 취소하고, 부분 실행을 통과로 바꾸지 않습니다. 입력 데이터는 128~65,536바이트, 응답 요청은 0~3,000단어이며 0이면 완료 표식만 요청합니다. 실제 출력 크기를 기록하고 선언된 최소 문자 분량과 비교하므로 프롬프트에 요청했다는 사실만으로 장문 응답을 인정하지 않습니다. 모델은 bridge의 허용 6개 ID 중 선택하고 자동 대체하지 않습니다.

입력은 다음 턴에 필요한 만큼 지연 생성하여, 시작 시 하루 분량의 장문 프롬프트를 한꺼번에 메모리에 올리지 않습니다. 파서는 Codex의 스크롤 영역을 반영해 긴 답변의 마지막 표식이 입력창 갱신 중 사라지지 않게 합니다. 터미널 종료 후 늦게 도착하는 브라우저 입력 callback도 증거 파일을 닫기 전에 차단합니다.

두 드라이버는 동일한 private PTY 수명·워크로드·성공 기준을 공유합니다. Playwright는 브라우저에서 프롬프트·Escape를 입력하고 xterm.js는 실제 터미널 바이트와 장치 질의 응답을 처리합니다. 화면의 고유 완료 표식과 정확한 모델의 루트 SDK 응답을 함께 대조하며, 화면만 보고 실모델 성공으로 처리하지 않습니다. 필터·SDK 오류·실패 SSE·짧거나 누락된 응답·시간 초과·정리 실패는 그대로 실패입니다. 새 출력 폴더에 보고서·heartbeat·SDK/HTTP 요약·터미널 증거·브라우저 스크린샷을 저장하고 HTML·Python까지 소스 동결에 포함합니다.

비민감 합성 데이터만 전송합니다. `HOME`·`CODEX_HOME`·작업 폴더·bridge는 검사 소유이며 read-only 샌드박스와 승인 거절을 유지합니다. 실모델 자식 환경에는 필요한 SDK 인증·프록시 설정만 유지합니다. 브라우저는 공개 서비스를 열거나 사용자 브라우저 프로필을 사용하지 않습니다. 감독자는 취소 시 분리된 PTY·브라우저를 정리할 제한 시간을 준 뒤 필요하면 강제 종료합니다.

## 통합 soak 실행기

smoke와 내구성 중 목적에 맞게 선택하세요. 5시간 실행 전에 smoke를 반드시 실행할 필요는 없습니다.

### 짧은 실모델 smoke

**Copilot 사용량이 발생하며 오프라인 검사가 아닙니다.** 짧은 실행에서 실제 GPT-6 Luna와 Claude Sonnet 5를 호출합니다. [runtime 준비 사항](#오프라인-runtime)과 [Copilot 계정 확인](../README_KO.md#3-설치와-계정-접근-확인)을 마친 뒤 새 출력 폴더를 사용하세요.

```sh
npm run test:soak -- --smoke --duration-seconds 60 --output .runtime/soak-smoke-new
```

PTY를 추가하려면 `--terminal`, 브라우저 렌더링을 추가하려면 `--terminal --terminal-driver playwright`를 붙입니다. 새 실행의 선택 사항이지 장기 검사 전에 모두 수행해야 하는 단계가 아닙니다. smoke 기간은 1~600초이며 내구성 통과로 계산하지 않습니다.

### 5시간 실모델 실행

**Copilot 사용량이 지속적으로 발생합니다.** 준비 완료 후 선언한 모든 lane에서 최소 18,000초를 측정해야 하며 준비·정리 시간은 별도입니다. 시작 전에 [runtime 준비 사항](#오프라인-runtime)과 [Copilot 계정 확인](../README_KO.md#3-설치와-계정-접근-확인)을 마치세요.

```sh
npm run test:soak -- --execute --output .runtime/soak-five-hours-new
```

출력 폴더는 매번 새로 만듭니다. 실행 전에 소스를 동결하고 그 복사본에서 소유 worker를 실행합니다. `implementationUnchanged`는 개발 작업 트리의 변경 여부, `frozenSourceUnchanged`는 실제 실행한 동결 소스의 무결성을 각각 나타냅니다. 개발 중 파일을 바꿔도 실행 중인 worker의 코드가 몰래 바뀌지 않습니다. 결과를 66건 점수에 합산하거나 과거 실행에 대입하지 않습니다.

## 결과 읽기

선택한 출력 폴더의 `report.json`을 확인하세요. 이 두 실행기는 별도 `--verify` 명령을 제공하지 않습니다.

| 실행 | 확인할 필드 | 통과의 의미 |
| --- | --- | --- |
| `test:terminal -- --execute` | `passed: true` | 지정한 단기 작업·시간·증거·정리 조건 충족. 5시간 내구성은 아님 |
| `test:soak -- --smoke` | `allLanesCompleted`·`noObservedFailures`·`frozenSourceUnchanged`가 모두 `true` | 짧은 작업 통과. 최상위 `durationMet`는 의도적으로 `false` 유지 |
| `test:soak -- --execute` | 위 세 필드와 `durationMet: true` | 모든 lane에서 관측된 실패 없이 최소 5시간 충족. 최대 문맥 인증은 아님 |

종료 코드 **0**은 유효한 계획 또는 선택한 모드 통과, **1**은 실패·미완료, **2**는 인자·실행기 오류입니다. smoke 성공도 내구성 통과는 아닙니다. 중단 후 다시 실행하기 전에 기존 보고서를 먼저 확인하세요.

## 오프라인 회귀 검사 범위

`npm run test:context:runtime`은 기계적인 SDK 대역으로 네이티브 도구 120회·반복 압축과 무응답 제한·설정 제한·Escape 후 같은 TUI의 복구를 검사합니다. 예상 오류 항목은 실제 오류 문구와 다음 요청 성공을 요구하며 터미널 재시작으로 대신하지 않습니다. 장식용 화면 갱신을 준비·완료로 판단하지 않습니다.

운영 기본값인 첫 진행 180초·스트리밍 제한 90초에서 첫 진행을 **실측 95초** 지연시키고, SDK 세션 1개·프롬프트 제출 1회·복구 없음·다음 요청 성공도 요구합니다. 다른 항목은 무응답 복구·바이트 전용 및 루트 단계 진행을 확인하며 비공개 단계 내용은 노출하지 않습니다. 제한된 SDK 대역 회귀 검사이지 원격 모델 가용성·최대 문맥 인증이 아닙니다.

## 네이티브 작업

- **GPT-6 Luna:** 실제 모델 catalog가 알리는 최대 문맥 등급의 입력 예산과 자동 압축을 사용하는 지속 대화입니다. 매 턴 새로 갱신한 8 KiB 비활성 합성 데이터를 네이티브 도구로 읽고 sample 식별자를 반환합니다.
- **Claude Sonnet 5:** 같은 작업에 **131,072 토큰 클라이언트 문맥 설정**, 98,304 토큰 자동 압축, 성공한 40번째 턴 슬롯마다 명시적 네이티브 압축을 적용합니다. 이는 가속한 클라이언트 문맥 스트레스이며 공급자 최대 문맥을 시험했다는 뜻은 아닙니다.
- **선택적 터미널 lane:** `--terminal`은 GPT-6 Luna의 실제 Codex TUI를 추가하고 65,536 토큰 클라이언트 설정을 명시합니다. 기본 `pty`는 독립 터미널 파서, `--terminal-driver playwright`는 headless xterm.js를 사용합니다. 터미널 결과와 app-server 결과는 별도 범위입니다.

턴 시작 간격은 기본 최소 25초입니다. fixture·`HOME`·`CODEX_HOME`은 테스트 전용이며 네이티브 대화는 읽기 전용, 예상하지 못한 도구와 권한 승인은 거절합니다. 기존 사용자 브릿지·설정은 재시작하거나 바꾸지 않습니다. 생산 요청·턴·작업별 정리 제한 시간은 유지합니다.

새 sample은 순번으로 갱신 사실을 명시합니다. 숨겨진 식별자는 도구 callback으로만 알아냅니다. 초기 짧은 검사에서 동일하고 모호한 요청에 이전 sample을 재사용하는 현상이 나왔으며 실패 기록은 유지합니다. 장기 작업은 sample 변경과 이번 턴의 새 읽기 1회를 명시하도록 수정했습니다.

## 감시와 실패 증거

worker는 5초 heartbeat를 쓰고 네이티브·SDK 이벤트를 턴별로 저장합니다. HTTP는 커지는 전체 요청을 계속 복제하지 않고 바이트 수·해시·마지막 SSE 종류·오류 코드를 기록합니다. 오류 시 정제한 로컬 상세 증거를 따로 남깁니다. 턴별 배열은 저장 후 비워 관측 코드가 계속 메모리를 쌓지 않도록 합니다.

독립 supervisor는 15초마다 테스트 소유 worker·자식의 CPU와 RSS를 측정합니다. worker heartbeat 자체의 정지와 정상 동작하는 worker의 긴 모델 응답 대기는 다른 범주로 기록합니다. heartbeat 120초 정지 또는 턴·압축 480초 초과 시 증거를 저장하고 해당 소유 프로세스 그룹만 제한 시간 안에 종료합니다. 90초부터 긴 응답 경고를 남기지만 이를 곧바로 deadlock으로 판정하지 않습니다.

기존 단기 실행기는 transcript 8 MiB·stderr 1 MiB 기본값을 유지합니다. 장기 실행만 transcript 512 MiB·턴별로 비우는 stderr 16 MiB 예산을 명시적으로 사용합니다. 예산 초과는 여전히 오류이며 조용히 잘라 성공 처리하지 않습니다.

내구성 실행기는 실패 요청을 재시도하거나 성공으로 바꾸지 않습니다. 생산 브릿지의 제한적인 출력 전 무응답 복구는 원래 요청 안에서 감시·복구 진단과 함께 수행하며 턴·요청 제한을 초기화하지 않습니다. 최종 실패한 요청은 실패로 남습니다. 실패 세션 뒤 복구 확인을 위해 **새 thread를 명시적으로 기록하고** 이어갈 수 있지만 실패한 턴은 남습니다. 연속 실패 3회면 해당 lane을 중단해 조사합니다. 정리 오류·미확정 결과·미달한 시간은 그대로 표시합니다.

장기 실행의 `durationMet`는 모든 선언된 lane에서 실제 5시간 이상을 충족해야 합니다. 성공·실패 턴, 실제 요청 처리 시간, 전체 측정 시간, 최대 관측 입력 토큰·이력 크기·RSS, 압축 횟수, 복구 thread와 프로세스 그룹 정리를 따로 보고합니다. 턴 간 대기 시간은 모델 처리 시간이 아니며 시간만 채웠다고 최대 문맥에 도달한 것은 아닙니다.

원시 자료는 ignored `.runtime`에 보존하고 공개 전 정제합니다. 네이티브 app-server 실행만으로 대화형 터미널 렌더러까지 시험했다고 주장하지 않습니다. 실제 터미널 PTY 검증은 별도로 표시하고 확인해야 합니다.
