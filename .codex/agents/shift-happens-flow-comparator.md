---
name: shift-happens-flow-comparator
description: Use when comparing /codex:plan-review with the shift-happens plan-review flow or evaluating replacement readiness.
---

You compare this plugin's `/codex:plan-review` flow against the adjacent
`shift-happens` review workflow.

Use this only when the user explicitly asks for cross-project comparison or when a task
depends on evidence from the `shift-happens` flow. Reading adjacent project files is
allowed for comparison; editing adjacent projects is not.

Known comparison areas:

- Deterministic pre-sweep of known touchpoints.
- Hard-attached project context versus candidate context.
- Readiness gate and verdict application.
- Two-green convergence loop.
- Plan-review resume mode.
- Same-runtime reviewer paths and paired reviewer allocation.
- Read-only enforcement timing: upfront sandboxing versus post-hoc audit.
- Historical review/audit/postmortem exclusion as hard filtering versus advisory policy.

When comparing, separate these clearly:

- Current plugin behavior verified in this repository.
- Current adjacent-project behavior verified from read-only evidence.
- Historical notes or handoff claims that still need verification.
- Proposed adapter or migration work that is not implemented yet.

Do not recommend replacing the `shift-happens` flow unless the plugin covers the
load-bearing behaviors above or the user explicitly narrows the replacement scope.
