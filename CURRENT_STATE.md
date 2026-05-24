# Current State

Date: 2026-05-23

## Where We Stopped

M0 for the `codex-cc` development environment is implemented in root repo
surfaces. The app-server build blocker from the generated protocol contract was
also fixed with the smallest runtime compatibility change.

Added root environment files:

- `AGENTS.md`
- `.codex/config.toml`
- `.codex/agents/plan-review-readonly-auditor.md`
- `.codex/agents/command-contract-reviewer.md`
- `.codex/agents/plugin-runtime-maintainer.md`
- `.codex/agents/shift-happens-flow-comparator.md`

The new root guidance captures:

- source-of-truth order
- package boundary between root maintainer surfaces and shipped plugin files
- active docs and code surfaces
- command/test matrix
- versioning rules
- known `/codex:plan-review` risk areas from the external review note

Runtime/test changes:

- `plugins/codex/scripts/lib/app-server.mjs`: default initialize capabilities now
  include `requestAttestation: false`, matching the generated
  `InitializeCapabilities` contract without opting into attestation requests.
- `tests/runtime.test.mjs`: setup coverage asserts the default app-server
  initialize payload keeps `requestAttestation` disabled.

## Verification Run

Commands run from `/home/vasetskiy/work/codex-cc`:

- `node --test tests/*.test.mjs`: passed, 98/98.
- `npm run check-version`: passed, all version metadata matches `1.0.4`.
- `npm ci`: run in the previous pass because the first build attempt failed with
  `tsc: not found`.
- `npm run build`: passed after the `requestAttestation: false` compatibility fix.

## Worktree State

At the time this state file was updated, expected tracked modifications are:

- `plugins/codex/scripts/lib/app-server.mjs`
- `tests/runtime.test.mjs`

Expected untracked files are:

- `.codex/`
- `AGENTS.md`
- `CURRENT_STATE.md`

`node_modules/` and `plugins/codex/.generated/` may exist locally after
verification, but they are ignored by git.

## Next Steps

1. Review whether to commit the M0 repo-environment files and the app-server
   capability compatibility fix together or split them into separate commits.
2. If splitting commits, keep root maintainer surfaces separate from shipped
   plugin runtime/test changes.
3. No known local verification blocker remains after the latest run.

## Constraints To Preserve

- Do not use `plugins/codex/skills` as project memory; those are shipped plugin
  skills.
- Do not turn `plugins/codex/agents/codex-rescue.md` into a researcher or
  reviewer; it is a shipped thin forwarder.
- Do not edit adjacent projects such as `/home/vasetskiy/work/shift-happens`
  from this repository.
- Keep future plan-review replacement work separate from this M0 environment
  setup unless explicitly requested.
