import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import {
  auditPlanReviewPolicy,
  buildPlanReviewPrompt,
  collectPlanReviewSeedContext,
  isForbiddenPlanReviewCommand,
  resolvePlanReviewPath,
  validatePlanReviewResult
} from "../plugins/codex/scripts/lib/plan-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeFile(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function makeRepoWithPlan() {
  const repo = makeTempDir();
  initGitRepo(repo);
  writeFile(path.join(repo, "AGENTS.md"), "# Root guide\n");
  writeFile(path.join(repo, "projects", "active", "demo", "CLAUDE.md"), "# Project guide\n");
  writeFile(path.join(repo, "projects", "active", "demo", "state.md"), "# Current state\n");
  writeFile(path.join(repo, "projects", "active", "demo", "plan.md"), "# Parent project plan\n");
  writeFile(path.join(repo, "projects", "active", "demo", "plan", "review1.md"), "# Historical review\n");
  writeFile(
    path.join(repo, "projects", "active", "demo", "plan", "plan.md"),
    ["# Demo plan", "", "1. Change the loader.", "2. Verify with unit tests.", ""].join("\n")
  );
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  return repo;
}

function validResult(seed, overrides = {}) {
  return {
    schema_version: "plan-review-output/v1",
    verdict: "approve",
    summary: "Ready to implement.",
    findings: [],
    requires_verify: [],
    coverage: [
      {
        area: "code",
        status: "checked",
        evidence: ["src/loader.js"],
        notes: "Checked the stated loader seam."
      }
    ],
    residual_risks: [],
    ...overrides
  };
}

test("resolvePlanReviewPath accepts untracked UTF-8 plans and rejects unsafe targets", () => {
  const repo = makeRepoWithPlan();
  const untrackedPlan = path.join(repo, "projects", "active", "demo", "plan", "next.md");
  writeFile(untrackedPlan, "# Next plan\n");

  const resolved = resolvePlanReviewPath(repo, "projects/active/demo/plan/next.md");
  assert.equal(resolved.repoRoot, repo);
  assert.equal(resolved.normalizedPlanPath, "projects/active/demo/plan/next.md");
  assert.equal(resolved.text, "# Next plan\n");

  assert.throws(() => resolvePlanReviewPath(repo, "missing.md"), /does not exist/);
  assert.throws(() => resolvePlanReviewPath(repo, "projects/active/demo/plan"), /not a file/);
  fs.writeFileSync(path.join(repo, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  assert.throws(() => resolvePlanReviewPath(repo, "binary.bin"), /binary/i);

  const outside = path.join(makeTempDir(), "outside.md");
  writeFile(outside, "# Outside\n");
  assert.throws(() => resolvePlanReviewPath(repo, outside), /inside the repository/);

  fs.symlinkSync(outside, path.join(repo, "linked-outside.md"));
  assert.throws(() => resolvePlanReviewPath(repo, "linked-outside.md"), /inside the repository/);
});

test("collectPlanReviewSeedContext builds bounded deterministic seed context", () => {
  const repo = makeRepoWithPlan();
  const planPath = "projects/active/demo/plan/plan.md";
  const seed = collectPlanReviewSeedContext(repo, planPath);

  assert.equal(seed.schema_version, "plan-review-seed/v1");
  assert.equal(seed.repo_root, repo);
  assert.equal(seed.command_cwd, repo);
  assert.equal(seed.normalized_plan_path, planPath);
  assert.equal(seed.line_count, 5);
  assert.equal(seed.byte_length, Buffer.byteLength(seed.plan_text, "utf8"));
  assert.match(seed.plan_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(seed.plan_lines.slice(0, 3), [
    { line: 1, text: "# Demo plan" },
    { line: 2, text: "" },
    { line: 3, text: "1. Change the loader." }
  ]);
  assert.equal(seed.git.branch, "main");
  assert.equal(seed.git.status_short, "");
  assert.deepEqual(
    seed.guidance_candidates.map((candidate) => [candidate.path, candidate.read_by_default]),
    [
      ["projects/active/demo/CLAUDE.md", true],
      ["AGENTS.md", true]
    ]
  );
  assert.deepEqual(seed.adjacent_context_candidates.map((candidate) => candidate.path), [
    "projects/active/demo/state.md",
    "projects/active/demo/plan.md"
  ]);
  assert.equal(seed.historical_artifacts_policy.read_by_default, false);
  assert.match(seed.historical_artifacts_policy.summary, /review\*\.md/);
});

test("buildPlanReviewPrompt includes the seed packet and plan-review method", () => {
  const repo = makeRepoWithPlan();
  const seed = collectPlanReviewSeedContext(repo, "projects/active/demo/plan/plan.md");
  const prompt = buildPlanReviewPrompt(seed);

  assert.match(prompt, /plan-review-seed\/v1/);
  assert.match(prompt, /projects\/active\/demo\/plan\/plan\.md/);
  assert.match(prompt, /"plan_sha256":/);
  assert.match(prompt, /1\. Change the loader\./);
  assert.match(prompt, /claim\/scope map/i);
  assert.match(prompt, /bounded subagents/i);
  assert.match(prompt, /read-only/i);
  assert.match(prompt, /do not run tests/i);
  assert.match(prompt, /do not read historical `review\*\.md`/i);
  assert.match(prompt, /Return only valid JSON/i);
});

test("validatePlanReviewResult enforces readiness invariants tied to the seed", () => {
  const repo = makeRepoWithPlan();
  const seed = collectPlanReviewSeedContext(repo, "projects/active/demo/plan/plan.md");

  assert.deepEqual(validatePlanReviewResult(validResult(seed), seed), { ok: true, errors: [] });

  assert.deepEqual(validatePlanReviewResult(validResult(seed, { schema_version: "wrong/v1" }), seed), {
    ok: false,
    errors: ["Expected schema_version `plan-review-output/v1`."]
  });

  assert.deepEqual(
    validatePlanReviewResult(
      validResult(seed, {
        requires_verify: [
          {
            question: "Does the migration already exist?",
            why_it_matters: "The plan depends on the answer.",
            suggested_check: "rg migration",
            blocks_approval: true,
            related_refs: []
          }
        ]
      }),
      seed
    ),
    {
      ok: false,
      errors: ["`approve` verdict is not allowed when `requires_verify` contains blocking questions."]
    }
  );

  assert.deepEqual(
    validatePlanReviewResult(
      validResult(seed, {
        verdict: "needs-attention",
        summary: "Not ready.",
        findings: [],
        requires_verify: []
      }),
      seed
    ),
    {
      ok: false,
      errors: ["`needs-attention` verdict requires material findings or blocking verification questions."]
    }
  );

  assert.deepEqual(
    validatePlanReviewResult(
      validResult(seed, {
        coverage: [{ area: "code", status: "checked", evidence: [], notes: "" }]
      }),
      seed
    ),
    {
      ok: false,
      errors: ["`approve` verdict requires meaningful coverage."]
    }
  );

  const badFinding = validResult(seed, {
    verdict: "needs-attention",
    findings: [
      {
        severity: "high",
        readiness_effect: "blocks-implementation",
        requires_re_review: true,
        title: "Wrong file",
        plan_file: "other.md",
        line_start: seed.line_count + 1,
        line_end: seed.line_count + 1,
        evidence: [{ type: "plan", path: seed.normalized_plan_path, line_start: 1, line_end: 1, summary: "Plan claim." }],
        risk: "The plan points at the wrong target.",
        recommendation: "Fix the target.",
        options: [{ title: "Retarget", change: "Update the plan.", tradeoff: "Requires re-review." }]
      }
    ]
  });
  const validation = validatePlanReviewResult(badFinding, seed);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /findings\[0\]\.plan_file/);
  assert.match(validation.errors.join("\n"), /findings\[0\]\.line_start/);
});

test("auditPlanReviewPolicy catches runtime policy violations without blocking read-only search", () => {
  assert.equal(isForbiddenPlanReviewCommand('rg "test" tests'), false);
  assert.equal(isForbiddenPlanReviewCommand("npm test"), true);
  assert.equal(isForbiddenPlanReviewCommand("npm run build"), true);
  assert.equal(isForbiddenPlanReviewCommand("python -m pytest"), true);
  assert.equal(isForbiddenPlanReviewCommand("docker compose up db"), true);
  assert.equal(isForbiddenPlanReviewCommand("prisma migrate deploy"), true);

  const clean = auditPlanReviewPolicy({
    commandExecutions: [{ type: "commandExecution", status: "completed", command: 'rg "test" tests', exitCode: 0 }],
    fileChanges: []
  });
  assert.equal(clean.violated, false);

  const violation = auditPlanReviewPolicy({
    commandExecutions: [
      { type: "commandExecution", status: "completed", command: "npm test", exitCode: 0 },
      { type: "commandExecution", status: "completed", command: "alembic upgrade head", exitCode: 0 },
      { type: "commandExecution", status: "failed", command: "npm run build", exitCode: 1 }
    ],
    fileChanges: [{ type: "fileChange", status: "completed", changes: [{ path: "plan.md" }] }]
  });
  assert.equal(violation.violated, true);
  assert.deepEqual(violation.forbiddenCommands.map((entry) => entry.command), [
    "npm test",
    "alembic upgrade head",
    "npm run build"
  ]);
  assert.equal(violation.fileChanges.length, 1);
});
