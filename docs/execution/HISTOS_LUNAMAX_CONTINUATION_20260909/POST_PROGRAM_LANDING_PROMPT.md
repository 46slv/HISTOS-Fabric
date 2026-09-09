# HISTOS post-PROGRAM_DONE landing prompt

Use after `HISTOS-V1-OPERATIONAL-LOOP` reports `PROGRAM_STATUS=PROGRAM_DONE` and before any protected-branch merge or release.

```text
46slv/HISTOS-Fabric の HISTOS-V1-OPERATIONAL-LOOP 完了候補を、Luna Max Coordinatorとして remote landing / acceptance まで進めてください。

Reported local identities:
- FINAL_CANDIDATE: daa65fefa1e4b0222356e664556d87e3f8bf4d14
- STATE-only checkpoint HEAD: 639fc5769abeb2db5f7193615bab1f54a2004f55
- reported PROGRAM_STATUS: PROGRAM_DONE
- reported FIRST_USABLE: PASS
- reported final regression: npm test 162/162

最初にこの報告を信用せず、local Git object / worktree / STATE / receipts をfresh-readして exact identity と ancestry を再証明する。開始時にCoordinatorが実際に Luna Max (`gpt-5.6-luna`, reasoning=max 相当) であることをruntime/session metadataで証明する。自己申告やprompt文字列だけをmodel proofにしない。

Goal:
完成候補を失わず、非protected remote refへ固定し、remote exact SHAで再検証可能なDraft PR / acceptance surfaceを作り、旧PR/branch/documentationとの関係を整理する。実装を再設計しない。PROGRAM_DONE後の新機能開発を始めない。

Execution order:
1. local preflight
   - `daa65f...` と `639fc...` が存在するか確認。
   -両SHAのparent/tree関係、current branch、dirty/untracked state、STATE.json、最終receipt/hashをreadbackする。
   - `639fc...` が実装候補にSTATEだけを追加したcheckpointなら、その関係を明記する。そうでなければ勝手に推定せず原因を解決する。
   - dirty worktreeを消さない。最終候補に必要な未コミット成果があれば、内容/owner/evidenceを確認して安全にcheckpointする。

2. exact candidate requalification
   - exact candidate/checkpointからfresh worktreeで repository-wide regression を再実行する。
   - 少なくとも `npm test`、最終user-flow verifier、H01 benchmark/readback、必要なnative-boundary evidenceのidentity/readbackを確認する。
   - 以前の162/162やreceiptを再利用する場合も、どのexact SHAに結び付くかを明示する。
   - Codex/OpenCode/Kura/EPHEMERA host evidenceは、再実行が必要なものとimmutable receipt readbackで足りるものを区別する。ambient Codex config driftは別事象として記録し、candidate failureと混同しない。

3. remote preservation
   - existing remote feature branchがlocal candidateのancestorなら fast-forward pushする。
   - diverged/unknownならforce-pushしない。新しい非protected landing branchを exact verified checkpointから作ってpushする。
   - push後、GitHubからremote head SHA/treeをreadbackし、local verified SHAと一致することを確認する。
   - secrets、private temp receipts、machine-specific paths/transcriptsを誤ってpushしない。

4. Draft PR / acceptance surface
   - exact remote candidateを指すDraft PRを作るか、既存の正しいDraft PRを更新する。
   - PR bodyには PROGRAM_DONE / FIRST_USABLE / exact candidate/checkpoint / Luna Max proof / 162/162 / user-flow criteria / H01 metrics / native Codex+OpenCode / Kura read-only / EPHEMERA authority boundary / known ambient drift / unrun or external gates を分けて記録する。
   - local-only pathを唯一の証拠にしない。共有すべきreceiptは秘密/機械固有情報を除去してrepoまたはPRから辿れる形にする。

5. lineage reconciliation
   - PR #1/#2/#3/#4/#5 と program/ephemera-full-20260908-delivery の関係をfresh-checkする。
   - superseded / incorporated / still-independent / historical を明示する。
   - 旧PRを閉じる必要がある場合は、失われるreview surfaceがないことを確認してから行う。判断が曖昧ならDraftのまま残して関係だけ記録する。
   - documentation statusが実装実態より古い場合、IMPLEMENTED / EXPERIMENTAL / ACCEPTED DESIGN / RESEARCH を混同しないよう更新する。

6. remote independent acceptance
   - remote exact SHAを対象にfresh independent verifierを使う。
   - verifierはWorker/Coordinatorのself-reportを合格根拠にしない。
   - code/test/docs/receipts/authority boundary/secret leakage/branch identityを検査する。
   - remote verification PASSなら `REMOTE_CANDIDATE_ACCEPTED` と記録する。これはmain mergeやreleaseと同義ではない。

Authority:
- 非protected branchへの通常push、Draft PR作成/更新、repo内docs/evidenceの非秘密な整理、tests/bench/native read-only verificationは進めてよい。
- force-push、main/protected merge、release/tag/package publish、credential/permission変更、課金追加、外部メッセージ送信、秘密/個人データ公開、破壊的cleanupは行わない。
- mainへ入れる最終mergeはこのrunの停止点。merge直前まで準備し、exact merge candidate / checks / residual risks / superseded PRsを報告する。

Failure handling:
- 普通のtest failure、stale receipt、branch divergence、docs drift、PR conflictは修復して続行する。
- 同一failure fingerprintを無変更で繰り返さない。
- candidate identityを変える修正が必要になった場合は新SHAとして扱い、影響範囲のtests/receiptsを再資格化する。古いPROGRAM_DONEをそのまま新SHAへ転用しない。
- 本当に外部authorityが必要、secret公開なしでは進めない、protected mergeのみ残った、またはverified candidateを再現不能な場合だけ停止する。

Finish condition:
- verified local candidateが非protected remote SHAとして固定されている。
- remote head/tree readback一致。
- Draft PR/acceptance surfaceがexact SHAを指す。
- remote exact SHAに対するfresh independent verificationがPASS。
- old PR/branch/docs lineageが整理されている。
- main/protected merge以外に進められるlanding taskが残っていない。

最終報告:
LANDING_STATUS
LOCAL_FINAL_CANDIDATE
REMOTE_CANDIDATE
REMOTE_TREE
COORDINATOR_MODEL_PROOF
REGRESSION
USER_FLOW
NATIVE_EVIDENCE
AUTHORITY_INVARIANTS
PR_ACCEPTANCE_SURFACE
SUPERSEDED_OR_RETAINED_LINES
AMBIENT_DRIFT
BLOCKERS
READY_FOR_PROTECTED_MERGE
UNMERGED_OR_EXTERNAL_ACTIONS
LEARNING_GATE
```
