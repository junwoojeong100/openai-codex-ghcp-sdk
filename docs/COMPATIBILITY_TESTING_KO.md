# 통합 개발 시나리오 실행기

[English](COMPATIBILITY_TESTING.md) · [10개 시나리오·커버리지](NATIVE_SCENARIOS_KO.md) · [사용법](../README_KO.md)

## 실행 범위

**시나리오 총 10개 × GHCP 7모델 = 70건**의 단일 구성입니다. 빠른/전체 모드, 모델 일부 선택, 별도 native OpenAI 기준선 실행은 없습니다. 70건은 시나리오 실행 수이며, 하나의 시나리오에는 여러 추론·도구 호출이 들어갈 수 있습니다.

90%는 **일상적인 로컬 개발 작업**을 넓게 검증하려는 설계 목표입니다. 전체 Codex 기능 커버리지나 native GPT와의 동등성을 실측한 수치가 아닙니다. 검증 범위 및 제외 기능은 [커버리지 표](NATIVE_SCENARIOS_KO.md)에 명시합니다. 모델별 모든 하위 조건을 만족한 10/10만 `core-10-compatible`이며, 전체 통과에는 7모델 모두의 10/10이 필요합니다.

기존 시나리오·실행기·검증 기록은 폐기했습니다. 실행기는 이전 결과를 불러오거나 성공 사례만 재사용하지 않고 항상 새 출력 폴더와 합성 fixture를 사용합니다.

## 로컬 자체 검사 — 실제 모델 호출 없음

```bash
npm test
npm run test:scenarios
npm run docs:scenarios:check
npm run test:compatibility -- --plan
npm run test:compatibility:runtime
```

`npm test`는 단위 테스트, 합성 증거, 실행 제어 및 loopback HTTP를 검사합니다. `test:compatibility:runtime`은 **실제 Codex 0.154.0 + 스크립트형 SDK 테스트 대역**으로 10개 드라이버의 native 도구·MCP·Skill·파일 작업을 확인합니다. 실제 모델의 지시 준수/추론 능력을 검증하지 않으며 실모델 호환성 통과로 계산하지 않습니다. 정상적인 OS sandbox가 필요합니다.

## 실제 검증

필수 조건:

- 저장소 `package.json` engines를 만족하는 Node.js와 설치된 의존성.
- 원본 **Codex CLI 0.154.0**, **Copilot SDK 1.0.14**.
- macOS 또는 Linux의 POSIX process group. 현재 Windows live 실행은 지원하지 않습니다.
- 기존 Copilot 로그인 및 대상 모델 접근 권한. **OpenAI API 키는 필요하지 않습니다.**
- workspace-write/network-off 정책을 실제 강제하는 Codex/OS sandbox.

`.env`를 자동으로 로딩하지 않습니다. 인증값을 프롬프트·소스·리포트에 넣지 마세요. 다음 명령은 실제 Copilot 사용량을 발생시킵니다.

```bash
# 항상 10개 × 7모델 전체 실행
npm run test:compatibility -- --execute

# 원본 실행 파일과 새 결과 폴더 지정
npm run test:compatibility -- --execute \
  --bin /absolute/path/to/codex \
  --output .runtime/workflows-new-run
```

인자 없이 실행하면 `--plan`입니다. `--models`, `--fast`, `--suite`는 지원하지 않습니다. 기존 출력 폴더를 지정하면 덮어쓰지 않고 실패합니다. 사용할 수 없는 모델은 해당 10건을 `blocked`로 기록하며 다른 모델로 대체하지 않습니다. 공통 인증/버전 점검 실패 시 전체 70개 슬롯을 유지한 차단 리포트를 저장합니다.

## 속도·시간·오류 처리

- 사전 점검은 최대 90초이며 모델 추론 없이 버전과 Copilot catalog를 확인합니다.
- 최대 4개 모델을 병렬 실행하고, 같은 모델의 10개 시나리오는 순차 처리합니다.
- 시나리오별 60~150초 제한은 프로세스 시작·fixture·추론·도구·정리를 포함하며 마지막 8초는 정리에 예약합니다.
- 전체 1시간은 목표입니다. **총시간이 초과됐다는 이유로 남은 검사를 취소하지 않습니다.** 개별 케이스의 실패/시간 초과 뒤에도 다음 케이스를 실행합니다.
- 자동 케이스 재시도와 성공 결과 선별은 없습니다. `failed`, `unsupported`, `blocked`, `timed-out`, `not-run`은 통과가 아니며 분모에 남습니다.
- Ctrl+C/SIGTERM은 신규 작업을 멈추고 소유 자원만 정리한 뒤 미완료 상태를 기록합니다.

## 안전과 판정 범위

- 격리 HOME/CODEX_HOME와 합성 Git 저장소를 생성합니다. 사용자의 실제 작업 트리를 테스트 대상으로 쓰지 않습니다.
- 생산용 bridge/SessionManager를 사용하지만, 테스트에서 `unified_exec` 및 freeform `apply_patch`를 명시적으로 노출합니다. 생산 launcher 기본 catalog 노출까지 검증했다고 주장하지 않습니다.
- 명령 결과의 완료 이벤트에 앞부분이 생략된 경우 **같은 native call ID의 실제 도구 결과**만 보완 증거로 사용합니다. 모델의 답변을 명령 출력으로 신뢰하지 않습니다.
- 승인 테스트에서는 원본 helper hash와 정확한 명령이 일치할 때 한 번의 쓰기만 허용합니다. MCP 테스트도 소유한 로컬 fixture의 정확한 read-only lookup만 개별 승인합니다. 영구 승인/전역 우회는 없습니다.
- SDK 인증은 부모 측에 유지하고 native 셸에는 전달하지 않습니다. 코드·사용자 설정 hash, 비허용 파일, Git index/HEAD 및 소유 SDK 세션/프로세스 정리를 확인합니다.
- 증거로 실패 원인을 특정할 수 없으면 `undetermined`입니다. 모델 능력, bridge 오류, API 장애를 근거 없이 서로 치환하지 않습니다.

## 결과 저장과 재검증

기본 결과는 `.runtime/compatibility-<run-id>/report.json` 및 `report.md`입니다. 케이스마다 native 이벤트, HTTP/SSE, SDK 모델/도구 이벤트, 파일 전후 상태, oracle 및 cleanup 증거를 저장합니다. 강제 종료된 케이스의 부분 증거는 진단용일 뿐 통과 근거가 아닙니다.

```bash
npm run test:compatibility -- --verify .runtime/compatibility-<run-id>/report.json
```

재검증은 모델 호출 없이 사양/구현 hash, 정확한 70개 슬롯, 증거 소유권/파일 hash, 판정 재계산, native/SDK 경로와 cleanup receipt를 확인합니다. hash는 변경 감지용이며 제3자 서명이나 원격 attestation이 아닙니다. 코드·사양을 바꾸면 새 결과가 필요합니다.

새 결과를 저장소에 공개할 때는 **인증값·계정 정보·개인 경로를 점검한 요약본**과 필요한 검증 증거만 포함하세요. 전체 원본은 `.runtime` 아래 비공개로 보관할 수 있습니다. `.git`의 과거 커밋 이력은 검증 실행 자료와 별개이며 재작성하지 않습니다.

종료 코드: `0` 계획 검사 또는 70/70 통과, `1` 실패·차단·미완료, `2` 잘못된 인자나 증거 오류.
