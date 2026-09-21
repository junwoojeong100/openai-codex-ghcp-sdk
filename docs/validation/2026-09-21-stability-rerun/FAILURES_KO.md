# 미통과 11건 — 새 실행 원본 판정

[결과 요약](README_KO.md) · [English](FAILURES.md) · [관측 JSON](failure-analysis.json)

아래 증상 분류는 사후 관측이며 원래 판정·원인 분류를 바꾸지 않습니다. 원본 경로는 `.runtime/stability-rerun-20260921/live/cases/<model>/<scenario>/`입니다. `oracle.json`, `observation.json`, `resources.json` 및 관측 JSON의 검증된 포인터로 확인할 수 있습니다. 원본 파일 해시는 [증거 목록](evidence-manifest.json)에 있습니다.

| 모델 | ID | 원래 상태 | 실패 검사 | 관측 사실 |
|---|---|---|---|---|
| claude-opus-5 | S01 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S01.once` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S02 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S02.once`, `S02.permutation` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S03 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S03.once`, `S03.reject` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S04 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S04.once`, `S04.retry` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S05 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S05.once` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S06 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S06.recovery`, `S06.deadline` | SDK 구조화 필터 신호: 2; upstream_content_filter responses=2; ACK-hold=1; fault=4078ms |
| claude-opus-5 | S07 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S07.loss`, `S07.isolation` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S08 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S08.recovery`, `S08.loss`, `S08.no-replay` | SDK 구조화 필터 신호: 2; upstream_content_filter responses=2 |
| claude-opus-5 | S09 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S09.recovery`, `S09.invalid-stream` | SDK 구조화 필터 신호: 2; upstream_content_filter responses=2 |
| claude-opus-5 | S10 | failed | `turns`, `transport-outcomes`, `final-values`, `readiness`, `S10.resume` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S11 | failed | `turns`, `transport-outcomes`, `readiness`, `S11.compaction`, `S11.repetition` | SDK 구조화 필터 신호: 1; upstream_content_filter responses=1; reads=[1,0,0,0,0,0] |

## 전체 행렬

P = passed, F = failed.

| Model | S01 | S02 | S03 | S04 | S05 | S06 | S07 | S08 | S09 | S10 | S11 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.6-sol | P | P | P | P | P | P | P | P | P | P | P |
| gpt-5.6-terra | P | P | P | P | P | P | P | P | P | P | P |
| gpt-5.6-luna | P | P | P | P | P | P | P | P | P | P | P |
| gpt-6-astra | P | P | P | P | P | P | P | P | P | P | P |
| claude-opus-5 | F | F | F | F | F | F | F | F | F | F | F |
| claude-sonnet-5 | P | P | P | P | P | P | P | P | P | P | P |
| claude-haiku-4.5 | P | P | P | P | P | P | P | P | P | P | P |
