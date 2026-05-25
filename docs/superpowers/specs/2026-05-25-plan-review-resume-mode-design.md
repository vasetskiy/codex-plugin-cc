# Plan Review Resume Mode Design

## Goal

Add explicit resume support to `/codex:plan-review` so a user can rerun a structured readiness review against the current version of the same plan file while preserving the prior Codex thread context.

## Context

`/codex:plan-review` currently starts a new Codex app-server thread for each run. The companion stores enough runtime metadata to identify completed plan-review jobs: job kind, status, session id, thread id, turn id, normalized plan path, seed summary, parsed result, readiness, and policy audit.

`runAppServerTurn` already accepts `resumeThreadId` and resumes an app-server thread before starting a new turn. `/codex:rescue` already has the relevant session-scoped pattern: ignore jobs from other Claude sessions, reject resume while a matching job is active, and continue the stored thread.

The first slice should make resume explicit and narrow. It should not introduce implicit resume prompts, durable review artifacts, verdict application, or a convergence loop.

## User Contract

Add:

```text
/codex:plan-review --resume <path/to/plan.md>
```

The existing forms remain valid:

```text
/codex:plan-review <path/to/plan.md>
/codex:plan-review --wait <path/to/plan.md>
/codex:plan-review --background <path/to/plan.md>
```

`--resume` is a plan-review runtime flag, not text for the reviewer. It can be combined with `--wait` or `--background`.

When `--resume` is absent, the command starts a fresh plan-review thread. The slash-command wrapper keeps the existing foreground/background question behavior and does not ask whether to continue a previous review.

When `--resume` is present, the companion:

1. Resolves and validates the current plan path with the existing plan-review path checks.
2. Finds the newest finished `plan-review` job in the current Claude session for the same normalized plan path.
3. Rejects the run if a matching `plan-review` job in the current Claude session is `queued` or `running`.
4. Rebuilds a fresh seed from the current plan file.
5. Resumes the previous job's Codex thread id.
6. Starts a new structured, read-only plan-review turn using the existing `plan-review-output/v1` schema, validation, readiness derivation, renderer, and policy audit.
7. Stores the resumed run as a new tracked `plan-review` job.

If no matching finished job exists in the current session, the command fails with a clear message telling the user to run a fresh plan review first.

## Matching Rules

The match key is the seed's `normalized_plan_path`, not the raw argument string. This lets `docs/plan.md`, `./docs/plan.md`, and quoted raw slash-command arguments resolve to the same review target.

Only jobs visible to the current Claude session are considered when `CODEX_COMPANION_SESSION_ID` is set. If that env var is absent, preserve the current local behavior and consider all stored jobs for the repository.

A finished candidate must have:

- `kind: "plan-review"`
- `jobClass: "review"`
- `status` not equal to `queued` or `running`
- a non-empty `threadId`
- a stored normalized plan path matching the current seed

For compatibility, the matcher should read the normalized plan path from the stored job result at `result.plan.normalized_plan_path` when available, and fall back to the top-level job `targetLabel` only if needed.

## Thread Persistence

Fresh plan-review runs should start persistent app-server threads. Resumable jobs should not depend on ephemeral thread behavior.

Implementation should use the existing `runAppServerTurn` options:

- Fresh run: `persistThread: true`, with a concise plan-review thread name derived from the normalized plan path.
- Resumed run: `resumeThreadId: <candidate.threadId>`, with no new thread name.

The Codex sandbox remains `read-only` for both fresh and resumed runs.

## Runtime Metadata

Do not change the model-owned `plan-review-output/v1` schema.

Add companion-owned resume metadata to the stored plan-review runtime payload:

```json
{
  "runtime": {
    "resume": {
      "requested": true,
      "sourceJobId": "review-abc123",
      "sourceThreadId": "thr_previous",
      "sourceCompletedAt": "2026-05-25T12:00:00.000Z"
    }
  }
}
```

For non-resumed runs, store `requested: false` and set source fields to `null`.

The first slice should not change the markdown renderer just to announce resume. The rendered result remains the readiness review; auditability comes from the stored runtime JSON and normal job metadata.

## Command Wrapper

Update `plugins/codex/commands/plan-review.md` as a thin deterministic wrapper:

- argument hint includes `[--wait|--background] [--resume] <path/to/plan.md>`
- Claude-side wrapper still does not read the plan, inspect the repo, grep, glob, or review anything itself
- preserves `$ARGUMENTS` exactly
- keeps the current foreground/background selection behavior
- returns companion stdout verbatim

## Non-Goals

- No implicit AskUserQuestion resume UX like `/codex:rescue`.
- No automatic plan editing.
- No verdict application or two-green convergence loop.
- No durable `reviewN.md` or output file artifact.
- No change to `plan-review-output/v1`.
- No multi-plan or custom focus mode.

## Files

Expected implementation files:

- `plugins/codex/scripts/codex-companion.mjs`: parse `--resume`, resolve the matching plan-review job, pass `resumeThreadId`, persist resume metadata, and use persistent threads for fresh plan-review runs.
- `plugins/codex/scripts/lib/codex.mjs`: no change planned; existing `runAppServerTurn` resume and persistence options should be enough.
- `plugins/codex/scripts/lib/job-control.mjs`: no change planned; keep the first matcher near the plan-review command path unless implementation makes that boundary awkward.
- `plugins/codex/scripts/lib/render.mjs`: no change planned in the first slice.
- `plugins/codex/commands/plan-review.md`: user-facing slash-command contract.
- `plugins/codex/PLAN_REVIEW.md`: document explicit resume mode.
- `README.md`: short command summary update.
- `tests/runtime.test.mjs`: runtime behavior tests.
- `tests/commands.test.mjs`: wrapper contract tests.

## Testing

Use TDD. Add failing tests before implementation:

- `plan-review --resume resumes the latest finished review for the same plan in the current session`
- `plan-review --resume rejects when a matching plan-review job is still active`
- `plan-review --resume ignores finished reviews from other Claude sessions`
- `plan-review --resume ignores finished reviews for a different normalized plan path`
- `plan-review --resume fails clearly when no matching finished review exists`
- `plan-review fresh runs create persistent threads`
- command docs expose `--resume` while preserving the thin wrapper constraints

The successful resume test should assert that the fake app-server receives `thread/resume` for the previous thread id and that the new turn prompt contains a fresh seed from the current plan file.

## Success Criteria

- Existing fresh `/codex:plan-review` behavior remains read-only and schema-compatible.
- `--resume` starts a new tracked `plan-review` result instead of mutating the previous job.
- Resume is scoped to the same normalized plan path and current Claude session.
- Active matching review jobs prevent ambiguous resume.
- Fresh plan-review jobs are backed by persistent Codex threads.
- Stored runtime metadata makes resumed runs auditable.
- `node --test tests/*.test.mjs`, `npm run check-version`, and `npm run build` pass, subject to the known Codex app-server generation environment requirement.
