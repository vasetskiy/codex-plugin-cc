# AGENTS.md

## Product Goal

This repository packages the Codex plugin for Claude Code. The shipped plugin lives under
`plugins/codex` and provides slash commands for Codex code review, adversarial review,
plan review, rescue tasks, status, results, cancellation, and setup.

The current product goal is to keep the plugin reliable as a Claude Code package while
making `/codex:plan-review` useful as a structured, read-only readiness reviewer for
implementation plans.

## Source Of Truth

Prefer sources in this order:

1. Explicit instructions in the current chat.
2. Current code and tests in this repository.
3. This file and repo-local Codex surfaces under `.codex`.
4. User-facing product docs: `README.md` and `plugins/codex/PLAN_REVIEW.md`.
5. Active design notes: `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md`.
6. Version and release metadata: `package.json`, `package-lock.json`,
   `plugins/codex/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
   and `plugins/codex/CHANGELOG.md`.
7. Historical reviews, audits, external comparison notes, and handoff notes.

When docs and code disagree, verify against current code and tests before making changes.

## Package Boundary

Keep a hard boundary between repo development environment files and shipped plugin files.

- `AGENTS.md`, `.codex/config.toml`, and `.codex/agents/*` are repo-local working
  surfaces for maintainers and Codex. They are not part of the shipped plugin package.
- `plugins/codex/**` is the shipped plugin package.
- `plugins/codex/skills/**` are shipped plugin skills for plugin users. Do not use
  them as project memory or maintainer-only scratch space.
- `plugins/codex/agents/codex-rescue.md` is a shipped thin forwarder to the Codex
  companion runtime. Do not turn it into a researcher, reviewer, or maintainer agent.
- Generated app-server types belong under `plugins/codex/.generated/` and are ignored.

## Active Docs

Start here when changing behavior:

- `README.md`: user-facing plugin overview, installation, and command UX.
- `plugins/codex/PLAN_REVIEW.md`: user-facing `/codex:plan-review` contract.
- `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md`: current design rationale for
  plan review.
- `plugins/codex/scripts/lib/plan-review.mjs`: path resolution, seed context,
  prompt assembly, validation, and policy audit helpers.
- `plugins/codex/prompts/plan-review.md`: model instructions for plan review.
- `tests/plan-review.test.mjs`: plan-review behavior and invariants.

## Commands

Use these from the repository root:

- `node --test tests/*.test.mjs`: full local test suite without npm indirection.
- `npm test`: same test suite through `package.json`.
- `npm run check-version`: verifies version metadata across package, lockfile,
  plugin manifest, and marketplace metadata.
- `npm run build`: runs `prebuild` first, then TypeScript build. `prebuild` invokes
  `codex app-server generate-ts --out plugins/codex/.generated/app-server-types`,
  so this requires a working Codex CLI with app-server support.

If `npm run build` fails because Codex CLI or app-server generation is unavailable in
the environment, report that directly and do not fake generated files.

## Versioning

Use `npm run bump-version -- <version>` to update version metadata. The script updates:

- `package.json`
- `package-lock.json`
- `plugins/codex/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

After any version-related change, run `npm run check-version`.

## Plan Review Risk Areas

Recent review work identified these `/codex:plan-review` gaps compared with the
`shift-happens` review flow. Treat them as known risk areas, not as implemented
requirements:

- The command is not replacement-ready for the `shift-happens` review flow.
- There is no deterministic pre-sweep of known implementation touchpoints.
- Adjacent project context is exposed as candidates, not hard-attached context.
- There is no readiness gate, verdict-application flow, or two-green convergence loop.
- There is no plan-review resume mode.
- Read-only enforcement is partly post-hoc: the runtime audits command executions and
  file changes after the model run.
- Historical artifact exclusion is enforced by prompt and seed metadata, not by a hard
  filesystem filter.

Do not implement future architecture just because it appears in the risk list. Match the
current task scope and update docs/tests with any behavior change.

## Working Rules

- Start substantial work with `git status --short --branch`.
- Preserve unrelated user changes.
- Keep edits narrowly scoped to the requested area.
- Prefer `rg` and focused file reads for exploration.
- Do not push to the upstream main branch that this work was forked from. Push
  only to the fork.
- Do not create draft pull requests. Open normal pull requests so the user can
  review and merge them manually.
- Keep maintainer-only guidance in root repo surfaces, not in shipped plugin assets.
- Do not edit sibling repositories from this working tree. Read adjacent projects only
  when a task explicitly requires comparison or evidence.
