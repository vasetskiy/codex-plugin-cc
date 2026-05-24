# Codex Plan Review

`/codex:plan-review` asks Codex to review a plan file before implementation starts.

It is meant for implementation plans, migration plans, wave or phase plans, and other repo-local documents where the main question is: can this be implemented as written?

## When To Use It

Use plan review when you want a readiness check before coding:

- before starting a new implementation wave or migration slice
- after rewriting a plan based on review feedback
- before handing a plan to Claude or Codex for implementation
- when the plan may depend on current code, tests, docs, or repository guidance

Use `/codex:review` or `/codex:adversarial-review` for code changes. Use `/codex:plan-review` for a plan file.

## Command

```bash
/codex:plan-review [--wait|--background] <path/to/plan.md>
```

Examples:

```bash
/codex:plan-review docs/plans/wave-1/plan.md
/codex:plan-review --wait docs/plans/wave-1/plan.md
/codex:plan-review --background docs/plans/wave-1/plan.md
```

If neither `--wait` nor `--background` is provided, Claude Code asks once whether to wait for the result or run the review in the background.

The plan path must point to a text file inside the current git repository. Untracked plan files are supported.

If the path starts with `-`, pass `--` before the path:

```bash
/codex:plan-review -- --plan.md
```

## What Codex Checks

The review starts from a deterministic seed packet that includes:

- the exact plan text and line-indexed plan text
- the normalized repository path of the plan
- repository root, command cwd, branch, and short git status
- nearby guidance candidates such as `AGENTS.md`, `CLAUDE.md`, and `README.md`
- adjacent context candidates such as `state.md`, `current-state.md`, `CURRENT_STATE.md`, `decisions.md`, and nearby `plan.md`
- bounded line-indexed attached context for selected adjacent context files

Codex is instructed to build a claim and scope map before deciding readiness. It checks declared touchpoints, assumptions, verification gates, non-goals, deferred scope, and risk domains such as data loss, auth, migrations, concurrency, rollback, and UX.

Historical review, audit, and postmortem files are not read by default. Codex should only inspect them when the plan explicitly references them or imported/deferred scope cannot be checked otherwise.

## Output

The result is rendered as findings-first markdown.

Top-level fields include:

- `Verdict: approve` when there are no material findings and no blocking verification questions
- `Verdict: needs-attention` when the plan has a material readiness issue or a blocking verification question
- a short summary
- findings, sorted by severity
- required verification questions, when applicable
- coverage notes and residual risks

Each finding includes:

- severity
- readiness effect
- whether the plan edit requires re-review
- plan-file line location
- risk
- recommendation
- evidence
- options, when useful

Readiness effects are:

- `blocks-implementation`: the plan should not be implemented as written
- `should-fix-before-start`: the plan is close, but the issue should be corrected before coding
- `can-fix-during-implementation`: the issue is material but can be handled during implementation

## Read-Only Policy

Plan review is intentionally read-only.

Codex may inspect files and repository state. It must not:

- edit files
- apply patches
- run tests
- run builds
- run migrations
- run docker
- run linters or typecheckers
- run other QA or runtime validation commands

If a check matters, Codex should put it in the output as a suggested verification step instead of running it.

The companion script audits the run after Codex finishes. If Codex runs a forbidden command or changes files, the job is marked failed and the stored result includes policy violation diagnostics.

## Background Jobs

`/codex:plan-review --background <path>` starts a tracked review job. Use the normal job commands:

```bash
/codex:status
/codex:result
/codex:cancel
```

Status and result output label the job kind as `plan-review`, so plan reviews can be distinguished from code reviews and delegated tasks.

## Interpreting Re-Review

`Requires re-review: yes` means the finding changes the plan's implementation contract enough that the updated plan should be reviewed again before implementation.

`Requires re-review: no` means the fix can normally be made without another full plan-review pass, unless the edit expands scope or changes the implementation approach.

## Limitations

The MVP is a neutral readiness review. It does not support custom focus text, adversarial mode, or multiple plan files.

Use `/codex:adversarial-review` when you want a steerable challenge review of code changes.
