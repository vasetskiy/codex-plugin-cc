import test from "node:test";
import assert from "node:assert/strict";

import { renderPlanReviewResult, renderReviewResult, renderStoredJobResult } from "../plugins/codex/scripts/lib/render.mjs";

test("renderReviewResult degrades gracefully when JSON is missing required review fields", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks fine."
      },
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine."
      }),
      parseError: null
    },
    {
      reviewLabel: "Adversarial Review",
      targetLabel: "working tree diff"
    }
  );

  assert.match(output, /Codex returned JSON with an unexpected review shape\./);
  assert.match(output, /Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult prefers rendered output for structured review jobs", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Codex Adversarial Review",
      jobClass: "review",
      threadId: "thr_123"
    },
    {
      threadId: "thr_123",
      rendered: "# Codex Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: {
          verdict: "needs-attention",
          summary: "One issue.",
          findings: [],
          next_steps: []
        },
        rawOutput:
          '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}'
      }
    }
  );

  assert.match(output, /^# Codex Adversarial Review/);
  assert.doesNotMatch(output, /^\{/);
  assert.match(output, /Codex session ID: thr_123/);
  assert.match(output, /Resume in Codex: codex resume thr_123/);
});

test("renderPlanReviewResult renders findings-first markdown with plan readiness fields", () => {
  const output = renderPlanReviewResult(
    {
      parsed: {
        schema_version: "plan-review-output/v1",
        verdict: "needs-attention",
        summary: "Do not start until the migration ordering is fixed.",
        findings: [
          {
            severity: "high",
            readiness_effect: "blocks-implementation",
            requires_re_review: true,
            title: "Migration order is underspecified",
            plan_file: "docs/plan.md",
            line_start: 4,
            line_end: 6,
            evidence: [{ type: "code", path: "src/migrations.js", line_start: 10, line_end: 18, summary: "Migration runs before data backfill." }],
            risk: "Implementation can ship a schema that the loader cannot read.",
            recommendation: "Move the backfill before the schema switch.",
            options: [{ title: "Split wave", change: "Backfill first, switch second.", tradeoff: "Adds one review pass." }]
          }
        ],
        requires_verify: [
          {
            question: "Does the rollback path already exist?",
            why_it_matters: "It determines whether the plan needs a rollback slice.",
            suggested_check: "rg rollback src",
            blocks_approval: false,
            related_refs: ["src/migrations.js"]
          }
        ],
        coverage: [{ area: "migration", status: "checked", evidence: ["src/migrations.js"], notes: "Checked migration ordering." }],
        residual_risks: ["Runtime performance was not validated."]
      },
      rawOutput: "",
      parseError: null,
      validation: { ok: true, errors: [] }
    },
    {
      planPath: "docs/plan.md"
    }
  );

  assert.match(output, /^# Codex Plan Review/);
  assert.match(output, /Plan: docs\/plan\.md/);
  assert.match(output, /Findings:/);
  assert.match(output, /\| Severity \| Readiness effect \| Re-review \| Finding \| Location \|/);
  assert.match(output, /Migration order is underspecified/);
  assert.match(output, /Requires verify:/);
  assert.match(output, /Coverage:/);
  assert.match(output, /Residual risks:/);
});

test("renderPlanReviewResult puts policy failure before captured output", () => {
  const output = renderPlanReviewResult(
    {
      parsed: {
        schema_version: "plan-review-output/v1",
        verdict: "approve",
        summary: "Ready.",
        findings: [],
        requires_verify: [],
        coverage: [{ area: "code", status: "checked", evidence: ["src/app.js"], notes: "" }],
        residual_risks: []
      },
      rawOutput: '{"schema_version":"plan-review-output/v1"}',
      parseError: null,
      validation: { ok: true, errors: [] },
      policyViolation: {
        violated: true,
        forbiddenCommands: [{ command: "npm test", reason: "verification command" }],
        fileChanges: []
      }
    },
    {
      planPath: "docs/plan.md"
    }
  );

  assert.match(output, /^# Codex Plan Review Policy Failure/);
  assert.match(output, /npm test/);
  assert.match(output, /Captured output:/);
});
