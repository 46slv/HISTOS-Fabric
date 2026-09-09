# HISTOS × Codex live canary launch prompt

Supply the exact ChatGPT conversation URL only at runtime. Do not paste it into this tracked file.

```text
46slv/HISTOS-Fabric の `execution/histos-codex-live-canary-20260909` を Luna Max Coordinatorとして実行し、`docs/execution/HISTOS_CODEX_LIVE_CANARY_20260909/PLAN.md` の `HISTOS-CODEX-DAILY-CAPTURE-V11` を FIRST_USABLEで止めず PROGRAM_DONE まで進めてください。

開始時に README → PLAN → RUNBOOK → STATE.json をfresh-readし、local/remote repo、Codex runtime、HISTOS runtime、browser/ChatGPT Web Bridge capabilityをlive確認する。Coordinatorが実際に Luna Max であることをruntime/session metadataで証明する。

Exact ChatGPT targetは起動時に別途与えられるruntime-only設定であり、repo/commit/public receiptへURL、conversation ID、browser/session identifier、cookie、credential、private pathを保存しない。指定されたその1会話だけをtask-related Supervisor/verification surfaceとして使ってよい。他conversationへのfallbackは禁止。

R1で現状を実測してから不足だけ実装する。特にH02 telemetryをdurable Evidence persistenceと混同しない。通常Codex利用から Evidence Event を自動取得できない、永続化できない、doctor/readbackできない場合は、RUNBOOKのauthority内で最小のdurable store / capture adapter or launcher / doctorを実装・検証する。raw transcriptを取得して解決しない。

STATE.jsonのREADY taskを依存順に進め、普通のfailureは修復して継続する。同一failure fingerprintを無変更で繰り返さない。shared writerはCoordinator一本、独立probe/testだけfresh workerへ分離する。

PROGRAM_DONEには real Codex+HISTOS task、exact ChatGPT correlation、H02 usage、Evidence capture、restart-safe persistence、doctor、fresh Codex session readback、privacy/authority hardening、full regression、secret scan、remote exact-SHA independent verificationが必要。非protected branch push/PR更新まで進めてよいが main/protected mergeは行わない。

最終報告はPLAN末尾の固定fieldで残す。
```
