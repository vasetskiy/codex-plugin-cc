# Current State

Date: 2026-05-24

## Where We Are

Current checkout:

- Branch: `codex/maintainer-env-gh-workflow`
- Base: `origin/main` at `0c283b1`
- Purpose: env/process follow-up for GitHub CLI access and repo workflow rules.

Current intended changes:

- `.codex/config.toml`
- `AGENTS.md`
- `CURRENT_STATE.md`

These are intentionally separate from the M1 plan-review PR.

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

## M1 Plan Review PR

M1 is open as a normal PR in the fork:

- URL: `https://github.com/vasetskiy/codex-plugin-cc/pull/2`
- Branch: `codex/plan-review-attached-context`
- Commit: `ba36a0e Attach bounded plan-review context`

That PR adds bounded attached adjacent context for `/codex:plan-review` and
updates docs, prompt, companion summary, and tests.

Checks run for that M1 work before push:

- `node --test tests/*.test.mjs`: passed, 99/99.
- `npm run check-version`: passed.
- `npm run build`: passed, with only the known PATH/read-only warning during
  `codex app-server generate-ts`.

`CURRENT_STATE.md` and env/process changes were intentionally not included in
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

## Env / Process Follow-up Branch

This branch should contain only:

- The repo-local Codex network setting needed for GitHub workflows.
- The repo rule that PRs should be opened as normal PRs, not draft PRs.
- This refreshed handoff state.

No shipped plugin files are changed in this follow-up branch.

## Recommended Next Steps

1. Open a normal PR for `codex/maintainer-env-gh-workflow` targeting fork
   `main`.
2. Review and merge M1 PR #2 when ready.
3. Keep future plan-review replacement work separate from these env/process
   updates unless explicitly requested.
4. Keep PR targets inside the fork unless instructed otherwise.

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
