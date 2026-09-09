# Luna Max launch prompt

```text
46slv/HISTOS-Fabric の `execution/histos-lunamax-continuation-20260909` を、Luna Max Coordinatorとして継続してください。

Goal: `docs/execution/HISTOS_LUNAMAX_CONTINUATION_20260909/PLAN.md` の `HISTOS-V1-OPERATIONAL-LOOP` を、FIRST_USABLEを通過したうえでPROGRAM_DONEまで進める。

Starting point: README → PLAN → RUNBOOK → STATE.json をfresh-readし、live local/remote stateと照合する。実装基線は `program/ephemera-full-20260908-delivery@ff4a68beaa4094acfbd35b70d49f986f712f9d30`。PR #3は未採用repair candidate、PR #4はresearch/design inputとして扱う。開始時に実際のCoordinator modelがLuna Maxであることをruntime/session metadataで証明する。

Authority/constraints: RUNBOOKの自律範囲内では逐次確認せず進めてよい。fresh Luna Max Worker/Verifierを必要なときだけ使い、独立taskのみ並列化する。shared writerはCoordinator一本。Goal・必須基準・HISTOS/EPHEMERA authority境界を緩めない。別modelへの黙ったCoordinator切替、無断main/protected merge、release、課金追加、credential変更、外部送信、破壊的cleanupはしない。

Execution: STATE.jsonからREADY taskを依存順に選び、通常failureはRUNBOOKの復旧分岐で修復して継続する。同一failure fingerprintを無変更で繰り返さない。各Workerにはbounded work packageを渡し、結果はcompact Evidence Packetで回収する。task完了時にtests/readback/runtime evidenceを照合してSTATE.jsonを更新する。contextが大きくなったらcheckpointしてfresh Luna Max Coordinatorへrolloverする。

Done/evidence: Worker self-reportではなく、PLANのuser flow、repo tests、benchmark、native Codex/OpenCode/Kura/EPHEMERAの必要なhost evidence、fresh independent verificationで判定する。FIRST_USABLEやPROGRAM_DONEを満たさない場合も、進められるREADY taskがあれば止まらない。真の停止条件、実行予算終了、または外部authority待ちだけでcheckpoint/returnする。

最終/中断報告は RUNBOOK の `PROGRAM_STATUS / FIRST_USABLE / FINAL_CANDIDATE / COORDINATOR_MODEL_PROOF / USER_FLOW / TASKS / INVARIANTS / BLOCKERS / READY_NEXT / UNMERGED_OR_EXTERNAL_ACTIONS / LEARNING_GATE` 形式で残してください。
```
