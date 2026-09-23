# OpenAI Codex × GitHub Copilot SDK

[English](README.md) · [구조](docs/ARCHITECTURE_KO.md) · [호환성](docs/COMPATIBILITY_KO.md) · [네이티브 검증](docs/NATIVE_SCENARIOS_KO.md)

공식 **Codex CLI**에서 **GitHub Copilot 계정의 모델**을 사용하기 위한 로컬 Responses API 변환기입니다.

```text
Codex → 로컬 HTTP/SSE bridge → GitHub Copilot SDK → 선택한 Copilot 모델
```

도구 실행·승인·샌드박스는 Codex가 담당합니다. bridge는 메시지와 도구 호출을 변환할 뿐 셸이나 파일 도구를 대신 실행하지 않습니다. 공식 SDK를 사용하지만, **Codex와 Copilot을 연결하는 이 조합은 비공식 프로젝트**입니다. 추론 시 프롬프트와 도구 결과는 GitHub Copilot으로 전송되며 계정의 사용 한도·과금 정책이 적용됩니다.

## 준비 사항

- Node.js `^20.19.0` 또는 `>=22.12.0`, npm, Bash.
- Copilot CLI와 원하는 모델을 사용할 수 있는 GitHub Copilot 계정.
- 인증된 Copilot CLI 설치. `copilot --version`으로 확인하고 필요한 경우 `copilot login`을 실행합니다.
- 공식 Codex CLI. 이 구현의 프로토콜 대상 버전은 **`0.154.0`**입니다.

SDK가 기존 Copilot 로그인을 사용합니다. GitHub 토큰을 프로젝트에 복사하거나 OpenAI API 키를 입력할 필요가 없습니다. `COPILOT_HOME`은 기존 Copilot 홈 디렉토리를 선택하는 옵션이며, 기본값은 `~/.copilot`입니다.

## 설치

현재 디렉토리에서 실행합니다.

```bash
npm install -g @openai/codex@0.154.0
npm ci
command codex --version
./bin/ghcp-doctor
./bin/ghcp-models
```

의존성은 `@github/copilot-sdk@1.0.14`, `proper-lockfile@4.1.2`로 고정합니다. 이 프로젝트에 별도로 설치하므로 이웃 프로젝트의 `node_modules`나 서버를 공유하지 않습니다. Codex/SDK를 업그레이드하면 프로토콜 수정이 필요할 수 있습니다.

## `codex`를 GitHub Copilot으로 기본 실행하기 (zsh)

설치 후 아래 블록을 `~/.zshrc`에 **한 번만** 추가합니다. 대화형 zsh 터미널에서는 어느 작업 디렉토리에서든 `codex`만 입력하면 이 프로젝트의 GHCP 실행기를 거칩니다. `codex-original`은 bridge 없이 공식 CLI를 직접 실행합니다.

먼저 기존 셸 설정을 백업합니다.

```zsh
cp -p ~/.zshrc ~/.zshrc.codex-ghcp.bak.$(date +%Y%m%d-%H%M%S)
```

아래 예시는 저장소가 `$HOME/GitHub/openai-codex-ghcp-sdk`에 있다고 가정합니다. 다른 위치에 clone했다면 실행기 경로를 바꾸세요. 기존 PATH와 Claude 연동 설정은 유지합니다. 이미 `codex` 또는 `codex-original` 별칭·함수가 있다면 해당 정의와의 충돌을 먼저 정리하세요.

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

새 터미널을 열거나 현재 터미널에서 다음과 같이 활성화합니다.

```zsh
source ~/.zshrc
whence -v codex codex-original
codex --help                # GHCP 실행기 도움말. bridge를 시작하지 않음
codex-original --version   # 공식 Codex 버전. bridge를 시작하지 않음
```

이후 다음처럼 사용합니다.

```zsh
codex
codex --ghcp-model gpt-6-sol
codex -- exec --skip-git-repo-check --sandbox read-only \
  "README_KO.md를 읽고 프로젝트의 목적을 한 문장으로 요약해줘."
codex-original --help       # GHCP를 거치지 않는 공식 CLI 도움말
```

기본 모델은 그대로 `gpt-6-astra`입니다. Copilot 모델은 `--ghcp-model`로 선택하며, GHCP 실행기는 공식 CLI의 `--model`/`-m` 재정의를 거절합니다. 나머지 Codex 인자는 `--` 뒤에 전달합니다. 공식 버전만 확인할 때는 `codex --version` 대신 `codex-original --version`을 사용하세요.

`whence -p`는 함수·별칭을 제외하고 매번 PATH의 실행파일을 찾으므로, nvm 버전 경로를 고정하거나 `codex` 함수로 재귀하지 않습니다. 공식 `codex` 실행파일은 PATH에 유지하고, 이 실행기를 다시 가리키는 별도 `codex` shim은 추가하지 마세요. `CODEX_BIN`은 실행기 호출에만 적용하며 인자·현재 작업 디렉토리·종료 코드는 보존합니다. 이 블록을 로드하지 않는 셸·프로그램은 계속 공식 실행파일을 사용합니다. 셸 연동 없이도 기존 `./bin/codex-ghcp`를 사용할 수 있습니다.

해제하려면 `~/.zshrc`에서 표시된 블록만 제거한 뒤 새 터미널을 열거나, 현재 터미널에서 `unfunction codex codex-original`을 실행하세요. 백업 파일 전체를 복원하면 백업 이후의 다른 셸 설정 변경도 사라지므로 주의하세요.

## 모델 선택

허용하는 Copilot catalog ID는 다음 6개뿐이며, 피커 순서도 같습니다.

| 순서 | 표시 이름 | 모델 ID |
| ---: | --- | --- |
| 1 | Claude Opus 5.5 | `claude-opus-5.5` |
| 2 | Claude Sonnet 5 | `claude-sonnet-5` |
| 3 | Claude Haiku 4.5 | `claude-haiku-4.5` |
| 4 | GPT-6 Astra | `gpt-6-astra` |
| 5 | GPT-6 Sol | `gpt-6-sol` |
| 6 | GPT-6 Luna | `gpt-6-luna` |

기본값은 **`gpt-6-astra`**입니다. 계정 catalog와 모델 정책을 확인하며, 사용할 수 없는 모델을 다른 모델로 몰래 대체하지 않습니다. 제거된 ID(`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `claude-opus-5`)는 실행기와 bridge가 대체 없이 거절합니다.

```bash
./bin/ghcp-models --json
./bin/codex-ghcp --ghcp-model claude-opus-5.5
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

목록에 표시된다는 사실은 모든 Codex 기능의 호환성을 뜻하지 않습니다. 실행기는 인증된 `/v1/models` 목록을 읽어 비공개 임시 `model_catalog_json` 파일로 전달합니다. Codex의 `/model` 피커에는 내장 OpenAI 목록이나 다른 공급자의 캐시 대신 **위 6개 중 계정에서 사용할 수 있는 모델만 표시 순서대로** 표시됩니다. 초기 모델은 `--ghcp-model`로 선택하고, 계정 권한 변경은 다시 실행하여 반영합니다. 임시 목록은 해당 Codex 종료 시 삭제하며 상주 bridge 사용 시에도 동일합니다.

Codex 0.154.0은 catalog priority 순서로 피커를 정렬하고 첫 항목에 `(default)`를 표시하므로 `claude-opus-5.5`에 이 표시가 붙습니다. 실행기는 `--ghcp-model`로 다른 모델을 고르지 않는 한 여전히 `gpt-6-astra`로 시작하며, 피커에는 `(current)`로 표시됩니다. `/model`에서 모델을 고르면 실행 중인 세션이 전환됩니다. Codex는 이 선택을 `~/.codex/config.toml`의 `model`/`model_reasoning_effort`로도 저장하고, 더 높은 우선순위 설정이 이를 덮어쓴다고 경고합니다. 다음 GHCP 실행은 여전히 `--ghcp-model` 또는 기본값을 쓰지만, 공식 `codex-original` 실행은 저장된 값을 읽으므로 필요하면 그 값을 되돌리세요.

6개 모델 모두 **SDK가 제공하는 최대 컨텍스트 tier**를 사용합니다. Copilot이 장문 tier 가격 정보 또는 명시적인 지원 정보를 제공하면 `contextTier: "long_context"`, 그렇지 않으면 `"default"`를 선택합니다. Codex 목록·세션 생성·모델/추론 수준 변경·이력 재구성·무응답 자동 복구에 같은 선택을 적용합니다. 상위 서비스가 tier를 거절하면 오류로 알리며 조용히 기본 tier로 바꾸지 않습니다. 대화 이력의 기준을 Codex로 유지하기 위해 SDK 자체 압축은 계속 비활성화합니다.

Codex에 전달하는 값은 입력·출력을 합친 총 문맥이 아니라 **입력 예산**입니다. 모델/tier의 prompt 한도 중 작은 값을 적용하고 총 문맥 안에 모델의 최대 출력 공간을 예약합니다. 입력 예산의 **80%**에서 Codex의 로컬 자동 압축을 시작합니다. 한도 메타데이터가 없으면 임의의 값으로 진행하지 않고 실행을 중단합니다. 현재 계정 메타데이터(2026-09-23)에 따른 토큰 수는 아래와 같으며, 코드에 고정하지 않고 SDK에서 계산합니다.

| 모델 | 총 컨텍스트 최대 | Codex 입력 예산 | 자동 압축 시작점 |
|---|---:|---:|---:|
| `claude-opus-5.5` | 1,000,000 | 872,000 | 697,600 |
| `claude-sonnet-5` | 1,000,000 | 936,000 | 748,800 |
| `claude-haiku-4.5` | 200,000 | 136,000 | 108,800 |
| `gpt-6-astra` | 1,050,000 | 922,000 | 737,600 |
| `gpt-6-sol` | 1,000,000 | 872,000 | 697,600 |
| `gpt-6-luna` | 1,000,000 | 872,000 | 697,600 |

Haiku는 기본 tier를 유지하고 나머지 5개는 현재 장문 tier를 제공합니다. 큰 문맥은 지연·메모리·사용 비용을 늘릴 수 있습니다. 현재 GPT 장문 tier 단가는 입력 2배·출력 1.5배이며 Claude Opus/Sonnet은 두 tier 단가가 같습니다. 계정 메타데이터는 바뀔 수 있습니다. Codex의 `model_context_window`만 높여 SDK 한도를 초과하지 마세요. 실행 중인 프로세스는 기존 설정을 유지하므로 Codex를 정상 종료하고 다시 실행해야 적용됩니다.

각 catalog 항목에는 `apply_patch_tool_type: "freeform"`도 선언합니다. 따라서 Codex는 기본 OpenAI 모델과 마찬가지로 Copilot 모델에도 Codex 기본 `apply_patch` 편집 도구를 제공합니다. 이전에는 실제 TUI에 shell 도구만 제공되어, 모델이 shell 명령으로 파일을 쓰거나 `apply_patch`가 없다고 답했습니다. bridge는 freeform patch 원문을 바이트 그대로 전달하고, 적용은 여전히 Codex가 자체 샌드박스·승인 정책 안에서 합니다.

## Codex 실행

대화형 실행:

```bash
./bin/codex-ghcp
```

읽기 전용 샌드박스에서 비대화형 실행:

```bash
./bin/codex-ghcp --ghcp-model gpt-6-astra -- \
  exec --skip-git-repo-check --sandbox read-only \
  "README_KO.md를 읽고 프로젝트의 목적을 한 문장으로 요약해줘."
```

현재 디렉토리가 Git 저장소가 아니면 `--skip-git-repo-check`를 사용할 수 있습니다. 이는 샌드박스를 끄는 옵션이 아닙니다. 실행기는 승인·샌드박스 우회 옵션을 추가하지 않습니다.

기본 실행기는 사용 가능한 루프백 포트에 bridge를 시작하고, 준비가 되면 Codex를 실행하며, 종료 시 자신이 만든 bridge를 정리합니다. 일반 Codex 인자는 `--` 뒤에 전달합니다. bridge 연결을 유지하기 위해 공급자·전송 설정과 충돌하는 인자는 거절합니다.

선택적 상주 bridge:

```bash
./bin/codex-ghcp --bridge-background --ghcp-model gpt-6-astra
./bin/codex-ghcp-status
./bin/codex-ghcp-stop
```

이는 이 프로젝트의 실행기 옵션/명령이며 Codex 내장 기능이 아닙니다. 상주 bridge를 종료하면 대기 중 도구 호출을 포함한 메모리의 대화 상태가 사라집니다. 해당 대화가 필요하지 않을 때만 종료하세요.

## 기존 설정 보존

실행기는 Codex의 `-c` 인자로 Responses 공급자 설정을, 자식 프로세스 환경 변수로 생성한 **로컬 bridge 전용 토큰**을 전달합니다. 미지원 WebSocket·요청 압축·호스팅 웹 검색·원격 compaction·reasoning summary는 비활성화합니다. 실행기 자체는 `~/.codex/config.toml`, `auth.json`, 셸 시작 파일이나 다른 프로젝트의 서버를 수정하지 않습니다. 위의 선택적 zsh 연동은 사용자가 명시적으로 적용하는 별도의 `~/.zshrc` 변경이며, 공식 CLI를 교체하거나 Codex 인증을 변경하지 않습니다.

Copilot/GitHub 인증을 Codex로 복사하지 않습니다. bridge 토큰은 GitHub/OpenAI 인증정보가 아닙니다. 다만 다른 Codex 설정은 실행에 영향을 줄 수 있으며, 실행기가 완전히 새로운 Codex 프로필을 만드는 것은 아닙니다.

bridge의 SDK 세션은 Copilot 런타임 자체에 설정된 MCP 서버(`~/.copilot/mcp-config.json`과 설치된 plugin)를 모두 비활성화합니다. 세션은 Codex가 선언한 도구만 허용하므로 이 서버들은 모델에 노출된 적이 없는데도, 런타임은 세션마다 새 서버 묶음을 띄웠습니다(이 환경에서는 azmcp와 Playwright 2개, 약 300 MB RSS). 서버 이름은 세션 생성 시 해당 파일에서 읽고, 생성 뒤 제한 시간이 있는 점검으로 다른 출처에서 뜬 서버도 중지한 뒤 이후 세션에서 비활성화합니다. Codex 자체 MCP 서버는 영향을 받지 않습니다. Codex가 직접 실행하고 다른 도구와 같이 bridge에 선언하기 때문입니다.

`.env`는 `npm run bridge`나 실행기에서 **자동으로 로드되지 않습니다.** `.env.example`은 서버 직접 실행용 설정 예시입니다.

```bash
# GitHub 인증정보가 아니라 별도로 생성한 로컬 토큰을 사용합니다.
export BRIDGE_API_KEY="$(openssl rand -hex 32)"
HOST=127.0.0.1 PORT=4143 npm run bridge
```

또는 `.env.example`을 바탕으로 `.env`를 만들고 토큰 placeholder를 교체한 후 `node --env-file=.env src/server.mjs`를 실행하세요. 직접 서버 실행의 기본 포트는 `4143`이고, 일반 실행기는 빈 포트를 자동 선택합니다.

제공 경로:

- `GET /health`: 비밀정보가 아닌 준비 상태·인스턴스 정보. 인증 불필요.
- `GET /v1/models`: 인증 필요. 이 계정에서 사용할 수 있는 허용 모델 목록.
- `POST /v1/responses`: 인증 필요. 텍스트·도구 요청에 JSON 또는 SSE로 응답.

health 외에는 `Authorization: Bearer <bridge-token>` 또는 `x-api-key`가 필요합니다. 외부 네트워크 인터페이스 바인딩은 지원하지 않습니다.

## 제한과 문제 해결

고급 기능을 사용하기 전에 [호환성](docs/COMPATIBILITY_KO.md)을 확인하세요.

| 증상 | 조치 |
| --- | --- |
| Copilot 인증 오류 | `copilot login` 후 `./bin/ghcp-models`를 실행합니다. 토큰을 프롬프트나 소스에 붙여 넣지 마세요. |
| 모델 사용 불가 | 정확한 ID, 계정 권한, 조직 정책을 확인합니다. 자동 대체 모델은 없습니다. |
| reasoning effort 미지원 | `--` 뒤에 `-c 'model_reasoning_effort="low"'`처럼 catalog에서 지원하는 값을 전달합니다. Haiku 4.5의 effort는 설정할 수 없으며 제한을 진단 로그로 남깁니다. |
| 포트 사용 중 | 실행기의 빈 포트 선택을 사용하거나 직접 실행의 `PORT`를 바꿉니다. 다른 프로젝트의 프로세스를 종료하지 마세요. |
| 알 수 없는 response/tool call | 재시작 또는 만료로 세션을 잃었을 수 있습니다. 새 대화를 시작하고, 도구 결과를 지어내지 마세요. |
| 긴 턴·컨텍스트 한도 오류 | 도구 결과 반환 직후에도 로컬 자동 압축을 처리합니다. 여전히 `context_length_exceeded`가 발생하면 턴 사이에 `/compact`를 실행하거나 짧은 새 대화를 시작하세요. 바이트 한도를 늘려도 모델 문맥은 늘어나지 않습니다. |
| 이력 크기 초과 | 새 대화를 시작하거나 메모리·모델 문맥 한도를 고려해 `MAX_REPLAY_BYTES`를 조정합니다. |
| 입력·전송 미지원 | 실행기 기본값과 텍스트 입력을 사용합니다. Codex 버전 변경으로 새로운 요청 형식이 추가됐을 수 있습니다. |
| custom 도구 파싱 오류 | SDK가 grammar 기반 생성을 강제하지 않습니다. 재시도하거나 허용된 다른 모델을 선택하세요. bridge가 원문을 임의 수정하지는 않습니다. |

JSON으로 직렬화한 대화 이력 한도(`MAX_REPLAY_BYTES`)와 HTTP 요청 본문 한도(`MAX_BODY_BYTES`)의 기본값은 각각 **33,554,432바이트(32 MiB)**입니다. 이는 실측으로 검증된 최대 처리량이 아닌 운영상 초기 보호 한도이며 모델 문맥 한도와도 별개입니다. 큰 대화는 여전히 메모리나 모델 문맥 한도를 초과할 수 있습니다. 필요하면 양의 정수 환경 변수로 각 한도를 재정의하고 브리지를 재시작하세요. 실행기는 `.env`를 자동으로 읽지 않습니다. 상주 브리지는 연결된 Codex 세션을 닫은 뒤 종료하세요. 재시작하면 메모리의 대화 상태가 사라집니다.

Codex의 HTTP·스트림 자동 재시도는 계속 비활성화합니다. 브릿지는 **15초마다** SDK 준비 상태를 확인하고 내용 없는 턴 감시 진단을 기록합니다(`SDK_READINESS_INTERVAL_MS`). 각 시도는 프롬프트 처리·무신호 추론을 포함해 **첫 모델 진행까지 180초**를 허용합니다(`TURN_FIRST_PROGRESS_TIMEOUT_MS=180000`). `assistant.turn_start`는 초기화 알림일 뿐이며 반복된 턴 시작·SDK 재시도·keepalive는 이 시간을 초기화하지 않습니다. 실제 진행 이후에는 **90초 무진행 제한**(`TURN_IDLE_TIMEOUT_MS=90000`)을 적용합니다. 루트 텍스트·추론·도구 입력과 증가하는 `assistant.streaming_delta` 바이트 수가 제한을 갱신합니다. 등록된 루트 Fusion 단계의 증가하는 비공개 출력 바이트와 단계당 한 번의 성공 완료 신호도 반영하되 중복·review·하위 에이전트 활동은 제외합니다. 비공개 내용은 전달하지 않습니다. 상위 서비스가 아무 신호도 보내지 않으면 로컬 상태 확인만으로 정지와 긴 비공개 추론을 구분할 수는 없습니다.

무진행 시 브릿지는 기존 응답 스트림을 유지하면서 해당 SDK 세션을 **요청당 한 번** 재구성할 수 있습니다(`TURN_IDLE_RECOVERY_ATTEMPTS=1`, 범위 0–3; 0은 즉시 실패 방식). 입력 접수 확인, assistant 출력·대기 호출 없음, 이전 세션의 abort·disconnect·delete 성공이 모두 필요합니다. 완료된 도구 결과는 대화 이력으로만 전달하며 **도구 결과 RPC를 다시 제출하지 않습니다.** 모델·추론 수준·지시문을 유지하고 다른 대화는 재시작하지 않습니다. 부분 출력, 접수 여부가 불확실한 도구 결과, 필터, 취소, 정리 실패, SDK 연결 유실은 자동 재전송하지 않습니다. 복구 후 다시 멈추면 무한 반복하지 않고 `copilot_idle_timeout`으로 종료합니다. 복구는 추가 추론 사용량을 소비할 수 있으며 동일한 답변이나 모델 행동의 정확히 한 번 실행을 보장하지 않습니다.

**도구 실행 후 반복되는 409:** 이제 모든 대기 결과가 반환되면 `/new` 없이 최상위 지시문·모델·context tier·도구 갱신을 반영할 수 있습니다. 지시문을 제외한 기존 대화는 일치해야 합니다. 이전 세션 정리와 SDK 준비 상태를 확인한 뒤 완료 결과를 새 세션의 이력으로만 넘기고 결과 RPC를 중복 제출하지 않습니다. 결과 누락·중복·불일치·기존 대화 변조는 계속 거절합니다. 모델이 새 호출 ID로 같은 작업을 제안하는 것까지 정확히 한 번 실행을 보장하지는 않습니다. [핸드오프 경계](docs/ARCHITECTURE_KO.md#대화-연속성)를 참고하세요.

이 지시문 핸드오프 경로를 실제 Codex TUI·headless Playwright로 확인하여 **실모델 6/6**이 통과했습니다. 모델별 fixture 실행 1회·기존 결과 RPC 제출 0회였고 같은 대화의 다음 턴도 성공했습니다. 전체 안정성·TUI 행렬 재실행 결과와는 구분합니다. [증거·보존한 최초 실패·한계](docs/validation/2026-09-23-pending-handoff.json).

이후 배포 전 전체 확인에서 **단위·통합 424건과 실모델 TUI 72/72**가 통과했지만 기본 **v5 안정성은 57/66**이며 Opus의 명시적 상위 필터 실패 9건이 남았습니다. 실패를 통과로 처리하지 않고 조건부 커밋·푸시를 보류했습니다. 두 행렬은 같은 [검증 기록](docs/validation/2026-09-23-pending-handoff.json)에 별도로 보존합니다.

세션 생성·모델 설정 RPC는 **SDK 시작 제한 30초**(`SDK_STARTUP_TIMEOUT_MS=30000`, 턴 제한 이하)를 적용하고 `copilot_setup_timeout`으로 알립니다. 전체 모델 턴 제한은 복구 시도가 공유하는 기본 5분(`TURN_TIMEOUT_MS=300000`), 큐 대기 포함 요청 제한은 6분(`REQUEST_TIMEOUT_MS=360000`)이며 정리 작업은 별도 제한을 갖습니다. 복구해도 두 제한을 초기화하지 않습니다. 변경은 다시 실행한 프로세스부터 적용됩니다. 기존 상주 bridge를 사용 중이면 연결된 Codex를 닫고 `./bin/codex-ghcp-stop`을 실행한 뒤 다시 시작하세요.

**소스 수정만으로 실행 중인 브릿지가 갱신되지는 않습니다.** 기본 foreground 실행에서는 Codex를 정상 종료한 뒤 같은 폴더에서 `./bin/codex-ghcp -- resume --last`를 실행하면 수정 코드를 로드하고 최근 대화를 이어갑니다. 활성 Codex 아래의 브릿지만 강제 종료하지 마세요. `codex-ghcp-status`는 background 브릿지만 확인하므로 `stopped`여도 foreground 브릿지가 실행 중일 수 있습니다. 실행 중인 `/health.turnWatchdog`에는 `firstProgressTimeoutMs`, `idleTimeoutMs`, `recoveryAttempts`, `intervalMs`가 표시됩니다. `firstProgressTimeoutMs`가 없으면 첫 진행·스트리밍 제한을 분리한 수정이 적용되지 않은 프로세스입니다. 이전의 첫 대기 90초를 명시적으로 사용하려면 `TURN_FIRST_PROGRESS_TIMEOUT_MS=90000`을 설정하세요. 복구 생략 시에는 구체적인 이유를 알립니다.

**자동 복구 횟수가 소진된 경우:** 재구성한 세션에서도 해당 단계의 제한까지 관측 가능한 진행이 없었다는 뜻입니다. 곧바로 교착을 의미하지는 않습니다. `/health.ready`는 로컬 SDK 연결만 확인하며 Copilot 모델 서비스 접속은 보장하지 않습니다. `Connect: ... ETIMEDOUT` 같은 연결 오류라면 네트워크·프록시/VPN·서비스 상태를 점검해야 하며 재시도 횟수만 늘려서는 장애가 해결되지 않습니다. 시작 실패는 SDK 작업(`start`·`ping`·`listModels`)을 구분합니다. 감시 진단·무응답 오류는 `first_progress`와 `streaming` 단계를 구분하고, 루트 `model.call_failure` 신호가 있으면 API/transport 분류와 HTTP 상태만 기록합니다. 공급자 원문·상관관계 ID는 남기지 않으며 SDK 내부 재시도를 성급히 중단하거나 실패 신호를 진행으로 위장하지 않습니다. 전체 턴 5분 예산은 유지하므로 복구 세션에 3분이 추가 보장되지는 않습니다. 전체 제한 오류에는 실제 복구 시도 횟수를 표시합니다.

더 느린 작업에는 정상 종료 후 **지연 허용 실행 설정**을 명시적으로 사용할 수 있습니다. 첫 진행 전후 모두 3분·안전 조건을 충족한 복구 최대 2회이며 절대 턴 10분·전체 요청 11분 제한은 유지합니다.

```bash
TURN_FIRST_PROGRESS_TIMEOUT_MS=180000 TURN_IDLE_TIMEOUT_MS=180000 TURN_IDLE_RECOVERY_ATTEMPTS=2 \
TURN_TIMEOUT_MS=600000 REQUEST_TIMEOUT_MS=660000 \
./bin/codex-ghcp -- -c 'model_reasoning_effort="low"' resume --last
```

기본값을 바꾸거나 끊김 방지를 보장하는 설정은 아니며 대기 시간·추론 사용량이 늘 수 있습니다. 무진행 제한만이 아니라 턴·요청 예산을 함께 조정하세요. 도구 결과까지 완료된 턴 사이에 `/compact`로 긴 이력을 줄이면 지연을 줄이는 데 도움이 됩니다. 최대 컨텍스트가 크다고 긴 대화가 빨라지는 것은 아닙니다. keepalive를 모델 진행으로 위장하거나 완료한 도구를 무조건 재실행하지 않습니다. 장시간 검증은 `.runtime`에 독립적으로 진행 기록을 저장하므로 대화가 끊겨도 검증 프로세스가 멈췄다고 단정하지 말고 기존 보고서를 먼저 확인하세요.

## 로컬 확인과 통합 호환성 검증

```bash
npm test                              # 단위/실행 제어 테스트, 모델 호출 없음
npm run test:ci                       # 소스 커버리지 + 시나리오/문서 정합성
npm run test:runtime                  # 오프라인 Codex/PTY/브라우저·워크플로·안정성 검사 전체
npm run test:context:runtime           # 실제 Codex/PTY: 압축·120회 도구·무응답/설정/Esc 복구, SDK 대역
npm run test:terminal:runtime          # 통합 PTY/Playwright 경로·취소·정리, SDK 대역
npm run test:scenarios                 # 18개 통합 시나리오 계약 검사
npm run docs:scenarios:check           # 생성 문서와 사양 일치 검사
npm run test:compatibility -- --plan   # 모델 호출 없는 실행 계획
npm run test:compatibility:runtime     # 실제 Codex + SDK 테스트 대역, 모델 호출 없음
```

컨텍스트 runtime 검사는 설치된 Codex CLI·격리된 프로필·기계적인 SDK 대역을 사용합니다. 실제 터미널 항목은 private PTY를 위한 Python 3도 필요합니다. 무응답·세션 생성 정체·Escape 이후 같은 터미널에서 재개하는지, 120회 연속 도구 호출과 반복 압축이 완료되는지 확인합니다. 실모델을 호출하지 않으며 최대 문맥이나 장시간 무중단 실행을 인증하는 검사는 아닙니다.

단독 실모델 터미널 검사는 `npm run test:terminal -- --execute --driver playwright --model gpt-6-astra --duration-seconds 120`으로 재현하며 `pty` 드라이버도 지원합니다. 먼저 `npx --no-install playwright install chromium`으로 브라우저를 설치하세요. 입력·응답 크기, 취소, 동결 증거, 통합 `test:soak -- --terminal` 경로는 [터미널·내구성 검사](docs/SOAK_TESTING_KO.md)를 참고하세요. 실검증은 Copilot 사용량이 발생하며 기본 `--plan`은 모델을 호출하지 않습니다.

별도 계약 `codex-ghcp-tui-12-v3`는 **실제 TUI → bridge → Copilot SDK → 지정 모델** 경로를 headless Playwright/xterm.js로 구동합니다. **12개 시나리오 × 6개 모델 = 72건**이며 전체 실검증 한 회에서 **95%(69/72) 이상**을 목표로 합니다. 피커 전환, shell·`apply_patch`, Codex MCP 격리, 긴 출력·대용량 붙여넣기, Escape 복구, `/compact`, 재개, 추론 수준 변경·종료를 검사합니다. SDK 실제 모델·컨텍스트 tier, Responses SSE 완료, 분리된 첫 진행·스트리밍 제한·정상 정리도 공통으로 요구합니다. `npm run test:tui`(계획), `npm run test:tui:runtime`(오프라인), `npm run test:tui -- --execute`로 실행합니다. [실제 TUI 시나리오](docs/TUI_SCENARIOS_KO.md)를 참고하세요. v2 기록은 과거 결과로 유지하고 당시 동결 소스로만 검증하며 v3로 재채점하지 않습니다.

**공개된 과거 TUI 결과(한국 시간 2026-09-23): v2 72/72(100%)**, 6개 모델 모두 12/12이며 구현 `fe500d78`을 당시 소스·동결 소스로 검증했습니다. Copilot API 연결 시간 초과가 포함된 최초 실행의 **45/72**도 보존합니다. 첫 진행 제한 분리 전 결과이므로 v3 결과나 향후 네트워크 가용성 보장이 아닙니다. [v2 증거와 한계](docs/validation/2026-09-23-tui-connection-v2/README_KO.md)를 참고하세요. [과거 v1의 70/72](docs/validation/2026-09-23-tui-scenarios/README_KO.md)는 별도 계약이며 재채점하거나 합산하지 않았습니다.

18개 시나리오 호환성 계약은 11개 시나리오 안정성 계약과 별개이며, 안정성 결과를 이 실모델 행렬의 통과 증거로 사용하지 않습니다.
**시나리오 18개 × GHCP 6모델 = 총 108건**이며, 별도 기준선·빠른 모드·부분 모델 선택은 없습니다.
최대 4모델 병렬 실행, 개별 타임아웃, 실패 후 계속 실행을 적용합니다. 전체 1시간은 목표이며 강제 종료 조건이 아닙니다.

실제 검증에는 Copilot 인증이 필요하며 사용량이 발생합니다. OpenAI API 키는 필요하지 않습니다.

```bash
npm run test:compatibility -- --execute
npm run test:compatibility -- --verify .runtime/compatibility-<run-id>/report.json
```

[통합 시나리오·커버리지](docs/NATIVE_SCENARIOS_KO.md)와 [실행·증거·환경 안내](docs/COMPATIBILITY_TESTING_KO.md)를 참고하세요.
**90%는 일상 개발 작업의 커버리지 목표이지 실측된 제품 기능 지원율이 아닙니다.** 검토자가 정한 핵심 기능군 20개의 **설계 점수는 75%**이며 실모델 지원율이 아닙니다.

## 브릿지 안정성·복구 검사

**최신 제한 분리 검증(한국 시간 2026-09-23): v3 72/72(100%)**로 새 실모델 TUI 행렬을 실행하고 현재·동결 소스로 독립 검증했습니다. 실제 TUI + SDK 대역의 첫 응답 지연 검사도 **실측 95초** 이후 SDK 세션 1개·재제출 없이 완료됐습니다. 사용자 대화에서 발생한 상위 정체의 정확한 원인을 확정하거나 향후 서비스 가용성을 보장하는 결과는 아닙니다. [증거와 남은 한계](docs/validation/2026-09-23-first-progress.json).

GitHub Actions는 Linux/macOS·Node 22/24에서 단위 검사와 Node 내장 소스 커버리지를 실행하고, 별도 Linux/macOS 작업에서 고정된 Codex·SDK 대역으로 실제 TUI/PTY/브라우저·워크플로 회귀 검사를 수행하도록 구성했습니다. CI는 Copilot 자격 증명이나 실모델 호출을 사용하지 않습니다. `coverage/lcov.info`는 단위 실행기가 관측한 `src` 모듈의 측정치이며 실행되지 않은 진입점까지 포함하거나 제품 기능 커버리지를 인증하지 않습니다. 워크플로 추가만으로 원격 CI 통과가 입증되지는 않습니다. 검증 보고서는 로컬 OS·아키텍처·Node·프록시 설정 유무도 기록하되 주소·비밀은 남기지 않습니다.

별도 계약 `codex-ghcp-stability-11-v5`는 **11개 시나리오 × 6개 모델 = 66건**입니다. 도구 순서 변경, 결과 누락 시 정책 변경 거절, HTTP 중복·취소, SDK 연결 상실, 스트림 불일치, resume·문맥 압축을 실제 Codex 경로에서 검사합니다. S03 경계를 v5로 구분하며 과거 v4 점수는 재채점하지 않습니다. 장애 주입과 실제 모델 결과를 구분합니다. [범위·판정 기준·설정·명령](docs/STABILITY_TESTING_KO.md)을 참고하세요.

```bash
npm run test:stability:stress
npm run test:stability:runtime
npm run test:stability -- --plan
npm run test:stability -- --execute  # Copilot 사용량 발생
```

**과거 실제 Codex 전체 검증(6개 모델 계약, 한국 시간 2026-09-23)은 기본 v4 57/66(86.36%), 별도 `application-data-v2` 63/66(95.45%)입니다.** 두 행렬 모두 구현 `68f92d74`로 전체 실행하고 현재·동결 소스로 검증했습니다. freeform `apply_patch` 목록 변경 전 결과이며 `54c7eb77`에서는 다시 실행하지 않았습니다. v4에서 `claude-opus-5.5`를 제외한 모델은 모두 11/11이며, Opus 5.5의 실패 9건은 모두 명시적인 상위 필터입니다. application-data-v2의 남은 실패는 Opus 필터 1건, SDK `disconnect` 정리 시간 초과 1건, 모델 도구 반복 미충족 1건입니다. bridge는 이제 쓰지 않는 Copilot 런타임 MCP 서버를 비활성화합니다(최종 행렬 동안 MCP 프로세스 0개). 실검증 중 macOS `EPERM` supervisor 오판도 찾아 수정했습니다. [변경·실행 이력·증거](docs/validation/2026-09-23-six-model-switch/README_KO.md)를 참고하세요.

**이전 실제 Codex 전체 검증(과거 7개 모델 v3/application-data-v1 계약, 한국 시간 2026-09-23)은 기본 v3 66/77(85.71%), 별도 `application-data-v1` 72/77(93.51%)입니다.** 터미널 실행기 통합 후 두 행렬을 각각 전체 실행하고 현재·동결 소스로 검증했습니다. 상위 필터·literal 레이블 누락·반복 도구 호출 누락을 실패로 유지하며, 77/77도 기존 95% 목표 달성도 아닙니다. 추가 실제 PTY·Playwright 확인에서 스크롤 영역 관측 오류를 찾아 수정했습니다. 앞선 74/77을 포함한 과거 결과는 별도로 보존하고 점수를 조합하지 않습니다. [구현·전체 결과·증거](docs/validation/2026-09-22-terminal-integration/README_KO.md)와 [검증 목록](docs/validation/README_KO.md)을 참고하세요.

사용자 요청으로 이번 수정 전에 삭제한 과거 검증 문서는 복원하지 않았습니다. 이번 수정 중 수행한 전체 실행은 실패·시간 초과를 포함해 각각 기록했으며, 과거 셀을 새 점수로 재사용하지 않습니다. 수시간 안정성이나 제품 전체 지원을 인증하는 결과는 아닙니다.

## 기여자

[junwoojeong100](https://github.com/junwoojeong100)이 유지보수하며, [Codex](https://github.com/codex)와 [GitHub Copilot](https://github.com/Copilot)이 AI 도구로서 구현·테스트·문서 작성에 기여했습니다.

## 공식 참고 자료

- [Codex CLI](https://github.com/openai/codex)
- [Codex 고급 설정](https://developers.openai.com/codex/config-advanced/)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
