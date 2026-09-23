# OpenAI Codex × GitHub Copilot SDK

[English](README.md) · [사용법·문제 해결](docs/USAGE_KO.md) · [호환성](docs/COMPATIBILITY_KO.md) · [구조](docs/ARCHITECTURE_KO.md)

공식 **Codex CLI**에서 **GitHub Copilot 계정의 모델**을 사용합니다.

```text
Codex → 로컬 HTTP/SSE bridge → GitHub Copilot SDK → 선택한 Copilot 모델
```

도구 실행·승인·샌드박스는 계속 Codex가 담당합니다. bridge는 요청과 응답을 변환할 뿐 셸·파일 도구를 실행하지 않습니다. **비공식 연동 프로젝트**이며 Codex와 Copilot의 공식 지원 조합은 아닙니다. 프롬프트·도구 결과는 GitHub Copilot으로 전송되고 계정의 사용 한도·과금 정책이 적용됩니다.

## 준비 사항

- Node.js `^20.19.0` 또는 `>=22.12.0`, npm, Git, Bash. 예시는 Bash/zsh 기준이며 CI는 Linux와 macOS에서 실행합니다.
- 설치·인증된 [Copilot CLI](https://github.com/github/copilot-cli). `copilot --version`으로 확인하고 필요하면 `copilot login`을 실행합니다.
- 원하는 모델에 접근할 수 있는 GitHub Copilot 계정.
- 공식 Codex CLI **0.154.0**. 아래 설치 명령을 사용합니다.

기존 Copilot 로그인을 사용하므로 **OpenAI API 키나 GitHub 토큰 복사가 필요하지 않습니다.** `COPILOT_HOME`으로 기존 Copilot 홈을 선택하며 기본값은 `~/.copilot`입니다.

## 빠른 시작

### 1. 저장소 받기

이미 clone했다면 해당 저장소를 열고 2단계부터 진행하세요.

```bash
git clone https://github.com/junwoojeong100/openai-codex-ghcp-sdk.git
cd openai-codex-ghcp-sdk
```

### 2. 의존성 설치

저장소 루트에서 실행합니다. Codex 0.154.0이 이미 설치돼 있다면 전역 설치 명령은 생략하세요.

```bash
npm install -g @openai/codex@0.154.0
npm ci
command codex --version
```

버전 출력은 `codex-cli 0.154.0`이어야 합니다. 실행기는 더 새 버전도 허용하지만 이 안내와 검증 기록의 기준은 **0.154.0**입니다. SDK는 **1.0.14**로 고정하며, 업그레이드하면 프로토콜 수정이 필요할 수 있습니다.

### 3. 설치와 계정 접근 확인

```bash
./bin/ghcp-doctor
./bin/ghcp-models
```

doctor의 각 도구 `ok`와 Codex의 `supportedVersion`이 모두 `true`여야 합니다. doctor는 **로그인을 검사하지 않습니다.** 모델 명령은 프롬프트를 보내지 않고 Copilot 목록 접근만 확인합니다. `gpt-6-astra`가 `disabled`나 `not available`이 아닌지 확인하세요. 실패했다면 [문제 해결](docs/USAGE_KO.md#제한과-문제-해결)을 먼저 확인합니다.

### 4. Codex 시작

```bash
./bin/codex-ghcp
```

Astra를 사용할 수 없다면 `./bin/codex-ghcp --ghcp-model claude-sonnet-5`처럼 계정에서 사용 가능한 모델을 지정하세요.

**완료 기준:** Codex가 열리고 첫 프롬프트에 답합니다. 예를 들어 `OK라고만 답해줘.`를 입력해 확인하세요. 이 요청은 Copilot 사용량을 소비합니다. 종료하려면 `/quit`을 입력합니다.

실행기는 빈 루프백 포트에 bridge를 시작하고 준비 상태를 확인한 뒤 Codex를 실행합니다. Codex가 종료되면 자신이 시작한 bridge도 정리합니다. **`.env` 파일이나 셸 설정은 필요하지 않습니다.** 다른 저장소에서 작업하려면 [해당 프로젝트에서 실행기를 호출](docs/USAGE_KO.md#codex-실행)하세요.

## 기본 사용법

| 목적 | 명령 |
| --- | --- |
| 시작 모델 선택 | `./bin/codex-ghcp --ghcp-model claude-sonnet-5` |
| 현재 디렉터리의 최근 대화 재개 | `./bin/codex-ghcp -- resume --last` |
| bridge 없이 실행기 도움말 확인 | `./bin/codex-ghcp --help` |
| bridge 없이 공식 CLI 버전 확인 | `command codex --version` |

비대화형·읽기 전용 요청:

```bash
./bin/codex-ghcp -- exec --sandbox read-only \
  "README_KO.md를 읽고 프로젝트의 목적을 한 문장으로 요약해줘."
```

일반 Codex 인자는 `--` 뒤에 전달합니다. 모델 선택은 공식 CLI의 `--model`/`-m` 대신 **`--ghcp-model`**을 사용하세요. 공급자·전송 설정을 덮어쓰는 인자는 거절합니다. Git 저장소 밖에서는 `exec --skip-git-repo-check`로 Git 디렉터리 검사만 생략할 수 있으며, 샌드박스를 끄지는 않습니다.

다른 프로젝트에서는 실행기의 절대 경로를 사용하면 현재 작업 디렉터리를 유지합니다. 어디서든 `codex`만 입력하려면 **선택 사항인** [zsh 연동·해제 안내](docs/USAGE_KO.md#선택적-zsh-연동)를 따르세요. bridge를 상주시켜 재사용하려면 [실행·상태·종료](docs/USAGE_KO.md#codex-실행)를 참고하세요.

## 모델

지원 ID는 아래 6개이며 피커에서도 이 순서를 사용합니다. 실제 사용 가능 여부는 계정·조직 정책에 따릅니다.

| 표시 이름 | 모델 ID |
| --- | --- |
| Claude Opus 5.5 | `claude-opus-5.5` |
| Claude Sonnet 5 | `claude-sonnet-5` |
| Claude Haiku 4.5 | `claude-haiku-4.5` |
| GPT-6 Astra | `gpt-6-astra` |
| GPT-6 Sol | `gpt-6-sol` |
| GPT-6 Luna | `gpt-6-luna` |

시작 모델은 `--ghcp-model`, `GHCP_MODEL`, 기본값 **`gpt-6-astra`** 순으로 선택합니다. 사용할 수 없거나 지원하지 않는 ID는 오류로 알리며 자동 대체하지 않습니다. `./bin/ghcp-models --json`으로 계정의 목록을 확인할 수 있습니다.

`/model`은 실행 중인 모델을 바꿉니다. 피커의 `(default)` 표시는 실행기의 기본값과 다르며, Codex가 선택을 `~/.codex/config.toml`에 저장할 수 있습니다. [피커 동작·문맥 예산·압축](docs/USAGE_KO.md#모델-선택과-문맥)을 참고하세요.

## 사용 전 알아둘 제한

- 텍스트와 Codex가 실행하는 function/custom 도구를 지원합니다. 기본 `apply_patch`와 Codex MCP 도구도 포함하지만 custom 도구의 grammar는 생성 강제가 아닌 안내입니다.
- 이미지·음성·영상·파일을 모델에 직접 첨부하는 입력, 공급자 호스팅 도구, 구조화 JSON 출력, WebSocket, 원격 Responses 압축은 지원하지 않습니다. **Codex 도구를 통한 로컬 파일 읽기·편집은 지원합니다.** Codex의 선택적 제목 생성 요청은 거절하지만 대화는 제목 없이 계속할 수 있습니다.
- bridge 대화 상태는 메모리에 있습니다. 상주 bridge를 중지하기 전에 Codex 세션을 닫으세요. 재시작하면 대기 중 호출이 사라집니다. 실행기는 승인·샌드박스를 우회하지 않습니다.

고급 기능을 사용하기 전에 [전체 호환성 범위](docs/COMPATIBILITY_KO.md)를 확인하세요. 모델 목록이나 TUI 통과 결과가 Codex 전체 기능 지원을 뜻하지는 않습니다. [실모델 기록](docs/validation/README_KO.md)에는 미해결 상위 필터 실패도 있으며, 서로 다른 계약의 점수를 합산하지 않습니다.

## 개발과 검증

검증은 **실행기를 사용하기 위한 필수 절차가 아닙니다.** `npm ci` 후 기본 개발 검사로 단위 검사·소스 커버리지·시나리오 및 문서 정합성을 확인합니다. **모델 호출이나 Copilot 로그인은 필요하지 않습니다.**

```bash
npm run test:ci
```

단위·실행 제어 검사만 필요하면 `npm test`, 생성 문서 정합성만 확인하려면 `npm run docs:scenarios:check`를 사용하세요. `coverage/lcov.info`는 관측한 소스 커버리지이며 제품 기능 지원율이 아닙니다.

더 넓은 범위의 **오프라인 runtime 검사**에는 Node 22.12 이상, Codex 0.154.0, Python 3를 설치한 뒤 다음을 실행합니다.

```bash
npx --no-install playwright install chromium
env -u GHCP_LIVE_HANDOFF_OUTPUT npm run test:runtime
```

실제 Codex/PTY/브라우저·워크플로·안정성 경로를 SDK 대역으로 검사하며 Copilot 로그인은 필요하지 않습니다. `env -u`는 이번 호출에서만 실모델 핸드오프 옵션을 제거하므로, 기존 `GHCP_LIVE_HANDOFF_OUTPUT` 설정 때문에 모델을 호출하지 않습니다. CI는 이 오프라인 검사를 Linux/macOS의 단위 커버리지 작업과 분리해 실행합니다.

특정 기능만 검사하려면 아래 안내 중 **하나를 선택**하세요. 모든 행을 순서대로 실행하는 설치 절차가 아닙니다. 계획 명령에는 프로젝트 의존성만 필요하며 Codex·브라우저·Copilot 로그인은 필요하지 않습니다. **실모델 `--execute`와 soak의 `--smoke`는 Copilot 사용량이 발생합니다.** 검사별 실모델 통과 기준은 서로 다릅니다.

| 목적과 실모델 통과 기준 | 계획 명령 (모델 호출 없음) | 안내 |
| --- | --- | --- |
| 개발 워크플로: **108/108** (18개 × 6개 모델) | `npm run test:compatibility -- --plan` | [호환성 실행·해석](docs/COMPATIBILITY_TESTING_KO.md) · [시나리오 사양](docs/NATIVE_SCENARIOS_KO.md) |
| bridge 장애·복구: **66/66** (11개 × 6개 모델) | `npm run test:stability -- --plan` | [안정성](docs/STABILITY_TESTING_KO.md) |
| 실제 대화형 TUI: 목표 **69/72**, 전체 통과 **72/72** | `npm run test:tui -- --plan` | [TUI 시나리오](docs/TUI_SCENARIOS_KO.md) |
| PTY·브라우저: 선언한 작업 완료, 관측한 실패 없음 | `npm run test:terminal -- --plan` | [터미널 검사](docs/SOAK_TESTING_KO.md) |
| 내구성: 모든 실행 경로 5시간 이상, 관측한 실패 없음 | `npm run test:soak -- --plan` | [내구성](docs/SOAK_TESTING_KO.md#통합-soak-실행기) |
| Opus 필터: 진단 증거 수집이며 호환성 판정 아님 | `npm run diagnose:opus` | [진단](docs/OPUS_DIAGNOSTICS_KO.md) |

과거 점수·구현 hash·보존한 실패는 설치 절차가 아닌 [검증 목록](docs/validation/README_KO.md)에 정리합니다. 생성 시나리오 문서는 `scripts/compatibility/documentation.mjs`와 catalog가 원본입니다. 생성 파일을 직접 편집하지 말고 `npm run docs:scenarios`로 갱신하세요.

## 기여자와 참고 자료

[junwoojeong100](https://github.com/junwoojeong100)이 유지보수하며, [Codex](https://github.com/codex)와 [GitHub Copilot](https://github.com/Copilot)이 AI 도구로서 구현·테스트·문서 작성에 기여했습니다.

- [Codex CLI](https://github.com/openai/codex)
- [Codex 고급 설정](https://developers.openai.com/codex/config-advanced/)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
