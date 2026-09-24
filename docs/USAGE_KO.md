# 사용법과 문제 해결

[English](USAGE.md) · [빠른 시작](../README_KO.md) · [호환성](COMPATIBILITY_KO.md) · [구조](ARCHITECTURE_KO.md)

처음 설치한다면 [빠른 시작](../README_KO.md#빠른-시작)을 먼저 따라 하세요. 이 문서는 선택적 설정과 운영 방법을 설명합니다. 일반 실행에는 셸 연동이나 `.env` 파일이 필요하지 않습니다. `./bin/...` 명령은 저장소 루트에서 실행하고, 다른 작업 프로젝트에서는 실행기의 절대 경로를 사용하세요.

| 목적 | 안내 |
| --- | --- |
| 대화형·상주 실행과 종료 | [Codex 실행](#codex-실행) |
| `/model`과 문맥 한도 이해 | [모델 선택과 문맥](#모델-선택과-문맥) |
| 모델·포트·실행파일 경로 지정 | [실행기 설정](#실행기-설정) |
| Codex 없이 HTTP 서버 직접 관리 | [서버 직접 실행 (고급)](#서버-직접-실행-고급) |
| 오류 해결 | [문제 해결](#제한과-문제-해결) |
| 제한 시간 조정, 소스·설정 변경 적용 | [제한 시간](#제한-시간과-복구) · [안전한 재시작](#수정-코드-적용) |
| `codex` 명령을 이 실행기에 연결 | [선택적 zsh 연동](#선택적-zsh-연동) |

## Codex 실행

목적에 맞는 실행 방법을 선택하세요. 아래 예시는 한꺼번에 실행하는 절차가 아니라 대안입니다.

| 목적 | 저장소 루트에서 실행 |
| --- | --- |
| 대화형 세션 | `./bin/codex-ghcp` |
| 현재 디렉터리의 최근 대화 재개 | `./bin/codex-ghcp -- resume --last` |
| bridge 없이 실행기 도움말 확인 | `./bin/codex-ghcp --help` |
| bridge 없이 공식 Codex 도움말 확인 | `command codex --help` |

모델을 선택하고 비대화형·읽기 전용 요청을 보내는 예시입니다.

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- exec --sandbox read-only \
  "README_KO.md를 읽고 프로젝트의 목적을 한 문장으로 요약해줘."
```

**`--` 앞은 실행기 옵션**(`--ghcp-model`, `--bridge-background`), **뒤는 Codex 명령·옵션**(`exec`, `resume`, `--sandbox`)입니다. 공식 CLI의 `--model`/`-m`은 거절하므로 `--ghcp-model`을 사용하세요. `/model`, `/compact`, `/quit` 같은 슬래시 명령은 셸이 아니라 **실행 중인 Codex 안에서** 입력합니다.

Git 저장소 밖에서는 `exec` 뒤에 `--skip-git-repo-check`를 추가해 Git 검사만 생략할 수 있습니다. 실행기는 승인·샌드박스를 우회하지 않으며 공급자·전송 설정 재정의를 거절합니다.

다른 프로젝트에서 작업하려면 **해당 프로젝트에서 터미널을 열고** 실행기의 절대 경로를 사용하세요. clone 위치가 `$HOME/GitHub/openai-codex-ghcp-sdk`인 경우:

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp"
```

다른 위치에 clone했다면 경로를 바꾸세요. 실행기는 현재 작업 디렉터리를 유지하고 빈 루프백 포트에 bridge를 시작하며, Codex 종료 시 해당 bridge를 정리합니다. 작업이 끝난 Codex에서 `/quit`을 입력하면 정상 종료합니다. 이 기본 foreground 방식에는 별도 중지 명령이 필요하지 않습니다.

### 선택적 상주 bridge

Codex 종료 뒤에도 bridge를 재사용하려는 경우에만 사용합니다.

```bash
./bin/codex-ghcp --bridge-background --ghcp-model gpt-6-astra
```

`./bin/codex-ghcp-status`로 상태를 확인합니다. **background bridge만** 확인하므로 `stopped`여도 foreground bridge는 실행 중일 수 있습니다. 이 프로젝트의 명령이며 Codex 내장 옵션은 아닙니다. **연결된 Codex 세션을 닫은 뒤에만 중지하세요.** 중지하면 대기 도구 호출을 포함한 메모리의 대화 상태가 사라집니다.

```bash
./bin/codex-ghcp-stop
```

## 모델 선택과 문맥

[지원 모델 6개](../README_KO.md#모델)의 ID만 허용합니다. 시작 모델은 `--ghcp-model`, `GHCP_MODEL`, 기본값 `gpt-6-astra` 순으로 선택합니다. 공식 CLI의 `--model`/`-m` 재정의는 거절합니다. 사용할 수 없는 모델은 다른 모델로 자동 대체하지 않습니다.

계정의 모델 목록을 확인합니다.

```bash
./bin/ghcp-models --json
```

사용 가능한 모델 하나를 골라 실행합니다. 예:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

`/model`에는 지원 모델 6개 중 계정에서 사용할 수 있는 항목만 정해진 순서로 표시합니다. 권한 변경은 다시 실행하여 반영하세요. 목록에 있다는 사실이 모든 기능의 지원을 뜻하지는 않으므로 [호환성](COMPATIBILITY_KO.md)을 확인하세요. 실행기의 임시 목록은 내장·캐시 목록을 대체하고 상주 bridge에서도 Codex 종료 시 삭제합니다. [구현 설명](ARCHITECTURE_KO.md#모듈)을 참고하세요.

Codex 0.154.0은 피커의 첫 항목에 `(default)`를 표시합니다. 6개 모두 사용 가능하면 `claude-opus-5.5`에 붙는 표시이며, 실행기의 기본 모델을 바꾸지는 않습니다. 현재 모델은 `(current)`로 표시합니다.

**`/model`은 Codex 설정을 저장할 수 있습니다.** 실행 중인 모델을 바꾸고 `~/.codex/config.toml`에 `model`/`model_reasoning_effort`를 저장합니다. 다음 GHCP 실행은 `--ghcp-model`, `GHCP_MODEL`, 실행기 기본값 순서로 선택합니다. `command codex`로 직접 실행하면 저장된 값을 읽으며, [선택적 zsh 연동](#선택적-zsh-연동)을 추가한 경우 `codex-original`도 같습니다. 직접 실행하기 전에 필요하면 저장된 모델을 되돌리세요.

### 문맥 한도

bridge는 모델 전환·복구에도 일관되게 **SDK가 제공하는 최대 문맥 tier**를 사용합니다. 한도 메타데이터 누락이나 상위 서비스의 tier 거절은 오류로 알리며 조용히 다른 값으로 대체하지 않습니다. 구현은 [tier 선택과 예산 계산](ARCHITECTURE_KO.md#문맥-예산)을 참고하세요.

Codex에는 모델의 입력·출력 총 문맥이 아니라 출력 공간을 남긴 **입력 예산**을 전달합니다. 예산의 **80%**에서 로컬 자동 압축을 시작하며, SDK의 별도 자동 압축은 계속 비활성화합니다.

큰 문맥은 지연·메모리·사용 비용을 늘릴 수 있습니다. Codex의 `model_context_window`만 높여 SDK 예산을 초과하지 마세요. 목록을 갱신하고 변경 설정을 적용하려면 Codex를 정상 종료한 뒤 다시 실행합니다.

<details>
<summary>과거 계정 예시: 2026-09-23 기록이며 현재 한도는 아님</summary>

SDK 메타데이터에서 계산한 값이며 코드에 고정하지 않았습니다. 용량·비용을 추정할 때는 현재 계정 메타데이터를 확인하세요.

| 모델 | 총 컨텍스트 최대 | Codex 입력 예산 | 자동 압축 시작점 |
|---|---:|---:|---:|
| `claude-opus-5.5` | 1,000,000 | 872,000 | 697,600 |
| `claude-sonnet-5` | 1,000,000 | 936,000 | 748,800 |
| `claude-haiku-4.5` | 200,000 | 136,000 | 108,800 |
| `gpt-6-astra` | 1,050,000 | 922,000 | 737,600 |
| `gpt-6-sol` | 1,000,000 | 872,000 | 697,600 |
| `gpt-6-luna` | 1,000,000 | 872,000 | 697,600 |

</details>

## 기존 설정 보존

실행기는 Codex의 `-c` 인자로 Responses 공급자 설정을, 자식 프로세스 환경 변수로 생성한 **로컬 bridge 전용 토큰**을 전달합니다. 미지원 WebSocket·요청 압축·호스팅 웹 검색·원격 compaction·reasoning summary는 비활성화합니다. 실행기 자체는 `~/.codex/config.toml`, `auth.json`, 셸 시작 파일이나 다른 프로젝트의 서버를 수정하지 않습니다. Codex의 `/model` 명령은 선택을 저장할 수 있고, [zsh 연동](#선택적-zsh-연동)은 사용자가 명시적으로 적용하는 별도의 셸 변경입니다.

Copilot/GitHub 인증을 Codex로 복사하지 않습니다. bridge 토큰은 GitHub/OpenAI 인증정보가 아닙니다. 다만 다른 Codex 설정은 실행에 영향을 줄 수 있으며, 실행기가 완전히 새로운 Codex 프로필을 만드는 것은 아닙니다.

bridge의 SDK 세션은 Copilot 런타임 자체의 사용자·플러그인 MCP 서버를 비활성화합니다. Codex 자체 MCP 서버는 그대로 동작합니다. Codex가 직접 실행하고 다른 도구와 같이 bridge에 선언하기 때문입니다. 격리 방식은 [도구 호출 왕복](ARCHITECTURE_KO.md#도구-호출-왕복)을 참고하세요.

### 실행기 설정

아래 설정은 모두 선택 사항입니다. 환경 변수는 실행할 셸에서 지정하거나 명령 앞에 붙이세요. 실행기는 `.env`를 **읽지 않습니다.**

| 바꿀 항목 | 옵션 또는 환경 변수 | 기본값 |
| --- | --- | --- |
| 시작 모델 | `--ghcp-model`이 `GHCP_MODEL`보다 우선 | `gpt-6-astra` |
| 루프백 포트 | `--bridge-port`가 `GHCP_BRIDGE_PORT`보다 우선 | `0` (빈 포트 선택). `PORT`는 서버 직접 실행용 |
| 공식 Codex 실행파일 | `CODEX_BIN` | PATH의 `codex` |
| 기존 Copilot 로그인 디렉터리 | `COPILOT_HOME` | `~/.copilot` |
| 턴·요청 제한 | [제한 시간 환경 변수](STABILITY_TESTING_KO.md#운영-기본값) | [기본 제한 시간](#제한-시간과-복구) |

상주 bridge는 시작 당시의 설정을 유지합니다. 환경 변수나 수정한 소스를 적용하려면 [연결된 Codex 세션을 닫고 재시작](#수정-코드-적용)하세요.

### 서버 직접 실행 (고급)

HTTP bridge를 직접 관리할 때만 사용합니다. 이 명령은 Codex를 시작하지 않습니다. 일반 실행기는 bridge 실행과 빈 포트 선택을 이미 처리합니다.

`.env`는 `npm run bridge`나 실행기에서 **자동으로 로드되지 않습니다.** [`.env.example`](../.env.example)은 서버 직접 실행용 설정 예시입니다. 저장소 루트에서 실행하세요.

```bash
# GitHub 인증정보가 아니라 별도로 생성한 로컬 토큰을 사용합니다.
export BRIDGE_API_KEY="$(openssl rand -hex 32)"
HOST=127.0.0.1 PORT=4143 npm run bridge
```

또는 `.env.example`을 바탕으로 `.env`를 만들고 토큰 placeholder를 교체한 후 `node --env-file=.env src/server.mjs`를 실행하세요. 직접 서버 실행의 기본 포트는 `4143`이고, 일반 실행기는 빈 포트를 자동 선택합니다.

다른 터미널에서 HTTP 서버가 응답하는지 확인합니다.

```bash
curl --fail --silent --show-error http://127.0.0.1:4143/health
```

HTTP 200은 로컬 서버의 생존만 확인하며 모델 서비스의 가용성을 보장하지 않습니다. 연결된 클라이언트를 닫은 뒤 서버를 실행한 터미널에서 `Ctrl+C`로 중지하세요.

제공 경로:

- `GET /health`: HTTP 생존·마지막 SDK 준비 상태·인스턴스 정보. 인증 불필요.
- `GET /readyz`: 인증 필요. 제한 시간 안에서 SDK 준비 상태를 검사하며 모델 서비스 상태까지 보장하지는 않음.
- `GET /v1/models`: 인증 필요. 이 계정에서 사용할 수 있는 허용 모델 목록.
- `POST /v1/responses`: 인증 필요. 텍스트·도구 요청에 JSON 또는 SSE로 응답.

health 외에는 `Authorization: Bearer <bridge-token>` 또는 `x-api-key`가 필요합니다. 외부 네트워크 인터페이스 바인딩은 지원하지 않습니다.

## 제한과 문제 해결

고급 기능을 사용하기 전에 [호환성](COMPATIBILITY_KO.md)을 확인하세요.

| 증상 | 조치 |
| --- | --- |
| `./bin/...` 파일을 찾을 수 없음 | 이 저장소 루트에서 실행하거나 작업 프로젝트에서 [실행기의 절대 경로](#codex-실행)를 사용하세요. |
| Codex가 `--ghcp-model`을 알 수 없는 인자로 거절함 | 실행기 옵션을 **`--` 앞에** 두세요. 예: `./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last`. |
| 도움말·버전 확인인데 bridge가 시작됨 | 실행기 도움말은 `./bin/codex-ghcp --help`, 공식 CLI는 `command codex --help` / `command codex --version`을 사용하세요. `--` 뒤의 인자는 일반 bridge 시작 절차를 거칩니다. |
| doctor에서 `ok: false` 또는 `supportedVersion: false` | 실패한 필드를 확인하세요. SDK 버전이 다르면 `npm ci`, 도구 오류라면 해당 CLI 또는 Node 버전을 설치·수정합니다. [고정 버전 설치 안내](../README_KO.md#빠른-시작)를 따르세요. |
| Copilot 인증 오류 | `copilot login` 후 `./bin/ghcp-models`를 실행합니다. 토큰을 프롬프트나 소스에 붙여 넣지 마세요. |
| 모델 사용 불가 | `./bin/ghcp-models`에서 `disabled`나 `not available`이 아닌 ID를 골라 `--ghcp-model`로 지정하세요. 가능한 모델이 없으면 Copilot 권한·조직 정책을 확인합니다. 자동 대체하지 않습니다. |
| `.env`나 소스 변경이 적용되지 않음 | `.env`는 자동으로 읽지 않습니다. [실행기 설정](#실행기-설정)을 지정한 뒤 [안전하게 재시작](#수정-코드-적용)하세요. 기존 bridge는 이전 설정과 코드로 계속 동작합니다. |
| reasoning effort 미지원 | `--` 뒤에 `-c 'model_reasoning_effort="low"'`처럼 catalog에서 지원하는 값을 전달합니다. Haiku 4.5의 effort는 설정할 수 없으며 제한을 진단 로그로 남깁니다. |
| 포트 사용 중 | 실행기의 빈 포트 선택을 사용하거나 직접 실행의 `PORT`를 바꿉니다. 다른 프로젝트의 프로세스를 종료하지 마세요. |
| 알 수 없는 response/tool call | 재시작 또는 만료로 세션을 잃었을 수 있습니다. 새 대화를 시작하고, 도구 결과를 지어내지 마세요. |
| 도구 실행 후 반복되는 409 | [도구 결과 충돌](#도구-결과-충돌-409)을 확인하세요. 대체 결과를 만들려고 완료한 도구를 다시 실행하지 마세요. |
| 무응답·시간 초과·`ETIMEDOUT` | 네트워크·프록시·서비스 상태를 확인한 뒤 [적용되는 제한 시간](#제한-시간과-복구)과 [느린 응답 안내](#느린-응답과-연결-장애)를 참고하세요. 로컬 준비 상태가 모델 가용성을 보장하지는 않습니다. |
| 긴 턴·컨텍스트 한도 오류 | 도구 결과 반환 직후에도 로컬 자동 압축을 처리합니다. 여전히 `context_length_exceeded`가 발생하면 턴 사이에 `/compact`를 실행하거나 짧은 새 대화를 시작하세요. 바이트 한도를 늘려도 모델 문맥은 늘어나지 않습니다. |
| 이력 크기 초과 | 새 대화를 시작하거나 메모리·모델 문맥 한도를 고려해 `MAX_REPLAY_BYTES`를 조정합니다. |
| 제목 생성 요청의 HTTP 400 `Structured output is not supported` | 선택적 자동 제목을 지원하지 않는 것이며 대화는 계속할 수 있습니다. 다른 구조화 출력 요청도 미지원이지 성공 응답은 아닙니다. [호환성](COMPATIBILITY_KO.md#거절하거나-비활성화하는-기능)을 참고하세요. |
| 입력·전송 미지원 | 실행기 기본값과 텍스트 입력을 사용합니다. Codex 버전 변경으로 새로운 요청 형식이 추가됐을 수 있습니다. |
| custom 도구 파싱 오류 | SDK가 grammar 기반 생성을 강제하지 않습니다. 재시도 전에 도구의 실행 여부를 확인하거나 허용된 다른 모델을 선택하세요. bridge가 원문을 임의 수정하지는 않습니다. |

직렬화한 이력 한도(`MAX_REPLAY_BYTES`)와 HTTP 본문 한도(`MAX_BODY_BYTES`)는 각각 **32 MiB(33,554,432바이트)**입니다. 메모리·요청 보호 한도이지 모델 토큰 한도나 실측 최대 처리량이 아닙니다. 필요하면 양의 정수 환경 변수로 지정하고, 연결된 Codex 세션을 닫은 뒤 bridge를 재시작하세요. 실행기는 `.env`를 자동으로 읽지 않습니다.

### 제한 시간과 복구

| 제한 | 기본값 |
| --- | --- |
| SDK 설정 | 30초 |
| 첫 모델 진행 대기 | 180초 |
| 진행 시작 후 무진행 상태 | 90초 |
| 복구를 포함한 전체 모델 턴 | 5분 |
| 큐 대기를 포함한 전체 요청 | 6분 |

제한 시간은 동시에 적용되며 순서대로 더하는 값이 아닙니다. 15초 주기로 내용 없는 감시 진단을 기록하며 keepalive는 모델 진행으로 세지 않습니다. [전체 설정과 오류 코드](STABILITY_TESTING_KO.md#운영-기본값)를 참고하세요.

bridge는 응답 스트림을 유지하면서 무응답 SDK 세션을 **요청당 한 번** 재구성할 수 있습니다. 입력 접수 확인, assistant 출력·대기 호출 없음, 이전 세션 정리 확인이 필요합니다. 완료 도구 결과는 이력으로만 전달하며 **결과 RPC를 중복 제출하지 않습니다.** 부분 출력·불확실한 제출·필터·취소·정리 실패·SDK 연결 유실은 재전송하지 않습니다. 복구는 추가 추론 사용량을 소비할 수 있고 두 제한 시간을 초기화하지 않으며, 정확히 한 번 실행을 보장하지 않습니다. 비활성화하려면 `TURN_IDLE_RECOVERY_ATTEMPTS=0`을 사용하세요. Codex의 HTTP·스트림 자동 재시도는 계속 비활성화합니다.

### 도구 결과 충돌 (409)

설정을 바꾸려면 모든 대기 결과를 정확히 한 번 반환하고 지시문을 제외한 기존 이력을 유지해야 합니다. 완전한 결과 배치는 세션 핸드오프를 허용하지만 누락·중복·불일치는 오류입니다. 도구 실행 뒤에도 409가 반복되면 오류 코드와 [핸드오프 경계](ARCHITECTURE_KO.md#대화-연속성)를 확인하세요. 결과를 지어내거나 완료한 도구를 무조건 재실행하지 마세요.

### 수정 코드 적용

**소스·환경 변수 변경은 새 bridge에서만 적용됩니다.** 터미널은 **원래 작업하던 프로젝트 디렉터리**에 유지하세요. 아래 경로는 clone 위치가 `$HOME/GitHub/openai-codex-ghcp-sdk`인 경우이며, 다른 위치라면 바꾸세요.

1. **Codex 안에서:** 현재 턴을 완료하거나 취소한 뒤 `/quit`을 입력합니다. 상주 bridge라면 연결된 Codex 세션을 모두 닫으세요.
2. **셸에서, 상주 방식만:** `"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp-stop"`을 실행합니다. 기본 foreground 방식은 Codex와 함께 bridge가 종료되므로 생략하세요.
3. **같은 작업 프로젝트에서:** 아래 명령으로 재개합니다. 실행기를 찾으려고 디렉터리를 옮기지 마세요.

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- resume --last
```

이 저장소에서 작업 중이었다면 `./bin/codex-ghcp -- resume --last`도 같습니다. 새 foreground bridge를 시작하며, 다시 상주시키려면 `--` 앞에 `--bridge-background`를 추가하세요.

활성 Codex 아래의 bridge만 강제 종료하지 마세요. 재시작하면 미해결 도구 호출을 포함한 메모리 상태가 사라집니다. `/health.turnWatchdog`와 background 상태는 현재 소스의 기본값이 아니라 실행 중인 제한 시간·복구 설정을 표시합니다.

### 느린 응답과 연결 장애

복구 횟수 소진은 새 세션에서도 제한 시간 안에 진행을 관측하지 못했다는 뜻이지 교착의 증거는 아닙니다. `/health.ready`는 로컬 SDK 연결 상태이며 원격 모델 서비스까지 보장하지 않습니다. `ETIMEDOUT`·연결 실패라면 제한을 늘리기 전에 네트워크·프록시/VPN·서비스 상태를 확인하세요. 진단은 `first_progress`와 `streaming` 단계를 구분하며 복구 세션에 새 절대 턴 예산을 주지는 않습니다.

더 느린 작업에는 정상 종료하고 남아 있는 상주 bridge도 중지한 뒤 아래 **선택적 지연 허용 설정**으로 실행하세요. 위와 같이 원래 프로젝트에서 실행하고 clone 경로를 맞추세요. 첫 진행 전후 모두 3분, 안전 조건을 충족한 복구 최대 2회, 절대 턴 10분·전체 요청 11분 제한입니다.

```bash
TURN_FIRST_PROGRESS_TIMEOUT_MS=180000 TURN_IDLE_TIMEOUT_MS=180000 TURN_IDLE_RECOVERY_ATTEMPTS=2 \
TURN_TIMEOUT_MS=600000 REQUEST_TIMEOUT_MS=660000 \
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- \
  -c 'model_reasoning_effort="low"' resume --last
```

기본값을 바꾸거나 끊김 방지를 보장하는 설정은 아니며 대기 시간·추론 사용량이 늘 수 있습니다. 무진행 제한만이 아니라 턴·요청 예산을 함께 조정하세요. 도구 결과까지 완료된 턴 사이에 `/compact`로 긴 이력을 줄이면 지연을 줄이는 데 도움이 됩니다. 최대 컨텍스트가 크다고 긴 대화가 빨라지는 것은 아닙니다. keepalive를 모델 진행으로 위장하거나 완료한 도구를 무조건 재실행하지 않습니다. 장시간 검증은 `.runtime`에 독립적으로 진행 기록을 저장하므로 대화가 끊겨도 검증 프로세스가 멈췄다고 단정하지 말고 기존 보고서를 먼저 확인하세요.

검사 명령은 [검증 안내](../README_KO.md#개발과-검증), 측정 결과는 [검증 기록](validation/README_KO.md)을 참고하세요. 기록에는 실패를 보존하고 오프라인 검사·실모델 행렬·과거 구현을 구분합니다.

## 선택적 zsh 연동

어느 디렉터리에서든 `codex`로 GHCP 실행기를 호출하려는 경우에만 사용합니다. `codex-original`은 공식 CLI를 직접 실행합니다. 앞의 실행 예시에는 셸 변경이 필요하지 않습니다.

먼저 기존 설정을 백업합니다.

```zsh
if [[ -f ~/.zshrc ]]; then
  cp -p ~/.zshrc ~/.zshrc.codex-ghcp.bak.$(date +%Y%m%d-%H%M%S)
fi
```

아래 블록을 `~/.zshrc`에 **한 번만** 추가합니다. clone 위치가 다르면 실행기 경로를 바꾸세요. 기존 PATH·다른 설정은 보존하고, `codex` 또는 `codex-original` 별칭·함수가 이미 있으면 충돌을 먼저 정리하세요.

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

새 터미널을 열거나 현재 터미널에서 활성화합니다.

```zsh
source ~/.zshrc
whence -v codex codex-original
codex --help               # 실행기 도움말. bridge 시작 없음
codex-original --version   # 공식 CLI 버전. bridge 시작 없음
```

기본 실행은 `codex`, 모델 선택은 `codex --ghcp-model gpt-6-sol`을 사용합니다. 공식 CLI 도움말·버전은 `codex-original --help`·`codex-original --version`으로 확인하고 `codex --version`은 사용하지 마세요.

`whence -p`는 함수·별칭을 제외한 공식 실행파일을 찾습니다. 공식 실행파일을 PATH에 유지하고 이 실행기를 다시 가리키는 `codex` shim은 추가하지 마세요. `CODEX_BIN`은 해당 호출에만 적용하며, 이 블록을 읽지 않는 셸은 바뀌지 않습니다.

**해제:** 표시된 블록만 제거하고 새 터미널을 열거나 현재 터미널에서 `unfunction codex codex-original`을 실행합니다. 백업 전체를 복원하면 백업 이후의 다른 설정 변경도 사라집니다.
