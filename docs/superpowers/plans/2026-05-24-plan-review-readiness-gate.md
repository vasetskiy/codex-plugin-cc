# Plan Review Readiness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add companion-owned deterministic readiness metadata and markdown guidance to `/codex:plan-review`.

**Architecture:** Keep `plan-review-output/v1` model-owned and unchanged. Add a pure `derivePlanReviewReadiness({ parsed, validation, policyViolation })` helper in `plugins/codex/scripts/lib/plan-review.mjs`, store its output as top-level runtime payload metadata in `codex-companion.mjs`, and render it in `renderPlanReviewResult`.

**Tech Stack:** Node.js ESM, `node:test`, existing companion runtime, existing markdown renderer.

---

### Task 1: Pure Readiness Derivation

**Files:**
- Modify: `tests/plan-review.test.mjs`
- Modify: `plugins/codex/scripts/lib/plan-review.mjs`

- [x] **Step 1: Write failing derivation tests**

Add `derivePlanReviewReadiness` to the import list in `tests/plan-review.test.mjs`, then add focused tests after `validatePlanReviewResult enforces readiness invariants tied to the seed`:

```js
test("derivePlanReviewReadiness returns ready for a valid approval", () => {
  const repo = makeRepoWithPlan();
  const seed = collectPlanReviewSeedContext(repo, "projects/active/demo/plan/plan.md");
  const parsed = validResult(seed);
  const validation = validatePlanReviewResult(parsed, seed);

  assert.deepEqual(derivePlanReviewReadiness({ parsed, validation, policyViolation: { violated: false } }), {
    schema_version: "plan-review-readiness/v1",
    status: "ready",
    implementation_allowed: true,
    requires_re_review: false,
    next_action: "start-implementation",
    reasons: []
  });
});

test("derivePlanReviewReadiness gives policy and invalid results precedence", () => {
  assert.deepEqual(
    derivePlanReviewReadiness({
      parsed: null,
      validation: { ok: false, errors: ["not json"] },
      policyViolation: { violated: true, forbiddenCommands: [{ command: "npm test" }], fileChanges: [] }
    }),
    {
      schema_version: "plan-review-readiness/v1",
      status: "policy-failed",
      implementation_allowed: false,
      requires_re_review: false,
      next_action: "inspect-policy-failure",
      reasons: [{ type: "policy-violation", message: "Plan review violated the read-only policy." }]
    }
  );

  assert.deepEqual(
    derivePlanReviewReadiness({
      parsed: null,
      validation: { ok: false, errors: ["Expected schema_version `plan-review-output/v1`."] },
      policyViolation: { violated: false }
    }),
    {
      schema_version: "plan-review-readiness/v1",
      status: "invalid-result",
      implementation_allowed: false,
      requires_re_review: false,
      next_action: "rerun-plan-review",
      reasons: [
        {
          type: "validation-error",
          index: 0,
          message: "Expected schema_version `plan-review-output/v1`."
        }
      ]
    }
  );
});

test("derivePlanReviewReadiness maps findings and blocking verification to gate statuses", () => {
  const repo = makeRepoWithPlan();
  const seed = collectPlanReviewSeedContext(repo, "projects/active/demo/plan/plan.md");
  const blockingFinding = {
    severity: "high",
    readiness_effect: "blocks-implementation",
    requires_re_review: true,
    title: "Missing migration order",
    plan_file: seed.normalized_plan_path,
    line_start: 1,
    line_end: 1,
    evidence: [{ type: "plan", path: seed.normalized_plan_path, line_start: 1, line_end: 1, summary: "The plan omits ordering." }],
    risk: "Implementation can run steps in the wrong order.",
    recommendation: "Add the migration order.",
    options: [{ title: "Add order", change: "Document the ordered steps.", tradeoff: "Requires re-review." }]
  };
  const canFixFinding = { ...blockingFinding, readiness_effect: "can-fix-during-implementation", requires_re_review: false };
  const shouldFixFinding = { ...blockingFinding, readiness_effect: "should-fix-before-start", requires_re_review: false };
  const blockingVerify = {
    question: "Does the rollback path exist?",
    why_it_matters: "It determines implementation readiness.",
    suggested_check: "rg rollback src",
    blocks_approval: true,
    related_refs: []
  };

  assert.equal(
    derivePlanReviewReadiness({
      parsed: validResult(seed, { verdict: "needs-attention", summary: "Blocked.", findings: [blockingFinding] }),
      validation: { ok: true, errors: [] },
      policyViolation: { violated: false }
    }).status,
    "blocked"
  );

  assert.equal(
    derivePlanReviewReadiness({
      parsed: validResult(seed, { verdict: "needs-attention", summary: "Revise.", findings: [shouldFixFinding] }),
      validation: { ok: true, errors: [] },
      policyViolation: { violated: false }
    }).status,
    "revise-before-start"
  );

  assert.equal(
    derivePlanReviewReadiness({
      parsed: validResult(seed, { verdict: "needs-attention", summary: "Carry notes.", findings: [canFixFinding] }),
      validation: { ok: true, errors: [] },
      policyViolation: { violated: false }
    }).status,
    "ready-with-implementation-notes"
  );

  assert.equal(
    derivePlanReviewReadiness({
      parsed: validResult(seed, {
        verdict: "needs-attention",
        summary: "Answer verify.",
        findings: [],
        requires_verify: [blockingVerify]
      }),
      validation: { ok: true, errors: [] },
      policyViolation: { violated: false }
    }).next_action,
    "answer-blocking-verification"
  );
});
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
node --test tests/plan-review.test.mjs
```

Expected: FAIL because `derivePlanReviewReadiness` is not exported.

- [x] **Step 3: Implement the helper**

Add constants and export the helper near the validation helpers in `plugins/codex/scripts/lib/plan-review.mjs`:

```js
const PLAN_REVIEW_READINESS_SCHEMA = "plan-review-readiness/v1";

function readiness(status, implementationAllowed, requiresReReview, nextAction, reasons = []) {
  return {
    schema_version: PLAN_REVIEW_READINESS_SCHEMA,
    status,
    implementation_allowed: implementationAllowed,
    requires_re_review: requiresReReview,
    next_action: nextAction,
    reasons
  };
}

export function derivePlanReviewReadiness({ parsed, validation, policyViolation } = {}) {
  if (policyViolation?.violated) {
    return readiness("policy-failed", false, false, "inspect-policy-failure", [
      { type: "policy-violation", message: "Plan review violated the read-only policy." }
    ]);
  }

  if (!parsed || validation?.ok === false) {
    const errors = Array.isArray(validation?.errors) && validation.errors.length > 0
      ? validation.errors
      : ["Missing structured plan-review result."];
    return readiness(
      "invalid-result",
      false,
      false,
      "rerun-plan-review",
      errors.map((message, index) => ({ type: "validation-error", index, message }))
    );
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const requiresVerify = Array.isArray(parsed.requires_verify) ? parsed.requires_verify : [];
  const blockingFindingIndexes = findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding?.readiness_effect === "blocks-implementation")
    .map(({ finding, index }) => ({
      type: "finding",
      index,
      message: finding.title || `Finding ${index + 1}`
    }));
  const blockingVerifyIndexes = requiresVerify
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.blocks_approval === true)
    .map(({ entry, index }) => ({
      type: "requires-verify",
      index,
      message: entry.question || `Verification question ${index + 1}`
    }));

  if (blockingFindingIndexes.length > 0) {
    return readiness("blocked", false, findings.some((finding) => finding?.requires_re_review === true), "edit-plan-and-rerun-review", blockingFindingIndexes);
  }
  if (blockingVerifyIndexes.length > 0) {
    return readiness("blocked", false, false, "answer-blocking-verification", blockingVerifyIndexes);
  }

  const reviseReasons = findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding?.readiness_effect === "should-fix-before-start" || finding?.requires_re_review === true)
    .map(({ finding, index }) => ({
      type: "finding",
      index,
      message: finding.title || `Finding ${index + 1}`
    }));

  if (reviseReasons.length > 0) {
    return readiness("revise-before-start", false, findings.some((finding) => finding?.requires_re_review === true), "edit-plan-and-rerun-review", reviseReasons);
  }

  const implementationNoteReasons = findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding?.readiness_effect === "can-fix-during-implementation")
    .map(({ finding, index }) => ({
      type: "finding",
      index,
      message: finding.title || `Finding ${index + 1}`
    }));

  if (implementationNoteReasons.length > 0) {
    return readiness("ready-with-implementation-notes", true, false, "carry-notes-into-implementation", implementationNoteReasons);
  }

  return readiness("ready", true, false, "start-implementation");
}
```

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
node --test tests/plan-review.test.mjs
```

Expected: PASS.

### Task 2: Renderer Readiness Block And Finding Actions

**Files:**
- Modify: `tests/render.test.mjs`
- Modify: `plugins/codex/scripts/lib/render.mjs`

- [x] **Step 1: Write failing render tests**

Extend the existing `renderPlanReviewResult renders findings-first markdown with plan readiness fields` test to pass a `readiness` object and assert:

```js
assert.match(output, /Readiness: blocked/);
assert.match(output, /Implementation allowed: no/);
assert.match(output, /Next action: edit-plan-and-rerun-review/);
assert.match(output, /Derived action: edit the plan before implementation and rerun plan-review/);
```

Add an invalid-result render assertion to an existing parse or validation failure test:

```js
assert.match(output, /Readiness: invalid-result/);
assert.match(output, /Implementation allowed: no/);
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
node --test tests/render.test.mjs
```

Expected: FAIL because the renderer does not output readiness metadata.

- [x] **Step 3: Implement rendering**

Import `derivePlanReviewReadiness` from `plan-review.mjs`. Add a small formatter:

```js
function formatPlanReviewFindingAction(finding) {
  if (finding.requires_re_review) {
    return "edit the plan before implementation and rerun plan-review";
  }
  switch (finding.readiness_effect) {
    case "blocks-implementation":
      return "edit the plan before implementation";
    case "should-fix-before-start":
      return "edit or clarify the plan before implementation";
    case "can-fix-during-implementation":
      return "carry this note into implementation";
    default:
      return "inspect this finding before implementation";
  }
}

function resolvePlanReviewReadiness(parsedResult, validation, policyViolation) {
  return parsedResult?.readiness ?? derivePlanReviewReadiness({
    parsed: parsedResult?.parsed ?? null,
    validation,
    policyViolation
  });
}

function appendPlanReviewReadiness(lines, readiness) {
  if (!readiness) {
    return;
  }
  lines.push(`Readiness: ${readiness.status}`);
  lines.push(`Implementation allowed: ${readiness.implementation_allowed ? "yes" : "no"}`);
  lines.push(`Requires re-review: ${readiness.requires_re_review ? "yes" : "no"}`);
  lines.push(`Next action: ${readiness.next_action}`);
}
```

Then call `appendPlanReviewReadiness` immediately after `Verdict` for valid results and near the top of policy, parse, and validation failure renders. Add `- Derived action: ...` to each finding detail block.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
node --test tests/render.test.mjs
```

Expected: PASS.

### Task 3: Runtime Payload Storage

**Files:**
- Modify: `tests/runtime.test.mjs`
- Modify: `plugins/codex/scripts/codex-companion.mjs`

- [x] **Step 1: Write failing runtime tests**

In `plan-review runs a read-only structured review for a plan file`, assert:

```js
assert.equal(payload.readiness.schema_version, "plan-review-readiness/v1");
assert.equal(payload.readiness.status, "ready");
assert.equal(payload.readiness.implementation_allowed, true);
assert.equal(payload.readiness.next_action, "start-implementation");
```

In `plan-review fails with preserved diagnostics when Codex violates read-only review policy`, assert:

```js
assert.equal(payload.readiness.status, "policy-failed");
assert.equal(payload.readiness.implementation_allowed, false);
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
node --test tests/runtime.test.mjs
```

Expected: FAIL because plan-review payloads do not include `readiness`.

- [x] **Step 3: Store readiness**

Import `derivePlanReviewReadiness` in `codex-companion.mjs`, derive it after policy audit, add it to `payload`, and pass it to `renderPlanReviewResult`:

```js
const readiness = derivePlanReviewReadiness({ parsed: parsed.parsed, validation, policyViolation });
```

Add:

```js
readiness,
```

to the payload, and:

```js
readiness,
```

to the renderer input object.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
node --test tests/runtime.test.mjs
```

Expected: PASS.

### Task 4: User-Facing Documentation

**Files:**
- Modify: `README.md`
- Modify: `plugins/codex/PLAN_REVIEW.md`
- Modify: `plugins/codex/PLAN_REVIEW_COMMAND_PLAN.md`

- [x] **Step 1: Update docs**

Document that plan-review output includes a companion-owned readiness block with:

- `ready`
- `ready-with-implementation-notes`
- `revise-before-start`
- `blocked`
- `invalid-result`
- `policy-failed`

State that readiness is runtime metadata, not model output, and that `/codex:plan-review` remains read-only.

- [x] **Step 2: Run doc-sensitive tests**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: PASS.

### Task 5: Final Validation

**Files:**
- No additional files expected.

- [x] **Step 1: Run full tests**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: PASS.

- [x] **Step 2: Run version check**

Run:

```bash
npm run check-version
```

Expected: PASS.

- [x] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS, or report the known Codex app-server generation environment limitation directly if unavailable.

- [x] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat
git diff --check
git status --short --branch
```

Expected: only scoped readiness-gate files changed, no whitespace errors.
