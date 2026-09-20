# Codex 네이티브 검증 실행 방법

[시나리오와 대응표](NATIVE_SCENARIOS_KO.md) · [English](NATIVE_SCENARIOS.md) · [README](../README_KO.md)

## 실행 모드

| 명령 | 실행 내용 | 실제 모델 호출 |
|---|---|---|
| `npm test` | 실행기·bridge 단위검사와 로컬 테스트 대역 | 없음 |
| `npm run test:scenarios` | 69기능/207시나리오 설계 계약 검사 | 없음 |
| `npm run test:runner:prepare` | 드라이버/판정기 준비 상태 | 없음; 외부 프로세스도 없음 |
| `npm run test:runner:check -- --output NEW_DIR` | 모든 단위검사를 오프라인 guard 아래 실행하고 사전 점검 증명 저장 | 없음 |
| `npm run test:runner:runtime` | 실제 Codex 버전·초기화·설정·오류 경로, 합성 catalog | 없음 |
| `npm run test:runner:drivers` | 실제 Codex + scripted SDK로 준비된 네이티브 드라이버 점검 | 없음 |
| `npm run test:e2e:native-v2 -- --run-selected ...` | 명시적으로 선택한 준비 완료 시나리오를 실제 SDK로 실행 | 있음 |
| `npm run test:e2e:native-v2 -- --execute ...` | 7모델·207시나리오 전체 acceptance; 전체 구현 gate 필수 | 있음; gate 실패 시 없음 |
| `npm run test:e2e:protocol -- ...` | **별도 보조 검사**인 HTTP/CLI 24개 시나리오 | `--execute`에서만 있음 |

`test:e2e:native-v2` 기본 모드는 `--prepare`입니다. 명령 이름에 e2e가 있어도 자동으로
계정 인증이나 모델 사용을 시작하지 않습니다. `--execute`와 `--run-selected`는 실제 Copilot 사용량을 소비합니다.
현재 전체 드라이버는 완성되지 않았으므로 **전체 acceptance는 실행 전에 거부되는 것이 정상**입니다.

## 모델 없는 점검

Node.js `^20.19.0 || >=22.12.0`, `npm ci`가 필요합니다.
네이티브 runtime/driver 자체 검사에는 **Codex CLI 0.154.0**이 추가로 필요합니다.
셸에서 `codex`를 wrapper로 설정했다면 `CODEX_BIN`에 원래 네이티브 실행 파일 경로를 지정합니다.

```bash
npm test
npm run test:scenarios

# 실제 Codex, 모델 요청 없음
npm run test:runner:runtime
npm run test:runner:drivers -- --output .runtime/native-driver-check-001

# 방금 만든 오프라인 증거를 독립 재판정
npm run test:runner:drivers -- --verify .runtime/native-driver-check-001/results.json
```

`test:runner:drivers`는 기본적으로 준비된 모든 시나리오를 합성 `gpt-6-astra` ID 한 개로 실행합니다.
모델이 실제 답을 생성하지 않으며 `realModelCalls: 0`, `executionKind: offline-self-test`,
`liveCompatibilityCredit: false`를 기록합니다. 실제 파일 도구의 결과를 테스트 대역이 반영합니다.

예상된 `unsupported`도 **실행기 자체 검사**에서는 정상 결과일 수 있습니다. 이때
`harnessChecksPassed: true`가 될 수 있지만 사례 상태를 `passed`로 바꾸거나
`fullMatrixPassed: true`로 바꾸지 않습니다. 이 검사는 모델 품질·계정 접근 권한·실서비스 호환성을 검증하지 않습니다.

## 준비된 일부 시나리오의 실모델 진단

다음 예제는 파일 읽기 3개 시나리오만 실행합니다. 모델 호출을 원할 때만 실행하세요.
준비 단계와 실행 단계의 모델·시나리오·구현 hash가 정확히 같아야 합니다.

```bash
npm run test:runner:prepare -- --models gpt-6-astra --feature file-read

npm run test:runner:check -- \
  --models gpt-6-astra --feature file-read \
  --output .runtime/preparation-file-read-001

npm run test:e2e:native-v2 -- \
  --run-selected --models gpt-6-astra --feature file-read \
  --preparation .runtime/preparation-file-read-001/preparation-checks.json \
  --output .runtime/native-file-read-001

npm run test:e2e:native-v2 -- --verify .runtime/native-file-read-001/results.json
```

`--run-selected`는 전체 acceptance gate를 완료했다는 뜻이 아닙니다. 선택한 모든 항목에 완전한
드라이버/판정기가 있어야 하며 `partial`이나 `not-implemented`를 성공 probe로 실행할 수 없습니다.
결과에는 선택하지 않은 조합을 포함한 **1,449개 행**이 남고 `fullMatrixPassed`는 항상 false입니다.

## 전체 acceptance

모든 207개 드라이버/판정기가 준비된 이후에만 다음 절차가 열립니다.
현재 소스에서 준비가 안 된 기능을 숨기거나 `--allow-probes`로 우회할 수 없습니다.

```bash
npm run test:runner:prepare
npm run test:runner:check -- --models all --output .runtime/preparation-all-001
npm run test:e2e:native-v2 -- \
  --execute --models all --concurrency 1 \
  --preparation .runtime/preparation-all-001/preparation-checks.json \
  --output .runtime/native-all-001
npm run test:e2e:native-coverage -- .runtime/native-all-001/results.json
```

전체 구현이 준비되어도 `failed`, `blocked`, `unsupported`, `partial`, `not-run`, `interrupted`가 있으면
전체 호환성 성공이 아닙니다. `structured-output` 같은 미지원 경계를 정확히 확인하는 것과 그 기능을
지원하는 것은 다릅니다. 기본 동시성은 모델 lane 1개, 최대 3개입니다. 같은 모델의 사례는 순차 실행합니다.
`--timeout-ms`는 사례당 1~900000ms이며 기본값은 240000ms입니다.

옆 저장소와 비슷한 `GHCP_E2E_MODELS`, `GHCP_E2E_SCENARIOS`, `GHCP_E2E_OUTPUT_DIR`,
`GHCP_E2E_PREPARATION_REPORT`, `GHCP_E2E_CONCURRENCY`도 지원합니다. ID를 쉼표로 구분합니다.

## 증거와 상태

```text
NEW_DIR/
  catalogue.json       # 이 실행의 전체 시나리오 계약
  design.json          # 설계 검사 (실모델 검증과 별개)
  plan.json            # 선택 범위와 드라이버 준비 상태
  progress.json        # 사례 완료마다 atomic checkpoint
  results.json         # 정상 종료/취소 처리 뒤 전체 결과
  coverage.json        # 모델별 전체 69기능 분모의 집계
  cases/MODEL/SCENARIO/attempt-001/
    native.json
    sdk.json
    http.json
    diagnostics.json
    observations.json
    state.json
    processes.json
```

- `passed`: 다섯 판정이 모두 참인 지원 기능의 사례.
- `unsupported`: 명시적 미지원 경계를 모든 판정으로 확인함. 호환성 점수 없음.
- `blocked`: 런타임/계정/catalog 등 선행 조건 문제. 정리·격리도 실패하면 `failed`로 취급.
- `failed`: 동작 판정 또는 격리·정리 실패.
- `partial`: 저장된 시도의 판정기가 불완전함. live 선택 gate는 이 상태의 실행을 사전에 막음.
- `interrupted`: SIGINT/SIGTERM 등으로 사례가 중단됨; 성공으로 계산하지 않음.
- `not-run`: 선택하지 않았거나 실행 시작 전 중단된 행. 분모에서 삭제하지 않음.

정상적으로 처리한 SIGINT/SIGTERM은 현재 사례 정리 후 증거와 남은 `not-run`을 보존합니다.
SIGKILL·전원 차단에서는 마지막 `progress.json`까지만 보장합니다. 결과 디렉터리는 덮어쓰지 않습니다.
재실행은 새 디렉터리를 사용합니다. 내부 저장 API는 `attempt-002` 같은 추가 시도를 덮어쓰기 없이
기록할 수 있지만, CLI의 기존 결과 이어쓰기/자동 재시도는 지원하지 않습니다.

## 종료 코드

- `0`: 해당 명령의 계약 충족. 설계 검사·오프라인 자체 검사 성공을 실모델 성공으로 해석하지 마세요.
- `1`: 준비 공백, 비통과 결과, 또는 자체 검사 불일치.
- `2`: 잘못된 인자, 실행 전 gate/사전 점검 증명/증거 무결성 오류.
- live 실행 취소: SIGINT `130`, SIGTERM `143`.

전체 coverage 명령은 전체 matrix 통과를 요구합니다. 선택 범위의 live 성공 여부는
`test:e2e:native-v2 -- --verify`로 확인합니다. 오프라인 결과는 live 검증 명령에서 거부되며
`test:runner:drivers -- --verify`로만 자체 검사 결과를 확인합니다.

## 안전·보존 범위

- 새 디렉터리 `0700`, 증거 파일 `0600`; 기존 결과 삭제·resume 없음.
- 임시 HOME/CODEX_HOME/workspace, 동적 loopback 포트, 기본 read-only sandbox와 명시된 fixture 쓰기만 사용.
- 자식 Codex에 Copilot/OpenAI 토큰, 사용자 proxy, `NODE_OPTIONS`를 전달하지 않고 로컬 bridge 토큰만 전달.
- 기존 사용자 daemon의 stop 명령, 전역 프로세스 종료, 사용자 인증 변경, 옆 저장소 쓰기 없음.
- SDK trace와 원본 출력은 민감할 수 있으므로 비공개 보관. 토큰 redaction은 모든 임의 민감정보의 자동 탐지를 보장하지 않음.
- hash 검사는 손상·혼입 탐지이며 전자서명이나 악의적인 로컬 작성자에 대한 원격 증명이 아님.
- 소스/테스트/의존성 manifest나 런타임이 바뀌면 사전 점검을 다시 생성. 이전 증거는 보존하되 현재 구현 증거로 재인증하지 않음.

## 실행기를 확장하는 위치

- `scripts/native/drivers/`: 네이티브 실행과 동기 증거 판정.
- `scripts/native/registry.mjs`: 정확한 시나리오 ID 등록; 누락 항목에 generic PASS fallback 없음.
- `scripts/native/fixture.mjs`: owned workspace/process, app-server, snapshot, 정리.
- `scripts/native/app-server.mjs`: 양방향 JSONL RPC, callbacks, 턴 완료, 취소.
- `scripts/native/report.mjs`: 전체 matrix, 시도별 상태, 독립 재판정.
- `test/native-*.test.mjs`: 실행기·판정기 회귀 검사.

**보조 `scripts/validate.mjs`의 24개 시나리오는 위 네이티브 207개를 대신하지 않습니다.**
