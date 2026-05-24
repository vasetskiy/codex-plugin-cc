# Current State

Date: 2026-05-24

## Where We Are

Current checkout:

- Branch: `main`
- Upstream: `origin/main`
- HEAD: `92ae000 Merge pull request #4 from vasetskiy/codex/plan-review-touchpoint-presweep`
- Worktree: clean after committing this current-state refresh

The fork `main` now includes the base environment work, M1 plan-review attached
context work, the env/process GitHub workflow follow-up, and the deterministic
touchpoint pre-sweep increment.

Local baseline verification after syncing `main` to PR #4:

- `node --test tests/*.test.mjs`: passed, 100/100.
- `npm run check-version`: passed, version metadata matched `1.0.4`.
- `npm run build`: passed, with only the known PATH/read-only warning during
  `codex app-server generate-ts`.

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
updates docs, prompt, companion summary, and tests.

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

Fixed during this session:

- Copied the working GitHub keyring token into `~/.config/gh/hosts.yml` using
  `gh auth login --with-token --insecure-storage`.
- Updated `.codex/config.toml` to set `[sandbox_workspace_write].network_access`
  to `true`, so Codex sessions can use normal `gh` network access.

Verified in the current Codex session:

- `gh auth status -h github.com`: OK, token read from `hosts.yml`.
- `gh api user --jq .login`: OK, returned `vasetskiy`.

## New Repo Rules Added

`AGENTS.md` now includes:

- Do not push to the upstream main branch that this work was forked from. Push
  only to the fork.
- Do not create draft pull requests. Open normal pull requests so the user can
  review and merge them manually.

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

## Recommended Next Steps

1. Start a fresh Codex session from clean `main`.
2. Read `AGENTS.md`, `CURRENT_STATE.md`, `plugins/codex/PLAN_REVIEW.md`, and
   `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md` before touching code.
3. Start the next `/codex:plan-review` product increment.
4. Preferred next branch: `codex/plan-review-readiness-gate`.
5. Preferred next scope: readiness gate and verdict-application flow, keeping
   plan review read-only.
6. Keep future plan-review replacement work separate from env/process
   updates unless explicitly requested.
7. Keep PR targets inside the fork unless instructed otherwise.

## Constraints To Preserve

- Preserve unrelated user changes.
- Do not push to the upstream main branch that this work was forked from. Push
  only to the fork.
- Do not use `plugins/codex/skills` as project memory; those are shipped plugin
  skills.
- Do not turn `plugins/codex/agents/codex-rescue.md` into a researcher or
  reviewer; it is a shipped thin forwarder.
- Do not edit adjacent projects such as `/home/vasetskiy/work/shift-happens`
  from this repository.
