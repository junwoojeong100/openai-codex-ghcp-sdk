# v4 실검증 결과 — 2026-09-21

[English](README.md) · [126건 판정 JSON](summary.json) · [실패 상세](FAILURES_KO.md) · [증거 해시](evidence-manifest.json) · [시나리오](../../NATIVE_SCENARIOS_KO.md)

**126건 중 100건 통과(79.4%), 26건 실패. 소요 722.935초(약 12분 3초).**
미지원 0, 차단 0, 시간 초과 0, 미실행 0건.

**전체 통과는 아닙니다.** 실패를 분모에서 제외하거나 재실행하여 대체하지 않았습니다.
18/18로 이 버전의 워크플로 판정을 받은 모델: **gpt-6-astra**. 다른 모델은 `not-established`입니다.

통과율은 이 합성 워크플로 행렬의 관측값입니다. 검토자 체크리스트 **75%는 설계 점수**, **90%는 목표**, 실제 제품 기능 커버리지는 **미측정/null**입니다. OpenAI 제공자와의 동등성도 측정하지 않았습니다.

## 실행 정보와 고정한 기준

- Run ID: `3dffb267-558d-4290-ba3c-67bbdcf0d42a`
- KST: 2026-09-21T12:09:02.244+09:00 → 2026-09-21T12:21:05.171+09:00
- Contract: `codex-ghcp-workflows-18-v4`; Codex `0.154.0`; Copilot SDK `1.0.14`.
- 모델 7개 × 시나리오 18개, 최대 4개 모델 병렬. 개별 제한은 유지하고 전체 강제 종료·모델 대체·부분 선택·케이스 재시도는 하지 않았습니다.
- 문서 정리와 로컬 검사 후 카탈로그·구현을 고정했습니다. 실행 중과 결과 확인 후 프롬프트·oracle·판정 기준은 바꾸지 않았습니다.
- `implementationUnchanged=true`, `userSettingsUnchanged=true`, `interrupted=false`.
- 완료된 셀의 소유 프로세스 정리 확인: 126/126.
- 작업 트리 기준 커밋: `57f0658d2dfb75628963ed580f8c84c855558f7b`. 미커밋 작업을 포함한 실행 원본은 사전 소스 스냅샷과 [파일 해시](source-manifest.json)로 보존했습니다.

## 모델별 결과

| 모델 | 통과 | 미통과 시나리오 | 판정 |
|---|---:|---|---|
| gpt-5.6-sol | 16/18 | C03, C17 | not-established |
| gpt-5.6-terra | 16/18 | C10, C17 | not-established |
| gpt-5.6-luna | 15/18 | C03, C04, C18 | not-established |
| gpt-6-astra | 18/18 | — | v4-compatible |
| claude-opus-5 | 13/18 | C07, C11, C14, C15, C18 | not-established |
| claude-sonnet-5 | 11/18 | C03, C08, C10, C11, C12, C15, C18 | not-established |
| claude-haiku-4.5 | 11/18 | C03, C06, C10, C11, C14, C15, C18 | not-established |

`v4-compatible`은 이 계약의 18개 워크플로 통과만 의미하며 전체 제품 지원을 뜻하지 않습니다.

## 시나리오별 결과

| 시나리오 | 워크플로 | 통과/7 |
|---|---|---:|
| C01 | CLI 시작·정확한 모델 선택·유니코드 스트리밍 | 7/7 |
| C02 | AGENTS 지시문·Skill 실행·비신뢰 입력 방어 | 7/7 |
| C03 | 저장소 탐색·코드 이해·Git diff 리뷰 | 3/7 |
| C04 | 다중 파일 리팩터링·생성·이동·삭제·Git 보호 | 6/7 |
| C05 | 실패 재현→디버깅→수정→회귀 테스트 | 7/7 |
| C06 | 함수 도구·MCP 리소스/도구·오류 복구 | 6/7 |
| C07 | 승인 거절·단일 동작 허용·우회 방지 | 6/7 |
| C08 | 파일·네트워크 샌드박스와 프로세스 정리 | 6/7 |
| C09 | 대화 기억·지시 변경·다른 세션 격리 | 7/7 |
| C10 | 재시작 후 resume·부작용 중복 방지 | 4/7 |
| C11 | 생산 launcher 기본 도구·프로세스 수명 | 4/7 |
| C12 | 네이티브 코드 리뷰 | 6/7 |
| C13 | Plan 모드·사용자 확인 왕복 | 7/7 |
| C14 | 장문 문맥 압축 후 새 프로세스 재개 | 5/7 |
| C15 | 실행 중 중단·소유 작업 정리·후속 턴 | 4/7 |
| C16 | HTTP MCP·Bearer 인증·오류 복구 | 7/7 |
| C17 | 네이티브 서브에이전트 위임·결과 회수 | 5/7 |
| C18 | 일시적 HTTP 오류 재시도·중복 실행 방지 | 3/7 |

## 남은 실패와 증거

[실패 상세](FAILURES_KO.md)에 모든 미통과 셀의 원래 체크 ID, 관측된 증상, 원시 파일·이벤트 위치를 기록했습니다. [summary.json](summary.json)은 통과 셀까지 포함한 전체 판정과 효율 진단을 보존합니다.
주요 관측은 다음과 같습니다. 모두 원래 실패 판정을 유지합니다.

- **실제 값·절차 불일치:** C03의 잘못된 리뷰 행 번호, C04의 `total()` 반환값 1 유지, C06의 필수 오류 조회 생략, C17의 첫 spawn 실패 후 두 번째 spawn.
- **문자열 보존:** C10 세 모델은 `receipt:` 접두사를 잃었습니다. C11·C14·C15·C18의 10개 셀은 값은 포함했지만 설명·백틱·fence를 덧붙여 정확한 출력 조건을 충족하지 못했습니다.
- **최종 결과 미제공:** Opus C07·C14는 content-filter 문구로 끝났고, Luna C18은 fixture 파일 읽기를 거절했습니다. 이 메시지를 근거 없는 내부 원인 진단으로 확대하지 않습니다.
- **검증 형태의 한계:** Haiku C03의 `./` 경로 접두사, Sonnet C08의 `cd … &&` probe 명령 미인식, Sonnet C12의 올바른 diff 뒤 복합 명령 종료코드 1도 실패로 남았습니다. Sonnet C03은 올바른 JSON을 냈지만 실제 미커밋 diff 증거가 없었습니다.

기록된 증상과 추정 원인을 구분합니다. 원래 `undetermined` 분류를 유지하며, 추가 증거 없이 모델·bridge·harness 결함으로 단정하지 않습니다. 통과처럼 보이는 최종 설명만으로 실패를 뒤집지 않습니다.

## 실행 전 로컬 검사

- `npm test`: **134/134**.
- `npm run test:compatibility:runtime`: **18/18**, 실제 Codex + 기계적 SDK 대역, 실제 모델 호출 **0**.
- `npm run test:scenarios`, `npm run docs:scenarios:check`, `npm run test:compatibility -- --plan`: **exit 0**.
- JavaScript 구문 검사: **56개 파일 통과**.
- 최초 제한된 샌드박스에서는 루프백 바인딩 `EPERM`으로 단위 테스트 11건과 런타임 검사가 실패했습니다. 로그를 보존하고 승인된 호스트 환경에서 다시 검사해 위 결과를 확인했습니다. 이는 실모델 케이스 재시도가 아닙니다.
- [로컬 검사 기록과 로그 해시](local-checks.json). 오프라인 통과를 실모델 통과율에 합산하지 않습니다.

## 재검증과 증거 보존

원시 증거는 `.runtime/workflows-18-v4-20260921/live`에 보존했습니다. 전체 원시 로그는 개인 경로를 포함하므로 공개 요약에는 넣지 않았습니다. 해시만으로 원시 관측 내용을 독립 재평가할 수 없으며, 제3자 인증도 아닙니다.

```bash
npm run test:compatibility -- --verify .runtime/workflows-18-v4-20260921/live/report.json
# Frozen pre-run source (same dependencies required)
node .runtime/workflows-18-v4-20260921/source-snapshot/scripts/compatibility.mjs \
  --verify .runtime/workflows-18-v4-20260921/live/report.json
```

검증 결과는 `evidenceIntegrity=true`, `fullMatrixPassed=false`입니다. 종료 코드 1은 미통과 셀이 있음을 뜻하며 증거 손상 오류가 아닙니다. 구현이 바뀐 후에는 새 실행기로 재채점하지 말고 보존한 실행 원본을 사용하세요.

- Catalog SHA-256: `1288898be512fc016d607cdcb870d895ed031c41f03377daadc28b0600ac9fd1`
- Implementation SHA-256: `30f3bf3b58ebd563827de6b1a351bc975b32fb5549911befeb9190fad62bdd96`
- Raw report SHA-256: `1b97ba07c86118b56af45c732956ce03439e9a0a603ca4d816dca5c455f554c3`
- [Raw evidence manifest](evidence-manifest.json) · [Frozen source manifest](source-manifest.json) · [최종 검사 기록](final-audit.json)

과거 [core-10의 57/70](../2026-09-21/README_KO.md)과 로컬 v3의 86/126 기록은 보존했습니다. 서로 다른 계약이므로 v4 성적에 합산하거나 통과율 개선 폭으로 직접 비교하지 않습니다.
