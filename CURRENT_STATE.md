# Current State

Date: 2026-05-24

## Where We Are

Current checkout:

- Branch: `codex/plan-review-readiness-gate`
- Upstream/base: `origin/main`
- Base HEAD: `92ae000 Merge pull request #4 from vasetskiy/codex/plan-review-touchpoint-presweep`
- Latest product/design commit before this refresh: `9e57180 docs: add plan review readiness gate design`
- Worktree: clean after committing this current-state refresh

The fork `main` now includes the base maintainer environment work, M1
plan-review attached context work, the env/process GitHub workflow follow-up,
and the deterministic touchpoint pre-sweep increment.

The active branch starts the next `/codex:plan-review` product increment:
deterministic read-only readiness derivation and renderer/docs/tests around the
existing structured plan-review result. No shipped plugin behavior has been
implemented yet on this branch.

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

## Readiness Gate Design Work

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

No implementation code has been changed yet for this increment.

## Next Session Start Here

1. Stay on branch `codex/plan-review-readiness-gate`.
2. Read `AGENTS.md`, this `CURRENT_STATE.md`,
   `plugins/codex/PLAN_REVIEW.md`,
   `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md`, and
   `docs/superpowers/specs/2026-05-24-plan-review-readiness-gate-design.md`.
3. Write the implementation plan for the readiness derivation slice.
4. Execute with TDD:
   - failing tests first in `tests/plan-review.test.mjs`,
     `tests/render.test.mjs`, and `tests/runtime.test.mjs`;
   - then implement in `plugins/codex/scripts/lib/plan-review.mjs`,
     `plugins/codex/scripts/lib/render.mjs`, and
     `plugins/codex/scripts/codex-companion.mjs`;
   - then update `README.md`, `plugins/codex/PLAN_REVIEW.md`, and
     `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md`.
5. Preserve the model-owned `plan-review-output/v1` schema unless implementation
   proves a schema change is necessary. The readiness block should be
   companion-owned runtime metadata.
6. Keep future plan-review replacement work separate from env/process updates
   unless explicitly requested.
7. Keep PR targets inside the fork unless instructed otherwise.

## Validation Status

No validation commands were run after the design-only commit or this
current-state refresh.

Before opening a PR for the readiness-gate implementation, run:

- `node --test tests/*.test.mjs`
- `npm run check-version`
- `npm run build`

If `npm run build` fails because Codex CLI or app-server generation is
unavailable in the environment, report that directly and do not fake generated
files.

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
