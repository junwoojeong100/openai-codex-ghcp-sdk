# OpenAI Codex × GitHub Copilot SDK

[English](README.md) · [구조](docs/ARCHITECTURE_KO.md) · [호환성](docs/COMPATIBILITY_KO.md)

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
codex --ghcp-model gpt-5.6-sol
codex -- exec --skip-git-repo-check --sandbox read-only \
  "README_KO.md를 읽고 프로젝트의 목적을 한 문장으로 요약해줘."
codex-original --help       # GHCP를 거치지 않는 공식 CLI 도움말
```

기본 모델은 그대로 `gpt-6-astra`입니다. Copilot 모델은 `--ghcp-model`로 선택하며, GHCP 실행기는 공식 CLI의 `--model`/`-m` 재정의를 거절합니다. 나머지 Codex 인자는 `--` 뒤에 전달합니다. 공식 버전만 확인할 때는 `codex --version` 대신 `codex-original --version`을 사용하세요.

`whence -p`는 함수·별칭을 제외하고 매번 PATH의 실행파일을 찾으므로, nvm 버전 경로를 고정하거나 `codex` 함수로 재귀하지 않습니다. 공식 `codex` 실행파일은 PATH에 유지하고, 이 실행기를 다시 가리키는 별도 `codex` shim은 추가하지 마세요. `CODEX_BIN`은 실행기 호출에만 적용하며 인자·현재 작업 디렉토리·종료 코드는 보존합니다. 이 블록을 로드하지 않는 셸·프로그램은 계속 공식 실행파일을 사용합니다. 셸 연동 없이도 기존 `./bin/codex-ghcp`를 사용할 수 있습니다.

해제하려면 `~/.zshrc`에서 표시된 블록만 제거한 뒤 새 터미널을 열거나, 현재 터미널에서 `unfunction codex codex-original`을 실행하세요. 백업 파일 전체를 복원하면 백업 이후의 다른 셸 설정 변경도 사라지므로 주의하세요.

## 모델 선택

허용하는 Copilot catalog ID는 다음 7개뿐입니다.

| 계열 | 모델 ID |
| --- | --- |
| GPT | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra` |
| Claude | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4.5` |

기본값은 **`gpt-6-astra`**입니다. 계정 catalog와 모델 정책을 확인하며, 사용할 수 없는 모델을 다른 모델로 몰래 대체하지 않습니다.

```bash
./bin/ghcp-models --json
./bin/codex-ghcp --ghcp-model gpt-5.6-terra
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

목록에 표시된다는 사실은 모든 Codex 기능의 호환성을 뜻하지 않습니다. `/v1/models`는 계정의 SDK 모델 정보를 바탕으로 OpenAI 형식의 ID 목록과 Codex catalog 메타데이터를 함께 제공합니다. 실행할 모델은 `--ghcp-model`로 명시하세요. 대화형 `/model` 메뉴의 동작은 아직 검증하지 않았습니다.

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
| 이력 크기 초과 | 새 대화를 시작하거나 메모리·모델 문맥 한도를 고려해 `MAX_REPLAY_BYTES`를 조정합니다. |
| 입력·전송 미지원 | 실행기 기본값과 텍스트 입력을 사용합니다. Codex 버전 변경으로 새로운 요청 형식이 추가됐을 수 있습니다. |
| custom 도구 파싱 오류 | SDK가 grammar 기반 생성을 강제하지 않습니다. 재시도하거나 허용된 다른 모델을 선택하세요. bridge가 원문을 임의 수정하지는 않습니다. |

JSON으로 직렬화한 대화 이력 한도(`MAX_REPLAY_BYTES`)와 HTTP 요청 본문 한도(`MAX_BODY_BYTES`)의 기본값은 각각 **33,554,432바이트(32 MiB)**입니다. 이는 실측으로 검증된 최대 처리량이 아닌 운영상 초기 보호 한도이며 모델 문맥 한도와도 별개입니다. 큰 대화는 여전히 메모리나 모델 문맥 한도를 초과할 수 있습니다. 필요하면 양의 정수 환경 변수로 각 한도를 재정의하고 브리지를 재시작하세요. 실행기는 `.env`를 자동으로 읽지 않습니다. 상주 브리지는 연결된 Codex 세션을 닫은 뒤 종료하세요. 재시작하면 메모리의 대화 상태가 사라집니다.

## 로컬 확인

```bash
npm test
./bin/ghcp-doctor
```

`npm test`는 Node 내장 테스트 러너, fake SDK, 루프백 HTTP만 사용하며 실제 모델을 호출하지 않습니다. 실제 Codex 실행은 별도이며 Copilot 인증이 필요합니다. 공유 검증 실행기나 이웃 프로젝트의 테스트 결과는 사용하지 않습니다.

실제 연결 검증 기록: [2026-09-20 검증 리포트](docs/VALIDATION_REPORT_2026-09-20_KO.md). `gpt-6-astra`로 수행한 결과이며, 당시 버전·환경과 검증 범위에 한정됩니다.

## 공식 참고 자료

- [Codex CLI](https://github.com/openai/codex)
- [Codex 고급 설정](https://developers.openai.com/codex/config-advanced/)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
