# Plan Review Readiness Gate Design

## Goal

Add a deterministic, read-only readiness gate to `/codex:plan-review` so users can tell whether a reviewed plan is implementable, needs plan edits, or is blocked by validation/policy failure without relying on model prose or manual checkbox stamping.

## Context

The current plan-review command already returns structured JSON with:

- `verdict`
- `findings`
- `findings[].readiness_effect`
- `findings[].requires_re_review`
- `requires_verify[].blocks_approval`
- `coverage`
- `residual_risks`

The companion also validates the model output, audits read-only policy violations, and stores runtime metadata. This is stronger than the `shift-happens` markdown-only review artifact model, where wrappers write `## Verdicts` and `## Readiness Gate` blocks after applying findings.

The plugin should borrow the useful part of `shift-happens`: readiness is a separate gate from severity, and re-review is a separate signal from "how serious is this". It should not copy the `reviewN.md`, automatic verdict application, two-green loop, or fixed project layout.

## Design

Add a companion-owned readiness derivation step after parse, validation, and policy audit:

```text
derivePlanReviewReadiness({ parsed, validation, policyViolation })
```

The derivation is deterministic and does not call the model. It produces a runtime-owned `readiness` object stored in the plan-review payload and rendered in markdown.

Suggested shape:

```json
{
  "schema_version": "plan-review-readiness/v1",
  "status": "ready",
  "implementation_allowed": true,
  "requires_re_review": false,
  "next_action": "start-implementation",
  "reasons": []
}
```

Allowed statuses:

- `ready`: valid `approve`, no findings, no blocking verify, no policy failure.
- `ready-with-implementation-notes`: no blocking findings, but some findings are explicitly `can-fix-during-implementation` and do not require re-review.
- `revise-before-start`: plan is structurally reviewable, but at least one finding should be fixed before implementation or any finding requires re-review.
- `blocked`: at least one finding blocks implementation or a blocking verify question remains.
- `invalid-result`: Codex returned unparsable or schema-invalid output.
- `policy-failed`: Codex violated the read-only policy.

Suggested `next_action` values:

- `start-implementation`
- `carry-notes-into-implementation`
- `edit-plan`
- `edit-plan-and-rerun-review`
- `answer-blocking-verification`
- `inspect-policy-failure`
- `rerun-plan-review`

The readiness object should include compact `reasons` that point at finding indexes, blocking verify indexes, validation errors, or policy violations. It should not duplicate full finding bodies.

## Application Guidance

The renderer should add a short readiness block immediately after `Verdict`.

For findings, the detail section should include a derived action:

- `blocks-implementation` -> edit the plan before implementation.
- `should-fix-before-start` -> edit or clarify the plan before implementation.
- `can-fix-during-implementation` with `requires_re_review: false` -> carry into implementation.
- any `requires_re_review: true` -> rerun plan-review after the plan edit.

This is guidance only. `/codex:plan-review` remains read-only and does not edit plan files.

## Non-Goals

- No automatic plan edits.
- No durable `reviewN.md` output.
- No two-green convergence loop.
- No `## Verdicts` or `## Readiness Gate` markdown block contract.
- No fixed `projects/<queue>/<slug>` assumptions.
- No new slash command in this slice.

## Files

Expected implementation files:

- `plugins/codex/scripts/lib/plan-review.mjs`: derive and export readiness helper.
- `plugins/codex/scripts/codex-companion.mjs`: store readiness in plan-review payload.
- `plugins/codex/scripts/lib/render.mjs`: render readiness and derived finding actions.
- `plugins/codex/schemas/plan-review-output.schema.json`: no change expected; readiness is runtime-owned.
- `plugins/codex/PLAN_REVIEW.md`: document readiness statuses.
- `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md`: update active design notes.
- `README.md`: short user-facing mention.
- Tests under `tests/plan-review.test.mjs`, `tests/render.test.mjs`, and `tests/runtime.test.mjs`.

## Testing

Use TDD. Add focused tests before implementation:

- readiness derivation for valid approve result.
- policy violation returns `policy-failed`.
- parse/validation failure returns `invalid-result`.
- blocking finding returns `blocked`.
- `should-fix-before-start` or `requires_re_review` finding returns `revise-before-start`.
- only `can-fix-during-implementation` findings with no re-review trigger returns `ready-with-implementation-notes`.
- blocking `requires_verify` returns `blocked`.
- rendered markdown includes readiness status, implementation allowed, next action, and per-finding derived action.
- runtime JSON stores `readiness`.

## Success Criteria

- Existing `/codex:plan-review` behavior stays read-only.
- Existing output schema remains model-owned; readiness is companion-owned runtime metadata.
- The markdown result gives a clear implementation gate without requiring the user to infer from multiple sections.
- Invalid JSON, schema-invalid JSON, and policy violations cannot render as implementation-ready.
- `npm test`, `npm run check-version`, and `npm run build` pass, subject to the known Codex app-server generation environment requirement.
