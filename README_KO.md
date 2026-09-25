# OpenAI Codex × GitHub Copilot SDK

[English](README.md)

공식 **Codex CLI**에서 **GitHub Copilot 계정의 모델**을 사용합니다.

```text
Codex → 로컬 HTTP/SSE bridge → GitHub Copilot SDK → 선택한 Copilot 모델
```

**bridge**는 Codex와 Copilot 사이의 요청·응답을 변환하는 로컬 서버입니다. 셸·파일 도구 실행과 승인·샌드박스는 계속 Codex가 담당합니다.

**비공식 연동 프로젝트**이며 Codex와 Copilot의 공식 지원 조합은 아닙니다. 프롬프트·도구 결과는 GitHub Copilot으로 전송됩니다. bridge를 로컬에서 실행해도 모델 추론은 로컬에서 이루어지지 않으며, 계정의 사용 한도·과금 정책이 적용됩니다.

**현재 평가:** [구현 상태와 최신 검증](docs/STATUS_KO.md). 핵심 연동 결과와 미지원·미검증 기능을 구분합니다.

| 하려는 작업 | 시작할 곳 |
| --- | --- |
| 설치하고 사용해 보기 | [준비 사항](#준비-사항) → [빠른 시작](#빠른-시작) |
| 내 저장소에서 작업하기 | [다른 프로젝트에서 사용](docs/USAGE_KO.md#다른-프로젝트에서-사용) |
| 실행·대화 중 오류 해결하기 | [문제 해결](docs/USAGE_KO.md#문제-해결) |
| 필요한 기능의 지원 여부 확인하기 | [지원 기능과 제한](docs/COMPATIBILITY_KO.md#이-기능을-사용할-수-있나요) |
| bridge 개발·평가하기 | [구현 완성도](docs/STATUS_KO.md) · [검사 명령](#개발과-검증) · [기록된 결과](docs/validation/README_KO.md) |
| 구현 이해하기 | [구조](docs/ARCHITECTURE_KO.md) |

## 준비 사항

- Node.js **22.12 이상**(권장, runtime 검사에는 필수), npm, Git, Bash. 실행기는 **20.19 이상의 Node 20.x**도 허용합니다. 예시는 Bash/zsh 기준이며 CI 워크플로는 Linux와 macOS 대상으로 설정돼 있습니다. [기록된 실모델 실행](docs/validation/README_KO.md)은 macOS/arm64와 Node 22.16.0에서 수행했습니다.
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

마지막 명령은 `codex-cli 0.154.0`을 출력해야 합니다. 실행기는 더 새 버전도 허용하지만 **기록된 검증 범위에는 포함되지 않습니다.** 이 안내를 따를 때는 **0.154.0**을 사용하세요.

### 3. 설치와 계정 접근 확인

```bash
./bin/ghcp-doctor
./bin/ghcp-models
```

| 검사 | 확인할 결과 | 확인하지 않는 것 |
| --- | --- | --- |
| `ghcp-doctor` | JSON 출력의 모든 `ok`와 Codex의 `supportedVersion`이 `true` | 로그인·모델 접근. `supportedVersion`은 최소 CLI 버전만 확인하며 전체 호환성을 뜻하지 않습니다. |
| `ghcp-models` | 선택한 모델의 상태가 `disabled`나 `not available`이 아님 | 모델의 실제 응답. 프롬프트를 보내지 않고 계정의 목록만 조회합니다. |

모델 목록의 각 줄은 ID·이름·상태 순서이며, 예를 들면 `gpt-6-astra  GPT-6 Astra  enabled`입니다. 사용 가능한 다른 모델을 지정하지 않으면 4단계는 `gpt-6-astra`를 사용합니다.

둘 중 하나라도 실패하면 [시작 문제 해결](docs/USAGE_KO.md#시작과-설정)을 확인하세요.

### 4. Codex 시작

```bash
./bin/codex-ghcp
```

다른 모델로 시작하려면 `./bin/codex-ghcp --ghcp-model claude-sonnet-5`처럼 `--ghcp-model`을 추가하세요.

**완료 기준:** Codex가 열리고 첫 프롬프트에 답합니다. 예를 들어 `OK라고만 답해줘.`를 입력해 확인하세요. 이 요청은 Copilot 사용량을 소비합니다. 종료하려면 `/quit`을 입력합니다.

실행기는 빈 루프백 포트에 bridge를 시작하고 준비 상태를 확인한 뒤 Codex를 실행합니다. Codex가 종료되면 자신이 시작한 bridge도 정리합니다. **설정은 여기까지입니다. `.env` 파일이나 셸 설정은 필요하지 않습니다.** 다른 저장소에서 작업하려면 [해당 프로젝트에서 실행기를 호출](docs/USAGE_KO.md#다른-프로젝트에서-사용)하세요.

## 기본 사용법

| 목적 | 명령 |
| --- | --- |
| 시작 모델 선택 | `./bin/codex-ghcp --ghcp-model claude-sonnet-5` |
| 현재 디렉터리의 최근 대화 재개 | `./bin/codex-ghcp -- resume --last` |
| bridge 없이 실행기 도움말 확인 | `./bin/codex-ghcp --help` |
| bridge 없이 공식 Codex 옵션 확인 | `command codex --help` |
| bridge 없이 공식 CLI 버전 확인 | `command codex --version` |

비대화형·읽기 전용 요청:

```bash
./bin/codex-ghcp -- exec --sandbox read-only \
  "README_KO.md를 읽고 프로젝트의 목적을 한 문장으로 요약해줘."
```

**실행기 옵션은 `--` 앞에, Codex 명령·옵션은 뒤에 둡니다.** 모델은 Codex의 `--model`/`-m`이 아닌 `--ghcp-model`로 선택하세요. 대화를 재개할 때도 마지막 `/model` 선택이 아니라 실행기의 모델 설정을 사용합니다. [대화 재개](docs/USAGE_KO.md#대화-재개)와 [옵션별 입력 위치](docs/USAGE_KO.md#codex-명령과-옵션-전달)를 참고하세요.

선택 사항: [어느 디렉터리에서나 `codex`로 이 실행기 사용](docs/USAGE_KO.md#선택적-zsh-연동)(zsh, 해제 방법 포함) 또는 [상주 bridge 사용](docs/USAGE_KO.md#선택적-상주-bridge).

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

- **지원:** 텍스트 대화와 Codex가 직접 실행하는 도구(셸 명령, 로컬 파일 읽기·편집, 기본 `apply_patch`, Codex MCP 도구). 승인·샌드박스도 Codex가 그대로 적용합니다.
- **미지원:** 이미지·음성·영상·파일을 모델 입력으로 첨부, 웹 검색 같은 공급자 호스팅 도구, 스키마를 강제하는 JSON 출력, WebSocket, 원격 Responses 압축. Codex의 자동 작업 제목 생성은 구조화 출력이 필요해 거절되며, 대화는 제목 없이 계속됩니다.
- **근사 지원:** `apply_patch` 같은 custom 도구의 grammar는 모델에 안내로 전달될 뿐 생성 과정에서 강제되지 않습니다.
- **대기 호출은 메모리에만 보관:** 연결된 Codex 세션을 닫은 뒤 bridge를 중지하세요. Codex에 저장된 이력은 [재개](docs/USAGE_KO.md#대화-재개)할 수 있지만, 재시작한 bridge는 미해결 도구 호출이나 이전 응답 ID를 복원하지 못합니다.

고급 기능에 의존하기 전에 [전체 호환성 범위](docs/COMPATIBILITY_KO.md)를 확인하세요. [현재 실모델 결과와 녹화](docs/validation/README_KO.md)는 검증된 동작과 미지원·미검증 기능을 구분합니다.

## 개발과 검증

실행기를 사용하는 데 검사는 **필요하지 않습니다.** 실모델 검증은 **하나뿐**입니다. 핵심 시나리오 6개를 모델 6개에서 실행하며 **36/36**일 때만 통과합니다.

```bash
npm run verify -- --execute
```

Copilot 사용량이 발생하며 결과 저장과 증거 재계산까지 자동으로 수행합니다. 출력된 `report.md` 경로를 읽으면 됩니다. 프로필 선택·별도 행렬·수동 재검증 단계는 필요하지 않습니다. 준비 사항과 시나리오는 [검증 안내](docs/VERIFICATION_KO.md), 실측 결과는 [현재 결과](docs/validation/README_KO.md)에 있습니다.

개발 시 `npm test`는 모델 호출 없이 단위·안전성·문서 회귀 검사를 실행합니다. `npm run test:runtime`은 실제 Codex/PTY/Chromium에 SDK 대역을 연결하며 역시 모델을 호출하지 않습니다. CI 워크플로에는 두 검사를 별도 작업으로 설정했으며 실모델 행렬은 실행하지 않습니다. 문서만 검사하려면 `npm run test:docs`, 소스 커버리지까지 확인하려면 `npm run test:ci`를 사용합니다.

핵심 v1 검증과 최신 결과·미디어만 보존합니다. 전체 원본 근거는 로컬에 있으며 Git에서 제외합니다. 새 clone에는 공개 요약과 미디어만 있고 전체 실행 근거는 없습니다.

## 기여자와 참고 자료

[junwoojeong100](https://github.com/junwoojeong100)이 유지보수하며, [Codex](https://github.com/codex)와 [GitHub Copilot](https://github.com/Copilot)이 AI 도구로서 구현·테스트·문서 작성에 기여했습니다.

- [Codex CLI](https://github.com/openai/codex)
- [Codex 고급 설정](https://developers.openai.com/codex/config-advanced/)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
