# Current State

Date: 2026-05-24

## Where We Are

Current checkout:

- Branch: `codex/plan-review-readiness-gate`
- Upstream: `origin/codex/plan-review-readiness-gate`
- Base: `origin/main`
- Base HEAD: `92ae000 Merge pull request #4 from vasetskiy/codex/plan-review-touchpoint-presweep`
- Latest product commit: `0abd81f Add plan-review readiness gate`
- Open PR: `https://github.com/vasetskiy/codex-plugin-cc/pull/6`
- Worktree: clean after the current-state/session-cleanup refresh is committed
  and pushed

The fork `main` now includes the base maintainer environment work, M1
plan-review attached context work, the env/process GitHub workflow follow-up,
and the deterministic touchpoint pre-sweep increment.

The active branch now contains the committed `/codex:plan-review`
readiness-gate implementation and an open normal PR against fork `main`. The
implementation adds deterministic companion-owned readiness derivation, runtime
payload storage, markdown rendering, derived finding actions, docs, and tests.
The model-owned `plan-review-output/v1` schema remains unchanged.

## Completed Base Work

PR #1 in the fork was merged into `vasetskiy/codex-plugin-cc:main`.

- URL: `https://github.com/vasetskiy/codex-plugin-cc/pull/1`
- Merge commit: `0c283b1`
- Base/head: `main <- maintainer-env-app-server-capabilities`

The merge included:

- `d3152ae Add Codex maintainer environment`
- `37832be Fix app-server initialize capabilities`

Checks before PR #1:

- `node --test tests/*.test.mjs`: passed, 98/98.
- `npm run check-version`: passed, version metadata matched `1.0.4`.
- `npm run build`: passed.

## M1 Plan Review Work

PR #2 in the fork was merged into `vasetskiy/codex-plugin-cc:main`.

- URL: `https://github.com/vasetskiy/codex-plugin-cc/pull/2`
- Merge commit: `1d5678b`
- Branch: `codex/plan-review-attached-context`
- Commit: `ba36a0e Attach bounded plan-review context`

The PR added bounded attached adjacent context for `/codex:plan-review` and
updated docs, prompt, companion summary, and tests.

Checks run for that M1 work before push:

- `node --test tests/*.test.mjs`: passed, 99/99.
- `npm run check-version`: passed.
- `npm run build`: passed, with only the known PATH/read-only warning during
  `codex app-server generate-ts`.

`CURRENT_STATE.md` and env/process changes were intentionally kept separate from
the M1 commit.

## GitHub CLI / Env Fix

`gh` failed inside Codex because the neighboring Claude session used the system
keyring, while Codex's sandboxed `gh` saw `~/.config/gh/hosts.yml` without a
usable token and repo config had network disabled.

Fixed in the maintainer environment:

- Copied the working GitHub keyring token into `~/.config/gh/hosts.yml` using
  `gh auth login --with-token --insecure-storage`.
- Updated `.codex/config.toml` to set `[sandbox_workspace_write].network_access`
  to `true`, so Codex sessions can use normal `gh` network access.

Verified in that Codex session:

- `gh auth status -h github.com`: OK, token read from `hosts.yml`.
- `gh api user --jq .login`: OK, returned `vasetskiy`.

## Env / Process Follow-up

PR #3 in the fork was merged into `vasetskiy/codex-plugin-cc:main`.

- URL: `https://github.com/vasetskiy/codex-plugin-cc/pull/3`
- Merge commit: `14e09d9`
- Branch: `codex/maintainer-env-gh-workflow`
- Commits:
  - `0da07c7 Document maintainer GitHub workflow`
  - `581b3ff Update current state with env workflow PR`

The PR contained only:

- The repo-local Codex network setting needed for GitHub workflows.
- The repo rule that PRs should be opened as normal PRs, not draft PRs.
- The refreshed handoff state.

No shipped plugin files changed in this follow-up.

## Touchpoint Pre-sweep Work

PR #4 in the fork was merged into `vasetskiy/codex-plugin-cc:main`.

- URL: `https://github.com/vasetskiy/codex-plugin-cc/pull/4`
- Merge commit: `92ae000`
- Branch: `codex/plan-review-touchpoint-presweep`
- Commit: `346551c Add plan-review touchpoint pre-sweep`

The PR added deterministic extraction of path-like implementation touchpoints
from `/codex:plan-review` plan text. Existing text touchpoints are attached as
bounded line-indexed context, and missing/non-file/binary/outside-repo
touchpoints are exposed as seed metadata instead of being read.

Checks run for that work before PR:

- `node --test tests/*.test.mjs`: passed, 100/100.
- `npm run check-version`: passed.
- `npm run build`: passed, with only the known PATH/read-only warning during
  `codex app-server generate-ts`.

## Readiness Gate Work

Current active branch: `codex/plan-review-readiness-gate`.

Design-only commit already created:

- `9e57180 docs: add plan review readiness gate design`

Design spec:

- `docs/superpowers/specs/2026-05-24-plan-review-readiness-gate-design.md`

Decision from comparison with `/home/vasetskiy/work/shift-happens`:

- Borrow the useful semantics: readiness is a separate gate from severity, and
  re-review is a separate signal from severity.
- Do not copy the `shift-happens` `reviewN.md`, automatic verdict application,
  two-green loop, fixed project layout, or manual checkbox stamping.
- Implement a deterministic companion-owned `readiness` derivation from the
  existing structured plan-review result, validation result, and policy audit.
- Keep `/codex:plan-review` read-only.

Implementation committed and pushed:

- PR: `https://github.com/vasetskiy/codex-plugin-cc/pull/6`
- Product commit: `0abd81f Add plan-review readiness gate`
- Current-state/session-cleanup refresh: committed and pushed after the product
  commit

- Added `derivePlanReviewReadiness` in
  `plugins/codex/scripts/lib/plan-review.mjs`.
- Stored readiness in the plan-review runtime payload in
  `plugins/codex/scripts/codex-companion.mjs`.
- Rendered readiness status, implementation allowance, next action, and
  per-finding derived actions in `plugins/codex/scripts/lib/render.mjs`.
- Updated tests in `tests/plan-review.test.mjs`, `tests/render.test.mjs`, and
  `tests/runtime.test.mjs`.
- Updated user-facing docs in `README.md`, `plugins/codex/PLAN_REVIEW.md`, and
  `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md`.
- Saved and executed the implementation plan:
  `docs/superpowers/plans/2026-05-24-plan-review-readiness-gate.md`.

## Next Session Start Here

1. Stay on branch `codex/plan-review-readiness-gate`.
2. Inspect PR #6:
   `https://github.com/vasetskiy/codex-plugin-cc/pull/6`.
3. If PR #6 is merged, sync local `main` with `origin/main`, rerun the standard
   validation, and refresh this file to the merged state.
4. After merge/sync, delete the feature branch locally/remotely if no follow-up
   work is needed.
5. Keep future plan-review replacement work separate from env/process updates
   unless explicitly requested.
6. Keep PR targets inside the fork unless instructed otherwise.

## Validation Status

Latest validation before opening PR #6:

- `node --test tests/plan-review.test.mjs tests/render.test.mjs`: passed, 15/15.
- `node --test --test-name-pattern "plan-review runs a read-only structured review|plan-review fails with preserved diagnostics" tests/runtime.test.mjs`: passed, 2 matched tests.
- `node --test tests/*.test.mjs`: passed, 104/104.
- `npm run check-version`: passed, version metadata matched `1.0.4`.
- `git diff --check`: passed.
- `npm run build`: passed, with only the known PATH/read-only warning during
  `codex app-server generate-ts`.

If additional code/docs/test edits happen after this current-state refresh,
rerun the relevant tests and the full validation set above.

## Session Cleanup Notes

- Normal PR #6 is open; no draft conversion is needed.
- This checkout is a normal repository checkout, not a linked worktree, so there
  is no worktree directory to remove.
- Leave the branch checked out for PR iteration. After PR #6 is merged, sync
  `main`, refresh this file again, then remove the feature branch if desired.

## Constraints To Preserve

- Preserve unrelated user changes.
- Do not push to the upstream main branch that this work was forked from. Push
  only to the fork.
- Do not create draft pull requests. Open normal pull requests so the user can
  review and merge them manually.
- Keep maintainer-only guidance in root repo surfaces, not in shipped plugin
  assets.
- Do not use `plugins/codex/skills` as project memory; those are shipped plugin
  skills.
- Do not turn `plugins/codex/agents/codex-rescue.md` into a researcher or
  reviewer; it is a shipped thin forwarder.
- Do not edit adjacent projects such as `/home/vasetskiy/work/shift-happens`
  from this repository.
