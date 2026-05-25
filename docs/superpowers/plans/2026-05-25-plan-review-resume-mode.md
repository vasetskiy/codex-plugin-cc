# Plan Review Resume Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit `/codex:plan-review --resume <path>` support that resumes the latest finished plan-review thread for the same normalized plan path and current Claude session.

**Architecture:** Keep the model-owned `plan-review-output/v1` schema unchanged. Collect the current plan-review seed before job creation, store the normalized plan path on the job record, resolve a session-scoped finished plan-review candidate from tracked job state plus stored job payloads, then call the existing `runAppServerTurn` with either `resumeThreadId` or a persistent fresh plan-review thread.

**Tech Stack:** Node.js ESM, `node:test`, existing fake Codex app-server fixture, existing companion tracked-job runtime.

---

### Task 1: Command Wrapper Contract

**Files:**
- Modify: `tests/commands.test.mjs`
- Modify: `plugins/codex/commands/plan-review.md`

- [ ] **Step 1: Write the failing command-doc test**

In `tests/commands.test.mjs`, update the `plan-review command is a thin deterministic wrapper` test so the argument hint and wrapper prose explicitly include `--resume`:

```js
  assert.match(source, /argument-hint:\s*'\[--wait\|--background\] \[--resume\] <path\/to\/plan\.md>'/);
  assert.match(source, /`--resume` is parsed by the companion/i);
  assert.match(source, /does not ask whether to continue/i);
```

Keep the existing assertions that the command does not use `Read`, `Grep`, or `Glob`, preserves `$ARGUMENTS`, uses `AskUserQuestion` for foreground/background only, and returns stdout verbatim.

- [ ] **Step 2: Run the command-doc test to verify RED**

Run:

```bash
node --test tests/commands.test.mjs
```

Expected: FAIL because `plugins/codex/commands/plan-review.md` still advertises only `[--wait|--background] <path/to/plan.md>` and does not document `--resume`.

- [ ] **Step 3: Update the thin wrapper docs**

In `plugins/codex/commands/plan-review.md`, change the frontmatter and argument-handling text to:

```md
argument-hint: '[--wait|--background] [--resume] <path/to/plan.md>'
```

Add this bullet under `Argument handling`:

```md
- `--resume` is parsed by the companion. Preserve it in `$ARGUMENTS`; do not ask whether to continue and do not inspect prior jobs on the Claude side.
```

Do not add any Claude-side file reads, grep/glob instructions, resume candidate probing, or result summarization.

- [ ] **Step 4: Run the command-doc test to verify GREEN**

Run:

```bash
node --test tests/commands.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the wrapper contract change**

Run:

```bash
git add tests/commands.test.mjs plugins/codex/commands/plan-review.md
git commit -m "test: cover plan-review resume wrapper contract"
```

Do not stage `CURRENT_STATE.md`.

### Task 2: Fresh Plan-Review Persistent Threads

**Files:**
- Modify: `tests/runtime.test.mjs`
- Modify: `plugins/codex/scripts/codex-companion.mjs`

- [ ] **Step 1: Write the failing persistent-thread runtime test**

In `tests/runtime.test.mjs`, after `plan-review runs a read-only structured review for a plan file`, add:

```js
test("plan-review fresh runs create persistent threads", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const statePath = path.join(binDir, "fake-codex-state.json");
  installFakeCodex(binDir, "plan-review-ok");
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "plan.md"), "# Plan\n\nFirst version.\n");
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const result = run("node", [SCRIPT, "plan-review", "--json", "docs/plan.md"], {
    cwd: repo,
    env: buildEnv(binDir)
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const fakeState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const thread = fakeState.threads.find((candidate) => candidate.id === payload.threadId);
  assert.equal(thread.ephemeral, false);
  assert.match(thread.name, /^Codex Plan Review: docs\/plan\.md$/);
  assert.deepEqual(payload.runtime.resume, {
    requested: false,
    sourceJobId: null,
    sourceThreadId: null,
    sourceCompletedAt: null
  });
});
```

- [ ] **Step 2: Run the focused runtime test to verify RED**

Run:

```bash
node --test --test-name-pattern "plan-review fresh runs create persistent threads" tests/runtime.test.mjs
```

Expected: FAIL because fresh plan-review runs still start ephemeral unnamed threads and do not store `runtime.resume`.

- [ ] **Step 3: Add persistent plan-review thread naming**

In `plugins/codex/scripts/codex-companion.mjs`, add a constant beside `STOP_REVIEW_TASK_MARKER`:

```js
const PLAN_REVIEW_THREAD_PREFIX = "Codex Plan Review";
```

Add a helper near `buildTaskRunMetadata`:

```js
function buildPersistentPlanReviewThreadName(normalizedPlanPath) {
  const excerpt = shorten(normalizedPlanPath, 56);
  return excerpt ? `${PLAN_REVIEW_THREAD_PREFIX}: ${excerpt}` : PLAN_REVIEW_THREAD_PREFIX;
}
```

In `executePlanReviewRun`, compute resume metadata and pass persistent thread options:

```js
  const resumeSource = request.resumeSource ?? null;
  const resumeMetadata = resumeSource
    ? {
        requested: true,
        sourceJobId: resumeSource.id,
        sourceThreadId: resumeSource.threadId,
        sourceCompletedAt: resumeSource.completedAt ?? null
      }
    : {
        requested: false,
        sourceJobId: null,
        sourceThreadId: null,
        sourceCompletedAt: null
      };
```

Update the `runAppServerTurn` call:

```js
  const result = await runAppServerTurn(seed.repo_root, {
    resumeThreadId: resumeSource?.threadId ?? null,
    prompt,
    model: request.model,
    sandbox: "read-only",
    outputSchema: readOutputSchema(PLAN_REVIEW_SCHEMA),
    onProgress: request.onProgress,
    persistThread: !resumeSource,
    threadName: resumeSource ? null : buildPersistentPlanReviewThreadName(seed.normalized_plan_path)
  });
```

Add the metadata under `runtime`:

```js
    resume: resumeMetadata,
```

- [ ] **Step 4: Run the focused runtime test to verify GREEN**

Run:

```bash
node --test --test-name-pattern "plan-review fresh runs create persistent threads" tests/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the persistent-thread increment**

Run:

```bash
git add tests/runtime.test.mjs plugins/codex/scripts/codex-companion.mjs
git commit -m "test: require persistent plan-review threads"
```

Do not stage `CURRENT_STATE.md`.

### Task 3: Successful Plan-Review Resume

**Files:**
- Modify: `tests/fake-codex-fixture.mjs`
- Modify: `tests/runtime.test.mjs`
- Modify: `plugins/codex/scripts/codex-companion.mjs`

- [ ] **Step 1: Record fake app-server resume requests**

In `tests/fake-codex-fixture.mjs`, inside the `thread/resume` case before `saveState(state);`, add:

```js
        state.lastThreadResume = {
          threadId: message.params.threadId,
          cwd: message.params.cwd ?? null,
          model: message.params.model ?? null,
          sandbox: message.params.sandbox ?? null
        };
```

This is test fixture instrumentation only.

- [ ] **Step 2: Write the failing successful-resume test**

In `tests/runtime.test.mjs`, after the persistent-thread test, add:

```js
test("plan-review --resume resumes the latest finished review for the same plan in the current session", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const statePath = path.join(binDir, "fake-codex-state.json");
  installFakeCodex(binDir, "plan-review-ok");
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "plan.md"), "# Plan\n\nFirst version.\n");
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const env = {
    ...buildEnv(binDir),
    CODEX_COMPANION_SESSION_ID: "sess-current"
  };
  const first = run("node", [SCRIPT, "plan-review", "--json", "docs/plan.md"], {
    cwd: repo,
    env
  });
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);

  fs.writeFileSync(path.join(repo, "docs", "plan.md"), "# Plan\n\nSecond version.\n");

  const resumed = run("node", [SCRIPT, "plan-review", "--json", "--resume", "./docs/plan.md"], {
    cwd: repo,
    env
  });

  assert.equal(resumed.status, 0, resumed.stderr);
  const resumedPayload = JSON.parse(resumed.stdout);
  assert.notEqual(resumedPayload.turnId, firstPayload.turnId);
  assert.equal(resumedPayload.threadId, firstPayload.threadId);
  assert.equal(resumedPayload.plan.normalized_plan_path, "docs/plan.md");
  assert.equal(resumedPayload.runtime.resume.requested, true);
  assert.equal(resumedPayload.runtime.resume.sourceJobId, firstPayload.runtime.jobId);
  assert.match(resumedPayload.runtime.resume.sourceJobId, /^review-/);
  assert.equal(resumedPayload.runtime.resume.sourceThreadId, firstPayload.threadId);
  assert.match(resumedPayload.runtime.resume.sourceCompletedAt, /^\d{4}-\d{2}-\d{2}T/);

  const fakeState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(fakeState.lastThreadResume.threadId, firstPayload.threadId);
  assert.equal(fakeState.lastTurnStart.threadId, firstPayload.threadId);
  assert.match(fakeState.lastTurnStart.prompt, /Second version\./);
});
```

- [ ] **Step 3: Run the successful-resume test to verify RED**

Run:

```bash
node --test --test-name-pattern "plan-review --resume resumes the latest finished review" tests/runtime.test.mjs
```

Expected: FAIL because `--resume` is still an unknown plan-review option or no candidate is resolved.

- [ ] **Step 4: Add plan-review resume parsing and candidate matching**

In `parsePlanReviewInput`, include `--resume` in the boolean option list:

```js
    if (token === "--json" || token === "--wait" || token === "--background" || token === "--resume") {
      options[token.slice(2)] = true;
      continue;
    }
```

Add these helpers near `findLatestResumableTaskJob`:

```js
function getStoredPlanReviewPath(workspaceRoot, job) {
  const storedJob = readStoredJob(workspaceRoot, job.id);
  return (
    storedJob?.result?.plan?.normalized_plan_path ??
    storedJob?.targetLabel ??
    job.targetLabel ??
    null
  );
}

function findPlanReviewJobsForPath(workspaceRoot, jobs, normalizedPlanPath) {
  return jobs.filter((job) => {
    if (job.kind !== "plan-review" || job.jobClass !== "review") {
      return false;
    }
    return getStoredPlanReviewPath(workspaceRoot, job) === normalizedPlanPath;
  });
}

function resolveLatestPlanReviewResumeSource(workspaceRoot, seed, options = {}) {
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot)).filter((job) => job.id !== options.excludeJobId);
  const visibleJobs = filterJobsForCurrentClaudeSession(jobs);
  const matchingJobs = findPlanReviewJobsForPath(workspaceRoot, visibleJobs, seed.normalized_plan_path);
  const active = matchingJobs.find((job) => isActiveJobStatus(job.status));
  if (active) {
    throw new Error(`Plan review ${active.id} is still ${active.status}. Use /codex:status ${active.id} before resuming it.`);
  }

  const finished = matchingJobs.find((job) => job.threadId && !isActiveJobStatus(job.status));
  if (!finished) {
    throw new Error(`No previous finished plan review was found for ${seed.normalized_plan_path}. Run /codex:plan-review ${seed.normalized_plan_path} first.`);
  }

  return {
    id: finished.id,
    threadId: finished.threadId,
    completedAt: finished.completedAt ?? null
  };
}
```

Change `executePlanReviewRun` so it can receive a prebuilt seed:

```js
  const seed = request.seed ?? collectPlanReviewSeedContext(request.cwd, request.planPath);
```

In `handlePlanReview`, collect the seed before creating the job, set `targetLabel`, and pass `resumeSource`:

```js
  const seed = collectPlanReviewSeedContext(cwd, planPath);
  const resumeRequested = Boolean(options.resume);
  const job = createCompanionJob({
    prefix: "review",
    kind: "plan-review",
    title: "Codex Plan Review",
    workspaceRoot,
    jobClass: "review",
    summary: `Plan Review ${seed.normalized_plan_path}`,
    targetLabel: seed.normalized_plan_path
  });
  const resumeSource = resumeRequested
    ? resolveLatestPlanReviewResumeSource(workspaceRoot, seed, { excludeJobId: job.id })
    : null;
```

Update `createCompanionJob` to accept and store `targetLabel`:

```js
function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false, targetLabel = null }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind, jobClass),
    title,
    workspaceRoot,
    jobClass,
    summary,
    ...(targetLabel ? { targetLabel } : {}),
    write
  });
}
```

Pass `seed` and `resumeSource` into `executePlanReviewRun`:

```js
      executePlanReviewRun({
        cwd,
        model,
        planPath,
        seed,
        resumeSource,
        commandOptions: {
          wait: Boolean(options.wait),
          background: Boolean(options.background),
          json: Boolean(options.json),
          resume: resumeRequested
        },
        onProgress: progress
      }),
```

Add `jobId` to `runtime` so tests and stored metadata can directly trace the source job:

```js
    jobId: request.jobId ?? null,
```

Add `resume` to `runtime.command.options`:

```js
        resume: Boolean(commandOptions.resume),
```

Pass `jobId: job.id` in the request object.

- [ ] **Step 5: Run the successful-resume test to verify GREEN**

Run:

```bash
node --test --test-name-pattern "plan-review --resume resumes the latest finished review" tests/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run the existing plan-review runtime tests**

Run:

```bash
node --test --test-name-pattern "plan-review runs a read-only structured review|plan-review status and result expose plan-review|plan-review fails with preserved diagnostics|plan-review strips command-layer" tests/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the successful resume behavior**

Run:

```bash
git add tests/fake-codex-fixture.mjs tests/runtime.test.mjs plugins/codex/scripts/codex-companion.mjs
git commit -m "feat: resume plan-review threads explicitly"
```

Do not stage `CURRENT_STATE.md`.

### Task 4: Resume Rejection And Session Scoping

**Files:**
- Modify: `tests/runtime.test.mjs`
- Modify: `plugins/codex/scripts/codex-companion.mjs`

- [ ] **Step 1: Write the active-matching-job rejection test**

In `tests/runtime.test.mjs`, add:

```js
test("plan-review --resume rejects when a matching plan-review job is still active", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "plan-review-ok");
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "plan.md"), "# Plan\n");
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const stateDir = resolveStateDir(repo);
  fs.mkdirSync(path.join(stateDir, "jobs"), { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "state.json"),
    `${JSON.stringify(
      {
        version: 1,
        config: { stopReviewGate: false },
        jobs: [
          {
            id: "review-running",
            kind: "plan-review",
            kindLabel: "plan-review",
            status: "running",
            title: "Codex Plan Review",
            jobClass: "review",
            sessionId: "sess-current",
            threadId: "thr_running",
            targetLabel: "docs/plan.md",
            summary: "Plan Review docs/plan.md",
            updatedAt: "2026-05-25T12:00:00.000Z"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = run("node", [SCRIPT, "plan-review", "--resume", "docs/plan.md"], {
    cwd: repo,
    env: {
      ...buildEnv(binDir),
      CODEX_COMPANION_SESSION_ID: "sess-current"
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Plan review review-running is still running/);
});
```

- [ ] **Step 2: Write the no-candidate, other-session, and different-path tests**

Add:

```js
test("plan-review --resume fails clearly when no matching finished review exists", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "plan-review-ok");
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "plan.md"), "# Plan\n");
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const result = run("node", [SCRIPT, "plan-review", "--resume", "plan.md"], {
    cwd: repo,
    env: buildEnv(binDir)
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No previous finished plan review was found for plan\.md/);
});

test("plan-review --resume ignores finished reviews from other Claude sessions", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const statePath = path.join(binDir, "fake-codex-state.json");
  installFakeCodex(binDir, "plan-review-ok");
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "plan.md"), "# Plan\n\nFirst version.\n");
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const first = run("node", [SCRIPT, "plan-review", "--json", "plan.md"], {
    cwd: repo,
    env: {
      ...buildEnv(binDir),
      CODEX_COMPANION_SESSION_ID: "sess-other"
    }
  });
  assert.equal(first.status, 0, first.stderr);

  const resume = run("node", [SCRIPT, "plan-review", "--resume", "plan.md"], {
    cwd: repo,
    env: {
      ...buildEnv(binDir),
      CODEX_COMPANION_SESSION_ID: "sess-current"
    }
  });

  assert.equal(resume.status, 1);
  assert.match(resume.stderr, /No previous finished plan review was found for plan\.md/);
  const fakeState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(fakeState.lastThreadResume ?? null, null);
});

test("plan-review --resume ignores finished reviews for a different normalized plan path", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "plan-review-ok");
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "one.md"), "# One\n");
  fs.writeFileSync(path.join(repo, "docs", "two.md"), "# Two\n");
  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const env = {
    ...buildEnv(binDir),
    CODEX_COMPANION_SESSION_ID: "sess-current"
  };
  const first = run("node", [SCRIPT, "plan-review", "--json", "docs/one.md"], {
    cwd: repo,
    env
  });
  assert.equal(first.status, 0, first.stderr);

  const resume = run("node", [SCRIPT, "plan-review", "--resume", "docs/two.md"], {
    cwd: repo,
    env
  });

  assert.equal(resume.status, 1);
  assert.match(resume.stderr, /No previous finished plan review was found for docs\/two\.md/);
});
```

- [ ] **Step 3: Run the rejection tests to verify RED or catch gaps**

Run:

```bash
node --test --test-name-pattern "plan-review --resume rejects|plan-review --resume fails clearly|plan-review --resume ignores" tests/runtime.test.mjs
```

Expected before implementation is complete: FAIL. Expected after Task 3 may be mixed; use the failures to tighten `resolveLatestPlanReviewResumeSource`.

- [ ] **Step 4: Tighten candidate matching**

Make sure `resolveLatestPlanReviewResumeSource` uses:

```js
  const visibleJobs = filterJobsForCurrentClaudeSession(jobs);
```

Make sure active matching jobs are checked before finished candidates:

```js
  const active = matchingJobs.find((job) => isActiveJobStatus(job.status));
  if (active) {
    throw new Error(`Plan review ${active.id} is still ${active.status}. Use /codex:status ${active.id} before resuming it.`);
  }
```

Make sure the no-candidate error includes the normalized path:

```js
  throw new Error(`No previous finished plan review was found for ${seed.normalized_plan_path}. Run /codex:plan-review ${seed.normalized_plan_path} first.`);
```

- [ ] **Step 5: Run the rejection tests to verify GREEN**

Run:

```bash
node --test --test-name-pattern "plan-review --resume rejects|plan-review --resume fails clearly|plan-review --resume ignores" tests/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the rejection behavior**

Run:

```bash
git add tests/runtime.test.mjs plugins/codex/scripts/codex-companion.mjs
git commit -m "test: cover plan-review resume scoping"
```

Do not stage `CURRENT_STATE.md`.

### Task 5: User-Facing Docs

**Files:**
- Modify: `README.md`
- Modify: `plugins/codex/PLAN_REVIEW.md`

- [ ] **Step 1: Update README command examples and summary**

In the plan-review section of `README.md`, add the resume example:

```md
/codex:plan-review --resume docs/plans/wave-1/plan.md
```

Add a short paragraph after the deterministic seed/readiness description:

```md
Use `--resume` after editing the same plan when you want Codex to continue the previous plan-review thread while rebuilding the seed from the current file. Resume is scoped to the same normalized plan path and current Claude session.
```

- [ ] **Step 2: Update the detailed plan-review docs**

In `plugins/codex/PLAN_REVIEW.md`, update the command block:

```md
/codex:plan-review [--wait|--background] [--resume] <path/to/plan.md>
```

Add the resume example:

```md
/codex:plan-review --resume docs/plans/wave-1/plan.md
```

Add a section before `Background Jobs`:

```md
## Resuming A Plan Review

Use `--resume` when you have already reviewed a plan in the current Claude session, edited the same plan file, and want Codex to continue the prior plan-review thread.

The companion still rebuilds the deterministic seed from the current file. It resumes only the newest finished `plan-review` job whose normalized plan path matches the current path. If a matching plan review is still running, the command fails and asks you to check status first.

`--resume` does not apply findings, edit the plan, or create a convergence loop. It starts a new tracked plan-review job and stores resume metadata in the runtime payload.
```

- [ ] **Step 3: Run command docs and markdown-sensitive tests**

Run:

```bash
node --test tests/commands.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit the user docs**

Run:

```bash
git add README.md plugins/codex/PLAN_REVIEW.md
git commit -m "docs: document plan-review resume mode"
```

Do not stage `CURRENT_STATE.md`.

### Task 6: Final Verification

**Files:**
- No planned file changes.

- [ ] **Step 1: Run focused plan-review runtime tests**

Run:

```bash
node --test --test-name-pattern "plan-review" tests/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run command contract tests**

Run:

```bash
node --test tests/commands.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the full local suite**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: PASS. If the known subagent-prefix runtime assertion flakes, rerun the failed test once and record both outputs.

- [ ] **Step 4: Run version consistency check**

Run:

```bash
npm run check-version
```

Expected: PASS with version metadata still matching `1.0.4`.

- [ ] **Step 5: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit status 0.

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: PASS. The known `codex app-server generate-ts` PATH/read-only warning is acceptable only if the build exits 0.

- [ ] **Step 7: Inspect final diff**

Run:

```bash
git status --short --branch
git diff --stat
git diff -- README.md plugins/codex/PLAN_REVIEW.md plugins/codex/commands/plan-review.md plugins/codex/scripts/codex-companion.mjs tests/commands.test.mjs tests/fake-codex-fixture.mjs tests/runtime.test.mjs
```

Expected: product/docs/test changes only, plus the pre-existing unstaged `CURRENT_STATE.md` handoff. Do not include `CURRENT_STATE.md` in the product commit.

- [ ] **Step 8: Commit any remaining implementation changes**

If all prior task commits were made, this step should have no staged changes. If one final cleanup diff remains, commit it with:

```bash
git add README.md plugins/codex/PLAN_REVIEW.md plugins/codex/commands/plan-review.md plugins/codex/scripts/codex-companion.mjs tests/commands.test.mjs tests/fake-codex-fixture.mjs tests/runtime.test.mjs docs/superpowers/plans/2026-05-25-plan-review-resume-mode.md
git commit -m "feat: add plan-review resume mode"
```

Do not stage `CURRENT_STATE.md`.
