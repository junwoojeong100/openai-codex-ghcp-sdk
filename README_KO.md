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

모델 정보에는 이론적인 long-context 최댓값 대신 **실제로 사용하는 기본 tier의 입력 예산**을 전달합니다. Copilot의 prompt/output 한도와 기본 tier 한도를 반영하고 SDK 세션을 `contextTier: "default"`로 고정하며, 예산의 **80%**에서 Codex의 로컬 자동 압축을 시작합니다. 한도 메타데이터가 없으면 다른 모델의 기본값으로 진행하지 않고 실행을 중단합니다. 대화 이력의 기준을 Codex로 유지하기 위해 SDK 자체 자동 압축은 계속 비활성화합니다.

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

실행기는 Codex의 HTTP·스트림 자동 재시도를 끕니다. 오류나 시간 초과 시 긴 프롬프트·실행 여부가 불확실한 도구 결과를 반복 재전송하지 않고 오류를 표시합니다. **모델 진행이 90초 동안 없으면** `copilot_idle_timeout`으로 종료합니다(`TURN_IDLE_TIMEOUT_MS=90000`). 루트 모델의 텍스트·추론·도구 입력 스트리밍은 대기 시간을 갱신하지만 HTTP keepalive와 하위 에이전트 이벤트는 갱신하지 않습니다. 추론과 미완성 도구 인자는 생존 확인에만 사용하며 클라이언트에 노출하지 않습니다. 정상적으로 조용히 오래 추론하는 모델은 이 값을 늘릴 수 있습니다.

세션 생성·모델 설정 RPC는 **SDK 시작 제한 30초**(`SDK_STARTUP_TIMEOUT_MS=30000`, 턴 제한 이하)를 적용하고 `copilot_setup_timeout`으로 알립니다. 전체 모델 턴 제한은 기본 5분(`TURN_TIMEOUT_MS=300000`), 큐 대기 포함 요청 제한은 6분(`REQUEST_TIMEOUT_MS=360000`)이며 정리 작업은 별도 제한을 갖습니다. 변경은 다시 실행한 프로세스부터 적용됩니다. 기존 상주 bridge를 사용 중이면 연결된 Codex를 닫고 `./bin/codex-ghcp-stop`을 실행한 뒤 다시 시작하세요.

## 로컬 확인과 통합 호환성 검증

```bash
npm test                              # 단위/실행 제어 테스트, 모델 호출 없음
npm run test:context:runtime           # 실제 Codex/PTY: 압축·120회 도구·무응답/설정/Esc 복구, SDK 대역
npm run test:terminal:runtime          # 통합 PTY/Playwright 경로·취소·정리, SDK 대역
npm run test:scenarios                 # 18개 통합 시나리오 계약 검사
npm run docs:scenarios:check           # 생성 문서와 사양 일치 검사
npm run test:compatibility -- --plan   # 모델 호출 없는 실행 계획
npm run test:compatibility:runtime     # 실제 Codex + SDK 테스트 대역, 모델 호출 없음
```

컨텍스트 runtime 검사는 설치된 Codex CLI·격리된 프로필·기계적인 SDK 대역을 사용합니다. 실제 터미널 항목은 private PTY를 위한 Python 3도 필요합니다. 무응답·세션 생성 정체·Escape 이후 같은 터미널에서 재개하는지, 120회 연속 도구 호출과 반복 압축이 완료되는지 확인합니다. 실모델을 호출하지 않으며 최대 문맥이나 장시간 무중단 실행을 인증하는 검사는 아닙니다.

단독 실모델 터미널 검사는 `npm run test:terminal -- --execute --driver playwright --model gpt-6-astra --duration-seconds 120`으로 재현하며 `pty` 드라이버도 지원합니다. 먼저 `npx --no-install playwright install chromium`으로 브라우저를 설치하세요. 입력·응답 크기, 취소, 동결 증거, 통합 `test:soak -- --terminal` 경로는 [터미널·내구성 검사](docs/SOAK_TESTING_KO.md)를 참고하세요. 실검증은 Copilot 사용량이 발생하며 기본 `--plan`은 모델을 호출하지 않습니다.

별도 계약 `codex-ghcp-tui-12-v1`은 운영 실행기의 **실제 TUI**를 headless Playwright/xterm.js로 구동합니다. **12개 시나리오 × 6개 모델 = 72건**입니다. 피커 고정과 전환, shell·`apply_patch` 도구, Copilot MCP를 끈 상태의 Codex MCP, 긴 출력, 대용량 붙여넣기, Escape 복구, `/compact`, `resume --last`, reasoning 수준 변경, `/new`·`/quit` 정리를 검사합니다. `npm run test:tui`(계획), `npm run test:tui:runtime`(오프라인), `npm run test:tui -- --execute`로 실행합니다. [실제 TUI 시나리오](docs/TUI_SCENARIOS_KO.md)를 참고하세요.

**최신 실제 TUI 검증(한국 시간 2026-09-23): `codex-ghcp-tui-12-v1` 70/72(97.22%)**입니다. 구현 `54c7eb77`로 실행했고 현재·동결 소스로 검증했습니다. Opus 5.5, Sonnet 5, Haiku 4.5, Astra는 12/12입니다. 실패 2건은 Sol과 Luna가 U03 픽스처 문구(`token=`)를 거절한 경우로, 도구 호출과 필터 신호가 모두 없었습니다. 이 검증에서 운영 실행기가 Codex 기본 `apply_patch` 도구를 제공하지 않는다는 사실이 드러났습니다. 이제 모델 목록이 이를 선언하며, 최종 실행에서 6개 모델 모두 이 도구를 사용했습니다. 1,282회 표본 동안 bridge의 Copilot 런타임 아래 MCP 프로세스는 없었습니다. [TUI 결과·증거](docs/validation/2026-09-23-tui-scenarios/README_KO.md)를 참고하세요.

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

별도 계약 `codex-ghcp-stability-11-v4`는 **11개 시나리오 × 6개 모델 = 66건**입니다. 도구 순서 변경, pending 정책 거절, HTTP 중복·취소, SDK 연결 상실, 스트림 불일치, resume·문맥 압축을 실제 Codex 경로에서 검사합니다. 장애 주입과 실제 모델 결과를 구분합니다. [범위·판정 기준·설정·명령](docs/STABILITY_TESTING_KO.md)을 참고하세요.

```bash
npm run test:stability:stress
npm run test:stability:runtime
npm run test:stability -- --plan
npm run test:stability -- --execute  # Copilot 사용량 발생
```

**최신 실제 Codex 전체 검증(6개 모델 계약, 한국 시간 2026-09-23)은 기본 v4 57/66(86.36%), 별도 `application-data-v2` 63/66(95.45%)입니다.** 두 행렬 모두 구현 `68f92d74`로 전체 실행하고 현재·동결 소스로 검증했습니다. freeform `apply_patch` 목록 변경 전 결과이며 `54c7eb77`에서는 다시 실행하지 않았습니다. v4에서 `claude-opus-5.5`를 제외한 모델은 모두 11/11이며, Opus 5.5의 실패 9건은 모두 명시적인 상위 필터입니다. application-data-v2의 남은 실패는 Opus 필터 1건, SDK `disconnect` 정리 시간 초과 1건, 모델 도구 반복 미충족 1건입니다. bridge는 이제 쓰지 않는 Copilot 런타임 MCP 서버를 비활성화합니다(최종 행렬 동안 MCP 프로세스 0개). 실검증 중 macOS `EPERM` supervisor 오판도 찾아 수정했습니다. [변경·실행 이력·증거](docs/validation/2026-09-23-six-model-switch/README_KO.md)를 참고하세요.

**이전 실제 Codex 전체 검증(과거 7개 모델 v3/application-data-v1 계약, 한국 시간 2026-09-23)은 기본 v3 66/77(85.71%), 별도 `application-data-v1` 72/77(93.51%)입니다.** 터미널 실행기 통합 후 두 행렬을 각각 전체 실행하고 현재·동결 소스로 검증했습니다. 상위 필터·literal 레이블 누락·반복 도구 호출 누락을 실패로 유지하며, 77/77도 기존 95% 목표 달성도 아닙니다. 추가 실제 PTY·Playwright 확인에서 스크롤 영역 관측 오류를 찾아 수정했습니다. 앞선 74/77을 포함한 과거 결과는 별도로 보존하고 점수를 조합하지 않습니다. [구현·전체 결과·증거](docs/validation/2026-09-22-terminal-integration/README_KO.md)와 [검증 목록](docs/validation/README_KO.md)을 참고하세요.

사용자 요청으로 이번 수정 전에 삭제한 과거 검증 문서는 복원하지 않았습니다. 이번 수정 중 수행한 전체 실행은 실패·시간 초과를 포함해 각각 기록했으며, 과거 셀을 새 점수로 재사용하지 않습니다. 수시간 안정성이나 제품 전체 지원을 인증하는 결과는 아닙니다.

## 공식 참고 자료

- [Codex CLI](https://github.com/openai/codex)
- [Codex 고급 설정](https://developers.openai.com/codex/config-advanced/)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
