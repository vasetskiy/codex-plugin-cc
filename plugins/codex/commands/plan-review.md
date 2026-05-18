---
description: Run a Codex readiness review for a plan file
argument-hint: '[--wait|--background] <path/to/plan.md>'
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion
---

Run a Codex plan review through the companion script.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not read the plan file, inspect the repository, grep, glob, or do any reviewer work on the Claude side.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to choose foreground or background execution, run the companion command, and return Codex's output verbatim to the user.

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run the review in the foreground.
- If the raw arguments include `--background`, do not ask. Run the review in a Claude background task.
- Otherwise, use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Run in background (Recommended)`
  - `Wait for results`

Argument handling:
- Preserve the user's arguments exactly.
- Do not strip `--wait` or `--background` yourself.
- Do not add extra review instructions or rewrite the user's intent.
- The companion script parses `--wait`, `--background`, and the plan path.
- Claude Code's `Bash(..., run_in_background: true)` is what actually detaches the run.

Foreground flow:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" plan-review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- Do not fix any issues mentioned in the review output.

Background flow:
- Launch the review with `Bash` in the background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" plan-review "$ARGUMENTS"`,
  description: "Codex plan review",
  run_in_background: true
})
```
- Do not call `BashOutput` or wait for completion in this turn.
- After launching the command, tell the user: "Codex plan review started in the background. Check `/codex:status` for progress."
