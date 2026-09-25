# 사용법과 문제 해결

[English](USAGE.md) · [빠른 시작](../README_KO.md) · [호환성](COMPATIBILITY_KO.md) · [구조](ARCHITECTURE_KO.md)

[빠른 시작](../README_KO.md#빠른-시작)을 한 번 마친 뒤 필요한 작업의 절로 이동하세요. 일반 실행에는 `.env` 파일이나 셸 설정이 필요하지 않습니다. `./bin/...` 명령은 이 저장소 루트에서 실행하고, 다른 프로젝트에서는 실행기의 절대 경로를 사용하세요.

| 목적 | 안내 |
| --- | --- |
| Codex 시작·재개, Codex 옵션 전달 | [Codex 실행](#codex-실행) · [대화 재개](#대화-재개) · [입력 위치](#codex-명령과-옵션-전달) |
| 다른 저장소에서 작업 | [다른 프로젝트에서 사용](#다른-프로젝트에서-사용) |
| 세션 사이에 bridge 하나를 계속 실행 | [선택적 상주 bridge](#선택적-상주-bridge) |
| 모델 전환·문맥 한도 이해 | [모델 선택과 문맥](#모델-선택과-문맥) |
| 모델·포트·제한 시간 등 한도 변경 | [실행기 설정](#실행기-설정) · [제한 시간과 복구](#제한-시간과-복구) |
| 바꾼 설정·코드 적용 | [안전한 bridge 재시작](#안전한-bridge-재시작) |
| 오류 해결 | [문제 해결](#문제-해결) |
| Codex 없이 HTTP 서버 실행 | [서버 직접 실행 (고급)](#서버-직접-실행-고급) |
| `codex` 명령을 이 실행기에 연결 | [선택적 zsh 연동](#선택적-zsh-연동) |

## Codex 실행

| 목적 | 명령(저장소 루트에서 실행) |
| --- | --- |
| 대화형 세션 | `./bin/codex-ghcp` |
| 현재 디렉터리의 최근 대화 재개 | `./bin/codex-ghcp -- resume --last` |
| bridge 없이 실행기 도움말 확인 | `./bin/codex-ghcp --help` |
| bridge 없이 공식 Codex 도움말 확인 | `command codex --help` |

실행할 때마다 빈 루프백 포트에 전용 bridge를 시작하고, Codex가 종료되면 정리합니다. 종료하려면 작업이 끝난 Codex에서 `/quit`을 입력하세요. 별도 중지 명령은 필요하지 않습니다.

### 다른 프로젝트에서 사용

이 저장소가 아니라 **Codex로 작업할 프로젝트에서 터미널을 열고** 실행기를 절대 경로로 실행하세요. 현재 디렉터리가 그대로 유지됩니다. clone 위치가 `$HOME/GitHub/openai-codex-ghcp-sdk`인 경우:

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp"
```

다른 위치에 clone했다면 경로를 바꾸세요. 모든 실행기 옵션은 절대 경로로 실행할 때도 똑같이 동작합니다.

### 대화 재개

**원래 작업하던 프로젝트에서** 실행하세요. 그 프로젝트가 이 저장소가 아니라면 실행기의 절대 경로를 사용합니다.

```bash
./bin/codex-ghcp -- resume --last
```

Codex가 해당 디렉터리에 저장된 가장 최근 대화를 엽니다.

**재개하는 것은 이력이며 모델은 아닙니다.** 실행기가 `--ghcp-model`, `GHCP_MODEL`, `gpt-6-astra` 순으로 모델을 다시 정합니다. Sonnet으로 재개하려면:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last
```

- **종료하기 전에** 현재 턴이 끝날 때까지 기다리거나 Esc로 취소하세요. 새 bridge는 Codex에 저장된 이력으로 대화를 다시 구성하지만, 이전 bridge에서 결과를 기다리던 도구 호출은 복원하지 못합니다.
- **재개 중 [대화 상태 오류](#대화-상태-오류-404-409)가 나면** `/new`로 새 대화를 시작하세요. 이미 실행한 도구를 다시 실행하지 마세요.
- **약간의 차이가 있을 수 있습니다.** 다시 구성한 대화는 원래 세션과 [완전히 같지는 않습니다](ARCHITECTURE_KO.md#살아-있는-sdk-세션-없이-재개하기).

### Codex 명령과 옵션 전달

실행기 옵션은 `--` 앞에, Codex 자체의 명령·옵션은 뒤에 둡니다. 대괄호는 생략할 수 있는 부분을 표시하며 그대로 입력하지 않습니다.

```text
./bin/codex-ghcp [실행기 옵션] -- [Codex 명령·옵션] [프롬프트]
```

예를 들어 모델을 선택하고 비대화형·읽기 전용 요청을 보내려면:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- exec --sandbox read-only \
  "README_KO.md를 읽고 프로젝트의 목적을 한 문장으로 요약해줘."
```

| 입력 | 위치 |
| --- | --- |
| 실행기 옵션: `--ghcp-model`, `--bridge-port`, `--bridge-background` | `--` 앞 |
| Codex 명령·옵션: `exec`, `resume`, `--sandbox`, `-c` | `--` 뒤 |
| 슬래시 명령: `/model`, `/compact`, `/new`, `/quit` | 셸이 아니라 실행 중인 Codex 안 |

**거절하는 옵션.** 실행기는 bridge 연결을 바꾸거나 bridge에 없는 기능이 필요한 Codex 옵션을 거절합니다.

- `--model`/`-m`: 대신 `--ghcp-model`을 사용하세요.
- `--profile`/`-p`, `--oss`, `--local-provider`, `--remote`, `--remote-auth-token-env`, `--search`.
- 모델·공급자·모델 목록·프로필·웹 검색이나 실행기가 끈 기능에 대한 `-c`·`--enable` 설정.

다른 옵션은 Codex에 전달되어 Codex가 유효성을 검사합니다. 승인·샌드박스 옵션의 의미는 그대로이며, 옵션이 허용된다고 요청한 모든 기능이 지원되는 것은 아닙니다. 특히 `exec --json`은 Codex의 이벤트 로그이지 [모델 출력에 스키마를 강제하는 기능](COMPATIBILITY_KO.md#이-기능을-사용할-수-있나요)이 아닙니다.

Git 저장소 밖에서는 `exec` 뒤에 `--skip-git-repo-check`를 추가하세요. Git 검사만 생략합니다.

### 선택적 상주 bridge

기본적으로 Codex 프로세스마다 전용 bridge를 사용합니다. Codex 종료 후에도 bridge 하나를 계속 실행해 이후 세션에서 재사용하려는 경우에만 상주 방식을 사용하세요.

**시작·재사용:** 이 bridge를 사용할 **모든** 실행에 `--bridge-background`를 지정합니다.

```bash
./bin/codex-ghcp --bridge-background --ghcp-model gpt-6-astra
```

이 옵션 없이 실행하면 별도의 foreground bridge를 시작하며, 상주 bridge는 계속 실행됩니다.

**상태 확인:** `./bin/codex-ghcp-status`는 상주 bridge에 대한 JSON만 출력합니다. foreground bridge는 표시하지 않습니다.

| `state` | 의미·조치 |
| --- | --- |
| `running` | 등록된 bridge가 응답하고 로컬 인증 정보를 확인했습니다. `ready`와 `upstreamState`는 별도로 SDK 준비 상태를 표시하며, 모델의 실제 응답을 보장하지는 않습니다. |
| `stopped` | 등록된 상주 bridge가 없습니다. foreground bridge는 실행 중일 수 있습니다. |
| `stale` | 등록된 프로세스가 종료됐습니다. 다음 상주 실행이 등록 정보를 교체합니다. |
| `unverified` | 프로세스는 있지만 신원이나 로컬 인증 정보를 확인하지 못했습니다. 출력된 `log` 파일을 확인하고, 등록된 PID만 보고 프로세스를 종료하지 마세요. |

상태 확인·중지는 모델 목록 조회 대신 인증된 `/readyz` 검사를 사용하므로 SDK 재연결을 유발하지 않습니다. 신원을 확인한 bridge는 `running`이면서 `ready=false`일 수 있으며, 상위 서비스 장애 중에도 중지할 수 있습니다.

**중지:** 다른 프로젝트의 세션을 포함해 이 bridge를 쓰는 **모든** Codex 세션을 닫은 뒤에만 중지하세요.

```bash
./bin/codex-ghcp-stop
```

중지하면 bridge 메모리의 대화와 대기 중인 도구 호출이 사라집니다. Codex에 저장된 이력은 남으므로 나중에 [재개](#대화-재개)할 수 있습니다. 상태 확인·중지는 이 저장소의 명령이며 Codex 옵션이 아닙니다.

상주 bridge 등록 정보는 모든 작업 프로젝트가 공유하며, bridge를 시작한 clone에 속합니다. 다른 clone에서는 재사용을 거절합니다. 두 번째 clone을 사용하려면 별도 `GHCP_DAEMON_DIR`을 지정하고 **실행·상태 확인·중지에 같은 값**을 사용하세요.

## 모델 선택과 문맥

[지원 모델 6개](../README_KO.md#모델)의 ID만 허용합니다. 실행기는 `--ghcp-model`, `GHCP_MODEL`, `gpt-6-astra` 순으로 시작 모델을 정합니다. 사용할 수 없는 모델은 실패하며, bridge가 다른 모델로 자동 전환하지 않습니다.

계정에서 사용할 수 있는 모델을 확인합니다.

```bash
./bin/ghcp-models --json
```

그중 하나로 시작합니다. 예:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

**대화 중 모델을 바꾸려면** Codex 안에서 `/model`을 입력하세요. 계정에서 사용할 수 있는 모델만 정해진 순서로 표시하며, 목록을 갱신하려면 다시 실행합니다. 목록에 있는 모델도 일부 Codex 기능을 지원하지 않을 수 있으니 [호환성](COMPATIBILITY_KO.md)을 확인하세요.

Codex 0.154.0의 모델 선택 화면 표시는 다음 뜻입니다.

| 표시 | 의미 |
| --- | --- |
| `(current)` | 현재 대화에서 사용하는 모델. |
| `(default)` | 목록의 첫 항목. 6개 모두 사용 가능하면 `claude-opus-5.5`이며, **실행기의 기본 모델이 아닙니다.** |

**`/model`은 `~/.codex/config.toml`에 `model`과 `model_reasoning_effort`도 저장합니다.** 다음 실행에서 사용할 모델은 실행 방법에 따라 다릅니다.

- **이 실행기**는 여전히 `--ghcp-model`, `GHCP_MODEL`, `gpt-6-astra` 순으로 모델을 정합니다.
- **공식 CLI**(`command codex` 또는 [zsh 연동](#선택적-zsh-연동)의 `codex-original`)는 저장된 선택을 사용합니다. 필요하면 공식 CLI에서 되돌리세요.

실행기의 임시 모델 목록은 상주 방식에서도 Codex가 종료되면 삭제합니다. 저장된 선택까지 되돌리지는 않습니다. [목록 구현](ARCHITECTURE_KO.md#모듈)을 참고하세요.

### 문맥 한도

- bridge는 **SDK가 지원을 명시하면 `long_context`, 아니면 `default`**를 선택하며 모델 전환·복구 후에도 유지합니다. 실행기는 문맥 예산이 없거나 잘못되면 Codex 기본값으로 대체하지 않고 거절하며, 상위 서비스가 tier를 거절해도 다른 tier로 조용히 재시도하지 않습니다.
- Codex에는 알려진 prompt·context 한도를 따르는 **입력 예산**을 전달하고, 유효한 최대 출력 크기가 있으면 그 공간을 예약합니다. 이 예산이 공급자의 전체 문맥 창과 같은 것은 아닙니다.
- Codex는 이 예산의 **80%**에서 대화를 자동 압축합니다. SDK 자체의 자동 압축은 꺼져 있습니다. 턴 사이에 `/compact`를 직접 실행할 수도 있습니다.
- 큰 문맥은 지연·메모리 사용·사용 비용을 늘릴 수 있습니다. Codex의 `model_context_window`만 SDK 예산보다 높이지 마세요.
- 새 모델 목록 한도나 바뀐 설정을 적용하려면 Codex를 정상 종료한 뒤 다시 실행하세요.

구현 상세: [tier 선택과 예산 계산](ARCHITECTURE_KO.md#문맥-예산).

## 설정

### 실행기가 바꾸는 설정

실행할 때마다 실행기는 다음을 적용합니다.

- `-c` 인자로 Codex가 bridge에 연결하도록 설정하고, 생성한 **로컬 bridge 토큰**을 Codex 프로세스 환경 변수로 전달합니다. 이 토큰은 GitHub·OpenAI 인증정보가 아닙니다.
- bridge가 지원하지 않는 Codex 기능인 WebSocket·요청 압축·호스팅 웹 검색·원격 compaction·reasoning summary를 끕니다.
- Copilot 런타임 자체의 MCP 서버(사용자·플러그인 서버 포함)를 끈 상태로 Copilot 세션을 시작합니다. Codex의 MCP 서버는 Codex가 직접 실행하므로 그대로 동작합니다. [도구 호출 왕복](ARCHITECTURE_KO.md#도구-호출-왕복)을 참고하세요.

실행기는 `~/.codex/config.toml`, `auth.json`, 셸 시작 파일이나 다른 프로젝트의 서버를 수정하지 **않으며**, Copilot·GitHub 로그인을 Codex로 복사하지 않습니다. 다른 Codex 설정은 그대로 적용되며 새 Codex 프로필을 만드는 것도 아닙니다. Codex·SDK는 세션 데이터를 기록할 수 있고 Codex 도구는 설정된 권한 안에서 프로젝트 파일을 수정할 수 있습니다. `/model`의 Codex 설정 저장과 선택적인 [zsh 연동](#선택적-zsh-연동)의 `~/.zshrc` 수정은 실행기의 임시 연결 설정과 별개입니다.

### 실행기 설정

모든 설정은 선택 사항입니다. 환경 변수는 셸에서 지정하거나 명령 앞에 붙이세요. 실행기는 `.env`를 **읽지 않습니다.**

| 바꿀 항목 | 옵션 또는 환경 변수 | 기본값 |
| --- | --- | --- |
| 시작 모델 | `--ghcp-model`(`GHCP_MODEL`보다 우선) | `gpt-6-astra` |
| 루프백 포트 | `--bridge-port`(`GHCP_BRIDGE_PORT`보다 우선) | `0`: 빈 포트 선택 |
| 공식 Codex 실행파일 | `CODEX_BIN` | `PATH`의 `codex` |
| 기존 Copilot 로그인 디렉터리 | `COPILOT_HOME` | `~/.copilot` |
| 상주 bridge 등록 정보·로그 디렉터리 | `GHCP_DAEMON_DIR` | 사용자별 OS 캐시 디렉터리. 실행·상태 확인·중지에 같은 값을 사용 |
| 제한 시간·대기열·크기 한도 | [제한 시간과 복구](#제한-시간과-복구) | 해당 표 참고 |

`PORT`는 [서버 직접 실행](#서버-직접-실행-고급)에만 적용합니다. 상주 bridge는 시작할 때의 설정을 유지하므로, 설정을 바꾸려면 [재시작](#안전한-bridge-재시작)하세요.

### 제한 시간과 복구

`_MS` 설정은 **밀리초**, `_BYTES`는 **바이트**, 복구 시도·요청 한도는 **개수**입니다. 복구해도 턴·요청 제한 시간은 초기화되지 않으며 정리는 작업별 별도 제한을 사용합니다. 새 값은 [bridge를 재시작](#안전한-bridge-재시작)해야 적용됩니다.

| 설정 | 기본값 | 제한 대상 |
| --- | --- | --- |
| `SDK_STARTUP_TIMEOUT_MS` | 30000(30초) | SDK 시작·준비 확인 ping·모델 목록 초기화와 세션 생성·모델 변경. 세션 설정에는 턴 제한도 적용됩니다. |
| `TURN_FIRST_PROGRESS_TIMEOUT_MS` | 180000(3분) | 시도마다 모델의 첫 진행을 기다리는 시간. 턴 시작 메타데이터·재시도 안내·keepalive로는 초기화되지 않습니다. |
| `TURN_IDLE_TIMEOUT_MS` | 90000(90초) | 진행이 시작된 뒤의 무응답. 텍스트·추론·도구 입력과 증가하는 SDK·단계 바이트 수가 초기화합니다. |
| `TURN_TIMEOUT_MS` | 300000(5분) | 복구 시도를 포함한 모델 턴 전체. |
| `REQUEST_TIMEOUT_MS` | 360000(6분) | 대기열 대기·SDK 작업·복구를 포함한 요청 전체. HTTP 본문 수신은 제외합니다. |
| `TURN_IDLE_RECOVERY_ATTEMPTS` | 1 | 요청당 무응답·전송 오류 세션 복구가 공유하는 0–3회 한도. 0은 이 재시도를 끄며 SDK 연결·목록 복구는 별개입니다. |
| `MAX_REQUESTS_PER_SESSION` | 8 | 대화별 실행 중 + 대기 중 요청 수. |
| `MAX_REQUESTS` | 128 | 전체 실행 중 + 대기 중 요청 수. |
| `SDK_READINESS_TIMEOUT_MS` | 2000 | 로컬 SDK ping 제한. |
| `SDK_READINESS_INTERVAL_MS` | 15000 | 백그라운드 연결 검사 간격. 턴 감시 진단은 이 값·첫 진행 제한·무응답 제한 중 최솟값을 사용합니다. |
| `SDK_RECOVERY_BACKOFF_MS` | 5000 | 실패한 연결 복구 시도 사이의 최소 간격. |
| `CLEANUP_TIMEOUT_MS` | 5000 | 소유한 SDK 세션의 abort·disconnect·delete 또는 client force-stop 등 각 정리 작업의 제한. |
| `MAX_REPLAY_BYTES`, `MAX_BODY_BYTES` | 33554432(32 MiB) | 직렬화한 이력과 HTTP 요청 본문 크기. 모델 토큰 한도가 아니라 메모리 보호 장치입니다. |

이 표에서 `TURN_IDLE_RECOVERY_ATTEMPTS`를 제외한 값은 양의 정수여야 합니다. 턴·요청 제한은 여러 도구를 사용하는 Codex 작업 전체가 아니라 bridge의 Responses 요청 하나에 적용됩니다. 요청 제한에는 대기열과 설정 시간이 포함되며 턴 제한은 최초 세션 설정 뒤에 시작합니다. 나머지 한도와 기본값은 [`.env.example`](../.env.example)에 있습니다.

**자동 복구.** 모델 턴이 제한 시간을 넘겨 응답이 없거나 출력 전 전송 오류로 종료된 것이 확인되면, bridge는 Copilot 세션을 교체하고 같은 응답 스트림에서 턴을 다시 시도할 수 있습니다. 두 원인이 기본 **요청당 한 번**의 한도를 공유하며, 일치하는 구조화된 전송 오류 근거가 없는 query 오류는 재시도하지 않습니다.

- **조건:** 입력 접수가 확인되고 현재 시도에서 assistant 텍스트·메시지가 관측되지 않았으며 대기 도구 호출이 없어야 합니다. 이전 세션 정리와 같은 client generation의 준비 상태도 확인합니다. 전송 오류 복구는 해당 시도에서 추론·도구 입력·스트리밍 바이트 등 모델 진행도 없어야 합니다.
- **그대로인 것:** 원래 턴·요청 제한 시간. 완료된 도구 결과 RPC는 다시 제출하지 않지만 세션 재구성 시 결과 내용을 과거 문맥에 포함할 수 있습니다. 추론이 정확히 한 번 실행된다는 보장은 아닙니다.
- **비용:** 재시도에 추가 Copilot 사용량이 발생할 수 있습니다.
- **세션 복구 재시도 끄기:** `TURN_IDLE_RECOVERY_ATTEMPTS=0`을 지정하세요. 실행기는 Codex의 HTTP·스트림 자동 재시도를 끕니다. 읽기 전용 SDK 연결·목록 복구와 SDK·공급자 내부 재시도는 별개입니다.

[복구 상세](ARCHITECTURE_KO.md#모델-진행과-복구)를 참고하세요.

| 오류 코드 | HTTP | 의미 |
| --- | --- | --- |
| `copilot_idle_timeout` | 504 | 첫 진행 대기 또는 무응답 제한 안에 모델 진행이 없었습니다. 메시지에 `phase`가 표시됩니다. |
| `copilot_transport_error` | 502 | 구조화된 모델 전송 오류입니다. 안전한 복구가 불가능하거나 차단됐거나 한도를 소진했습니다. |
| `copilot_setup_timeout` | 504 | SDK 세션 설정 또는 모델 설정 작업의 제한 시간이 만료됐습니다. |
| `copilot_timeout` | 504 | 복구를 포함한 턴 전체 제한이 만료됐습니다. |
| `request_timeout` | 504 | 대기열 대기를 포함한 요청 전체 제한이 만료됐습니다. |
| `request_queue_full` | 429 | 실행·대기 중인 요청이 너무 많습니다. 요청은 제출하지 않았습니다. |
| `upstream_unavailable` | 503 | SDK 연결의 준비 상태를 확보하지 못했습니다. 이 연결 복구 경로는 추론을 재시도하지 않습니다. |
| `upstream_session_lost` | 409 | Copilot 연결을 잃었습니다. 새 대화를 시작하세요. |

표의 HTTP 상태는 스트리밍 시작 전에 적용됩니다. 이미 시작한 SSE 응답은 HTTP 200을 유지하고 `response.failed`로 오류를 알립니다. 제한 시간 초과 시 조치는 [느린 응답과 연결 장애](#느린-응답과-연결-장애)를 참고하세요.

시작 중 `listModels`가 시간 초과되면 정리 성공을 확인한 뒤 같은 `SDK_STARTUP_TIMEOUT_MS` 예산(기본 30초) 안에서 SDK client를 한 번 교체할 수 있습니다. 첫 목록 조회는 예산의 절반(기본 15초)과 남은 시작 시간 안에서만 기다립니다. 정리는 별도의 기존 제한을 유지합니다. 이 읽기 전용 복구는 추론을 호출하지 않으며 인증 오류나 임의의 RPC 오류는 재시도하지 않습니다.

### 안전한 bridge 재시작

**bridge는 시작할 때의 코드와 설정을 유지합니다.** 수정한 소스 파일이나 바꾼 환경 변수를 적용하려면 재시작하세요. 터미널은 **원래 작업하던 프로젝트**에 유지합니다. 아래 경로는 clone 위치가 `$HOME/GitHub/openai-codex-ghcp-sdk`인 경우이며, 다른 위치라면 바꾸세요.

1. **Codex 안에서:** 현재 턴이 끝나기를 기다리거나 취소한 뒤 `/quit`을 입력합니다. 상주 bridge라면 이를 사용하는 Codex 세션을 모두 닫습니다.
2. **상주 방식만:** `"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp-stop"`을 실행합니다. 기본 foreground bridge는 Codex와 함께 이미 종료됐습니다.
3. **같은 작업 프로젝트에서** 재개합니다.

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- resume --last
```

이 저장소가 작업 프로젝트라면 `./bin/codex-ghcp -- resume --last`도 같습니다. 이 명령은 새 foreground bridge를 시작합니다. 새 bridge를 계속 실행하려면 `--` 앞에 `--bridge-background`를 추가하세요.

Codex 세션이 사용 중인 bridge는 절대 중지하지 마세요. 결과를 기다리던 도구 호출을 포함한 메모리 상태가 사라집니다. 실행 중인 bridge의 설정은 `/health.turnWatchdog`나 상주 bridge 상태에서 확인하세요. 현재 소스의 기본값이 아니라 실행 중인 값을 표시합니다.

## 문제 해결

아래에서 증상을 찾으세요. bridge가 지원하는 기능의 범위는 [호환성](COMPATIBILITY_KO.md)을 참고하세요.

### 시작과 설정

| 증상 또는 메시지 | 조치 |
| --- | --- |
| `./bin/...`: 파일을 찾을 수 없음 | 이 저장소 루트에서 실행하거나, 작업 프로젝트에서 [실행기의 절대 경로](#다른-프로젝트에서-사용)를 사용하세요. |
| doctor가 `ok: false` 또는 `supportedVersion: false`를 표시 | 실패한 항목을 확인하세요. SDK 불일치는 `npm ci`로, 도구 실패는 해당 CLI나 Node 버전을 설치·수정해 해결합니다. [고정된 설치 절차](../README_KO.md#빠른-시작)를 따르세요. |
| `Cannot run Codex` 또는 `requires Codex CLI 0.154.0 or newer` | `npm install -g @openai/codex@0.154.0`으로 고정 버전을 설치하거나 `CODEX_BIN`에 공식 실행파일을 지정하세요. |
| `Cannot list Copilot models` 등 인증 오류 | `copilot login` 후 `./bin/ghcp-models`를 실행하세요. 인증정보를 프롬프트나 소스 파일에 붙여 넣지 마세요. |
| `GitHub Copilot model is unavailable` 또는 `Unsupported model` | `./bin/ghcp-models`를 실행하고 상태가 `disabled`나 `not available`이 아닌 ID를 `--ghcp-model`에 지정하세요. 해당하는 모델이 없으면 Copilot 권한과 조직 정책을 확인하세요. 대체 모델은 없습니다. |
| Codex가 `--ghcp-model`을 알 수 없는 인자로 거절 | 실행기 옵션을 `--` **앞에** 두세요. 예: `./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last`. |
| `conflicts with GHCP routing` 또는 `conflicts with the GHCP bridge` | 해당 Codex 옵션은 bridge를 우회합니다([거절하는 옵션](#codex-명령과-옵션-전달)). 모델은 `--ghcp-model`로 선택하세요. 이름 있는 `--profile` 대신 개별 설정을 `--` 뒤에 전달하세요. 예: `-c 'model_reasoning_effort="low"'`. |
| `Reasoning effort ... is unavailable` | 메시지에 표시된 수준 중 하나를 `--` 뒤에 지정하세요: `-c 'model_reasoning_effort="low"'`. Haiku 4.5는 추론 수준을 설정할 수 없으며, bridge는 실패 대신 이 제한을 로그에 남깁니다. |
| `--help`나 `--version`이 bridge를 시작함 | 실행기 도움말은 `./bin/codex-ghcp --help`, 공식 CLI는 `command codex --help`나 `command codex --version`을 사용하세요. `--` 뒤의 인자는 평소처럼 bridge를 시작합니다. |
| `.env` 변경이 반영되지 않음 | 실행기는 `.env`를 읽지 않습니다. 셸에서 [환경 변수](#실행기-설정)를 지정한 뒤 [bridge를 재시작](#안전한-bridge-재시작)하세요. |
| `Bridge files or settings changed` | 상주 bridge가 이전 코드나 설정으로 실행 중입니다. 이를 사용하는 Codex 세션을 모두 닫고 중지한 뒤 다시 실행하세요([안전한 재시작](#안전한-bridge-재시작)). |
| `This bridge belongs to another checkout` | bridge를 시작한 clone을 사용하거나, 이 clone에 별도 `GHCP_DAEMON_DIR`을 지정해 실행·상태 확인·중지에 사용하세요. 다른 clone의 등록 정보는 삭제하지 마세요([상주 방식](#선택적-상주-bridge)). |
| 포트가 이미 사용 중 | 실행기가 빈 포트를 고르게 두거나(기본값), 서버 직접 실행이라면 `PORT`를 바꾸세요. 다른 프로젝트의 프로세스는 중지하지 마세요. |

### 대화 중 오류

| 증상 또는 코드 | 조치 |
| --- | --- |
| HTTP 404·409(예: `unknown_tool_call`, `tool_result_mismatch`) | bridge가 이 대화의 상태를 잃었거나 이어갈 수 없습니다. `/new`로 새 대화를 시작하세요. [코드별 의미](#대화-상태-오류-404-409)를 참고하세요. |
| `copilot_idle_timeout`, `copilot_timeout`, `copilot_transport_error`, `copilot_setup_timeout`, `upstream_unavailable`, `request_timeout`, `ETIMEDOUT` | 먼저 네트워크·프록시·서비스 상태를 확인한 뒤 [느린 응답과 연결 장애](#느린-응답과-연결-장애)와 [제한 시간](#제한-시간과-복구)을 참고하세요. 로컬 bridge가 정상이어도 모델 서비스를 사용할 수 있다는 뜻은 아닙니다. |
| `request_queue_full`(429) | 실행·대기 중인 요청이 너무 많습니다. 실행 중인 턴이 끝난 뒤 프롬프트를 다시 보내세요. |
| `context_length_exceeded` | Codex는 도구가 많은 턴에서도 자동 압축합니다. 오류가 계속되면 턴 사이에 `/compact`를 실행하거나 짧은 대화를 새로 시작하세요. 바이트 한도를 올려도 모델 문맥은 늘지 않습니다. |
| `history_too_large` 또는 `body_too_large`(413) | 짧은 대화를 새로 시작하거나, 메모리에 여유가 있으면 `MAX_REPLAY_BYTES`나 `MAX_BODY_BYTES`를 올리고 [bridge를 재시작](#안전한-bridge-재시작)하세요. 이 한도는 모델 문맥을 늘리지 않습니다. |

### 대화 상태 오류 (404, 409)

Codex가 보낸 대화 상태를 bridge가 더 이상 갖고 있지 않거나 안전하게 이어갈 수 없다는 뜻입니다. 주된 원인은 bridge 재시작, 세션 만료, Copilot 연결 유실입니다. **`/new`로 새 대화를 시작**하거나 종료 후 다시 실행하세요. 오류를 넘기려고 완료한 도구를 다시 실행하거나 도구 결과를 지어내 입력하지 마세요.

| 코드 | 의미 |
| --- | --- |
| `response_not_found` (404), `unknown_tool_call` | bridge가 해당 응답이나 도구 호출을 모릅니다. bridge가 재시작했거나 세션이 만료됐을 가능성이 큽니다. |
| `upstream_session_lost`, `history_invalidated` | Copilot 세션을 잃었거나 세션 이력이 별도로 바뀌었습니다. 대기 중이던 작업은 재실행하지 않았습니다. |
| `tool_result_mismatch`, `pending_tool_results`, `unresolved_tool_calls` | 보낸 도구 결과가 bridge가 기다리는 호출과 맞지 않습니다. 일부가 누락·중복됐거나 알 수 없는 호출입니다. |
| `pending_session_changed`, `stale_response`, `session_mismatch` | 보낸 이력이나 응답 ID가 이 대화의 최신 bridge 상태와 맞지 않습니다. |

도구가 대기 중일 때 모델·도구·지시문을 바꾸는 것은 모든 대기 결과가 함께 도착하면 동작합니다. [핸드오프 규칙](ARCHITECTURE_KO.md#완료된-도구-결과와-함께-설정-바꾸기)을 참고하세요. 새 대화에서도 같은 오류가 나면 오류 코드와 메시지를 기록해 두세요.

### 기능 제한

| 증상 | 조치 |
| --- | --- |
| 작업 제목 요청이 HTTP 400 `Structured output is not supported`로 실패 | 조치할 필요가 없습니다. Codex의 선택적 자동 제목에는 구조화 출력이 필요하므로 대화는 제목 없이 계속됩니다. 다른 구조화 출력 요청도 성공하지 않고 실패합니다. [호환성](COMPATIBILITY_KO.md#거절하거나-비활성화하는-기능)을 참고하세요. |
| 지원하지 않는 입력·전송 방식 | 실행기 기본값을 유지하고 텍스트만 보내세요. 새 Codex 버전은 bridge가 아직 지원하지 않는 요청 형식을 추가할 수 있습니다. |
| custom 도구 파싱 오류 | 도구의 grammar는 모델에 대한 안내이며 생성 중에 강제되지 않습니다. 재시도 전에 도구가 이미 실행됐는지 확인하거나 지원되는 다른 모델을 선택하세요. bridge는 도구 원문을 고치지 않습니다. |

### 느린 응답과 연결 장애

1. **먼저 네트워크를 확인하세요.** `ETIMEDOUT`이나 연결 실패라면 제한 시간을 바꾸기 전에 네트워크·프록시·VPN과 Copilot 서비스 상태를 확인하세요. `/health.ready`는 로컬 SDK 연결만 나타내며 원격 모델 서비스 상태가 아닙니다.
2. **만료된 제한을 확인하세요.** `copilot_idle_timeout` 메시지는 `phase: first_progress`(아직 진행 없음) 또는 `phase: streaming`(진행 후 멈춤)을 표시합니다. 자동 복구 후에 이 오류가 나면 교체한 세션도 응답이 없었다는 뜻이며, 그것만으로 bridge가 멈췄다고 볼 수는 없습니다. 교체한 세션에 새 턴 예산을 주지는 않습니다.
3. **느린 작업에는 더 긴 제한을 직접 지정하세요.** 먼저 Codex를 정상 종료하고 상주 bridge도 중지합니다. 그다음 원래 작업 프로젝트에서 clone 경로를 맞춰 실행합니다.

```bash
TURN_FIRST_PROGRESS_TIMEOUT_MS=180000 TURN_IDLE_TIMEOUT_MS=180000 TURN_IDLE_RECOVERY_ATTEMPTS=2 \
TURN_TIMEOUT_MS=600000 REQUEST_TIMEOUT_MS=660000 \
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- \
  -c 'model_reasoning_effort="low"' resume --last
```

이 값은 첫 진행 전후 모두 3분, 안전한 복구 최대 2회, 턴 10분, 요청 11분을 허용하고 추론 수준을 낮춥니다. 기본값이 아니며 연결 끊김을 막지 못하고, 대기 시간과 사용량이 늘 수 있습니다. 무응답 제한만이 아니라 턴·요청 제한도 함께 올리세요.

- 긴 대화의 지연을 줄이려면 완료된 턴 사이에 `/compact`를 사용하세요. 최대 문맥이 크다고 긴 대화가 빨라지지는 않습니다.
- keepalive를 모델 진행으로 취급하거나 완료한 도구를 무조건 다시 실행하지 마세요.
- **장시간 검사를 실행 중이었다면** 새 실행을 시작하기 전에 기존 `.runtime` 보고서를 확인하세요. 검사 러너는 진행 기록을 스스로 저장하므로, 대화가 끊겼다고 검사가 멈춘 것은 아닙니다.

검사 명령과 최종 기록은 [검증 안내](../README_KO.md#개발과-검증)와 [검증 결과](validation/README_KO.md)를 참고하세요. 실패 케이스와 오프라인 회귀 검사는 실모델 판정과 구분합니다.

## 서버 직접 실행 (고급)

HTTP bridge를 직접 실행할 때만 사용합니다. Codex는 시작하지 않으며, 일반 실행은 전용 bridge를 이미 관리합니다. `npm run bridge`도 `.env`를 읽지 않습니다.

**1. 서버 시작:** 저장소 루트에서 새 로컬 토큰으로 시작합니다.

```bash
# GitHub 인증정보가 아니라 별도로 생성한 로컬 토큰을 사용합니다.
export BRIDGE_API_KEY="$(openssl rand -hex 32)"
HOST=127.0.0.1 PORT=4143 npm run bridge
```

또는 [`.env.example`](../.env.example)을 `.env`로 복사하고 토큰 placeholder를 교체한 뒤 `node --env-file=.env src/server.mjs`를 실행하세요. 서버 직접 실행의 기본 포트는 `4143`입니다. `HOST`에는 `127.0.0.1`, `::1`, `localhost`만 사용할 수 있습니다.

**2. 확인:** 다른 터미널에서 실행합니다.

```bash
curl --fail --silent --show-error http://127.0.0.1:4143/health
```

HTTP 200은 로컬 서버가 살아 있다는 뜻이며 모델 서비스의 가용성을 뜻하지 않습니다.

**3. 중지:** 연결된 클라이언트를 닫은 뒤 서버 터미널에서 `Ctrl+C`를 누릅니다.

| 경로 | 토큰 | 용도 |
| --- | --- | --- |
| `GET /health` | 불필요 | HTTP 생존, 마지막 SDK 준비 상태, 인스턴스 정보 |
| `GET /readyz` | 필요 | 제한 시간 안의 SDK 준비 상태 검사. 모델 서비스 상태까지 보장하지 않음 |
| `GET /v1/models` | 필요 | 이 계정이 사용할 수 있는 모델 ID |
| `POST /v1/responses` | 필요 | 텍스트·도구 요청. SSE 또는 JSON으로 응답 |

토큰은 `Authorization: Bearer <bridge-token>` 또는 `x-api-key` 헤더로 보냅니다.

## 선택적 zsh 연동

어느 디렉터리에서든 `codex`로 GHCP 실행기를 실행하려는 경우에만 사용합니다. `codex-original`은 계속 공식 CLI를 직접 실행합니다. 앞의 실행 예시에는 셸 변경이 필요하지 않습니다.

**1. 백업:** 현재 설정을 백업합니다.

```zsh
if [[ -f ~/.zshrc ]]; then
  cp -p ~/.zshrc ~/.zshrc.codex-ghcp.bak.$(date +%Y%m%d-%H%M%S)
fi
```

**2. 블록 추가:** 아래 블록을 `~/.zshrc`에 **한 번만** 추가합니다. clone 위치가 다르면 실행기 경로를 바꾸세요. 기존 `PATH`와 다른 설정은 유지하고, 이미 있는 `codex`·`codex-original` 별칭이나 함수는 먼저 제거하거나 이름을 바꾸세요.

```zsh
# >>> openai-codex-ghcp-sdk >>>
codex() {
  local codex_bin
  codex_bin="$(builtin whence -p codex)" || {
    builtin print -u2 -- 'Official Codex CLI not found on PATH. Install: npm install -g @openai/codex@0.154.0'
    return 127
  }
  CODEX_BIN="$codex_bin" "$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" "$@"
}

codex-original() {
  local codex_bin
  codex_bin="$(builtin whence -p codex)" || {
    builtin print -u2 -- 'Official Codex CLI not found on PATH. Install: npm install -g @openai/codex@0.154.0'
    return 127
  }
  "$codex_bin" "$@"
}
# <<< openai-codex-ghcp-sdk <<<
```

**3. 활성화·확인:** 새 터미널을 열거나 현재 터미널에서 실행합니다.

```zsh
source ~/.zshrc
whence -v codex codex-original
codex --help               # 실행기 도움말. bridge 시작 없음
codex-original --version   # 공식 CLI 버전. bridge 시작 없음
```

이제 `codex`는 기본 실행, `codex --ghcp-model gpt-6-sol`은 모델을 선택한 실행입니다. 공식 CLI의 도움말·버전은 `codex --version`이 아니라 `codex-original --help`나 `codex-original --version`으로 확인하세요.

`whence -p`는 함수·별칭을 제외하고 공식 실행파일을 찾습니다. 공식 실행파일을 `PATH`에 유지하고, 이 실행기를 다시 가리키는 `codex` shim은 추가하지 마세요. `CODEX_BIN`은 해당 호출에만 적용하며 이 블록을 읽지 않는 셸은 바뀌지 않습니다.

**해제:** 표시된 블록만 제거하고 새 터미널을 열거나 현재 터미널에서 `unfunction codex codex-original`을 실행합니다. 백업 전체를 복원하면 백업 이후의 다른 설정 변경도 사라집니다.
