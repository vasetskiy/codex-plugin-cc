import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import { ensureAbsolutePath, isProbablyText } from "./fs.mjs";
import { getCurrentBranch, getRepoRoot } from "./git.mjs";
import { runCommandChecked } from "./process.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./prompts.mjs";

const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PLAN_REVIEW_SEED_SCHEMA = "plan-review-seed/v1";
const PLAN_REVIEW_OUTPUT_SCHEMA = "plan-review-output/v1";
const PLAN_REVIEW_READINESS_SCHEMA = "plan-review-readiness/v1";
const GUIDE_FILENAMES = ["AGENTS.md", "CLAUDE.md", "README.md"];
const ADJACENT_CONTEXT_FILENAMES = [
  "state.md",
  "current-state.md",
  "current-state",
  "current_state.md",
  "CURRENT_STATE.md",
  "decisions.md",
  "plan.md"
];
const MAX_ATTACHED_ADJACENT_CONTEXT_FILES = 4;
const MAX_DECLARED_TOUCHPOINTS = 12;
const MAX_ATTACHED_TOUCHPOINT_FILES = 8;
const MAX_ATTACHED_CONTEXT_BYTES = 16 * 1024;
const TOUCHPOINT_FILE_EXTENSION_PATTERN =
  /\.(?:bash|cjs|css|fish|go|html|java|js|json|jsx|lock|markdown|md|mjs|php|py|rb|rs|scss|sh|sql|toml|ts|tsx|txt|yaml|yml|zsh)$/i;
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_READINESS_EFFECTS = new Set([
  "blocks-implementation",
  "should-fix-before-start",
  "can-fix-during-implementation"
]);
const VALID_EVIDENCE_TYPES = new Set(["plan", "code", "test", "doc", "tool-output"]);
const VALID_COVERAGE_STATUSES = new Set(["checked", "partially-checked", "not-applicable"]);

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function decodeUtf8(buffer, filePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`Plan file is not valid UTF-8 text: ${filePath}`);
  }
}

function splitLines(text) {
  if (text.length === 0) {
    return [];
  }
  return text.split(/\r\n|\n|\r/);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readGitStatus(repoRoot) {
  return runCommandChecked("git", ["status", "--short", "--untracked-files=all"], { cwd: repoRoot }).stdout.trim();
}

function roleForGuide(filename) {
  if (filename === "AGENTS.md") {
    return "agent-guide";
  }
  if (filename === "CLAUDE.md") {
    return "operational-guide";
  }
  return "readme";
}

function roleForAdjacent(filename) {
  const normalized = filename.toLowerCase();
  if (
    normalized === "state.md" ||
    normalized.includes("current-state") ||
    normalized.includes("current_state")
  ) {
    return "current-state";
  }
  if (normalized === "decisions.md") {
    return "decisions";
  }
  return "adjacent-context";
}

function hasTouchpointPathShape(value) {
  return value.includes("/") || TOUCHPOINT_FILE_EXTENSION_PATTERN.test(value);
}

function normalizeDeclaredTouchpointPath(rawValue) {
  let value = String(rawValue ?? "").trim();
  if (!value || value.includes("://") || value.includes("\0")) {
    return null;
  }

  value = value.replace(/^['"`]+|['"`]+$/g, "");
  value = value.replace(/[),.;]+$/g, "");
  value = value.replace(/^\.\/+/, "");

  const lineSuffix = value.match(/^(.+?):\d+(?:-\d+)?$/);
  if (lineSuffix) {
    value = lineSuffix[1];
  }

  if (!value || path.isAbsolute(value) || !hasTouchpointPathShape(value)) {
    return null;
  }

  const normalized = path.posix.normalize(value.split(path.sep).join("/"));
  if (!normalized || normalized === ".") {
    return null;
  }

  return normalized;
}

function extractDeclaredTouchpointPaths(planLines) {
  const results = [];
  const codeSpanPattern = /`([^`\n]+)`/g;
  const barePathPattern =
    /(?:^|[\s([{<])([A-Za-z0-9_@.+-][A-Za-z0-9_@./+-]*(?:\/[A-Za-z0-9_@.+-][A-Za-z0-9_@./+-]*|\.(?:bash|cjs|css|fish|go|html|java|js|json|jsx|lock|markdown|md|mjs|php|py|rb|rs|scss|sh|sql|toml|ts|tsx|txt|yaml|yml|zsh)))(?=$|[\s\])}>,.;:])/gi;

  planLines.forEach((text, index) => {
    const line = index + 1;
    const lineText = String(text);

    for (const match of lineText.matchAll(codeSpanPattern)) {
      const normalized = normalizeDeclaredTouchpointPath(match[1]);
      if (normalized) {
        results.push({ path: normalized, line, text: lineText });
      }
    }

    for (const match of lineText.matchAll(barePathPattern)) {
      const normalized = normalizeDeclaredTouchpointPath(match[1]);
      if (normalized) {
        results.push({ path: normalized, line, text: lineText });
      }
    }
  });

  return results;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) {
      continue;
    }
    seen.add(candidate.path);
    result.push(candidate);
  }
  return result;
}

function ancestorDirs(repoRoot, startDir) {
  const dirs = [];
  let current = startDir;
  while (isInside(repoRoot, current)) {
    dirs.push(current);
    if (current === repoRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return dirs;
}

function collectGuidanceCandidates(repoRoot, planDir) {
  const candidates = [];
  const dirs = ancestorDirs(repoRoot, planDir);

  for (const dir of dirs) {
    for (const filename of GUIDE_FILENAMES) {
      const absolutePath = path.join(dir, filename);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        continue;
      }
      candidates.push({
        path: toRepoPath(repoRoot, absolutePath),
        role: roleForGuide(filename),
        selection_reason:
          dir === repoRoot
            ? "root repository guidance candidate"
            : "nearest ancestor guidance candidate for the plan path",
        read_by_default: false
      });
    }
  }

  const deduped = dedupeCandidates(candidates);
  const nearest = deduped.find((candidate) => !candidate.path.includes("/")) ?? deduped[0] ?? null;
  const nearestScoped = deduped.find((candidate) => candidate.path.includes("/")) ?? null;

  return deduped.map((candidate) => ({
    ...candidate,
    read_by_default:
      (nearestScoped && candidate.path === nearestScoped.path) ||
      (nearest && candidate.path === nearest.path)
  }));
}

function collectAdjacentContextCandidates(repoRoot, planDir, planAbsolutePath) {
  const candidates = [];
  for (const dir of ancestorDirs(repoRoot, planDir)) {
    for (const filename of ADJACENT_CONTEXT_FILENAMES) {
      const absolutePath = path.join(dir, filename);
      if (absolutePath === planAbsolutePath) {
        continue;
      }
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        continue;
      }
      candidates.push({
        path: toRepoPath(repoRoot, absolutePath),
        role: roleForAdjacent(filename),
        selection_reason: "adjacent context candidate near the plan path",
        read_by_default: false
      });
    }
  }
  return dedupeCandidates(candidates).map((candidate, index) => ({
    ...candidate,
    read_by_default: index < MAX_ATTACHED_ADJACENT_CONTEXT_FILES
  }));
}

function classifyDeclaredTouchpoint(repoRoot, repoRealPath, candidate) {
  const absolutePath = path.resolve(repoRoot, candidate.path);
  if (!isInside(repoRoot, absolutePath)) {
    return "outside-repo";
  }
  if (!fs.existsSync(absolutePath)) {
    return "missing";
  }

  const realPath = fs.realpathSync(absolutePath);
  if (!isInside(repoRealPath, realPath)) {
    return "outside-repo";
  }

  const stat = fs.statSync(realPath);
  if (!stat.isFile()) {
    return "not-file";
  }

  const buffer = fs.readFileSync(realPath);
  if (!isProbablyText(buffer)) {
    return "binary";
  }

  return "available";
}

function collectDeclaredTouchpoints(repoRoot, planLines) {
  const byPath = new Map();
  for (const reference of extractDeclaredTouchpointPaths(planLines)) {
    if (!byPath.has(reference.path)) {
      if (byPath.size >= MAX_DECLARED_TOUCHPOINTS) {
        continue;
      }
      byPath.set(reference.path, {
        path: reference.path,
        role: "implementation-touchpoint",
        selection_reason: "declared path-like token in plan text",
        read_by_default: false,
        references: []
      });
    }

    const entry = byPath.get(reference.path);
    if (!entry.references.some((existing) => existing.line === reference.line)) {
      entry.references.push({ line: reference.line, text: reference.text });
    }
  }

  const repoRealPath = fs.realpathSync(repoRoot);
  let attachedCount = 0;
  return Array.from(byPath.values()).map((entry) => {
    const status = classifyDeclaredTouchpoint(repoRoot, repoRealPath, entry);
    const readByDefault = status === "available" && attachedCount < MAX_ATTACHED_TOUCHPOINT_FILES;
    if (readByDefault) {
      attachedCount += 1;
    }
    return {
      ...entry,
      status: readByDefault ? "attached" : status,
      read_by_default: readByDefault
    };
  });
}

function decodeUtf8Prefix(buffer, maxBytes) {
  let end = Math.min(buffer.length, maxBytes);
  while (end > 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

function readAttachedContext(repoRoot, candidate, source = "adjacent_context_candidates") {
  const absolutePath = path.join(repoRoot, candidate.path);
  const buffer = fs.readFileSync(absolutePath);
  if (!isProbablyText(buffer)) {
    return null;
  }

  let text;
  try {
    text =
      buffer.length > MAX_ATTACHED_CONTEXT_BYTES
        ? decodeUtf8Prefix(buffer, MAX_ATTACHED_CONTEXT_BYTES)
        : new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }

  const lines = splitLines(text);
  const includedByteLength = Buffer.byteLength(text, "utf8");
  return {
    path: candidate.path,
    role: candidate.role,
    selection_reason: candidate.selection_reason,
    source,
    ...(candidate.references ? { references: candidate.references } : {}),
    sha256: sha256Buffer(buffer),
    byte_length: buffer.length,
    included_byte_length: includedByteLength,
    included_line_count: lines.length,
    truncated: includedByteLength < buffer.length,
    lines: lines.map((line, index) => ({ line: index + 1, text: line }))
  };
}

function collectAttachedContext(repoRoot, adjacentContextCandidates, declaredTouchpoints) {
  const adjacentContext = adjacentContextCandidates
    .filter((candidate) => candidate.read_by_default)
    .map((candidate) => readAttachedContext(repoRoot, candidate))
    .filter(Boolean);
  const touchpointContext = declaredTouchpoints
    .filter((candidate) => candidate.read_by_default && candidate.status === "attached")
    .map((candidate) => readAttachedContext(repoRoot, candidate, "declared_touchpoints"))
    .filter(Boolean);
  return [...adjacentContext, ...touchpointContext];
}

export function resolvePlanReviewPath(cwd, planPath) {
  if (!planPath || typeof planPath !== "string") {
    throw new Error("Provide exactly one plan path.");
  }

  const repoRoot = getRepoRoot(cwd);
  const repoRealPath = fs.realpathSync(repoRoot);
  const absolutePath = ensureAbsolutePath(cwd, planPath);
  const requestedRelative = path.relative(repoRoot, absolutePath);
  if (requestedRelative.startsWith("..") || path.isAbsolute(requestedRelative)) {
    throw new Error("Plan path must be inside the repository.");
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Plan file does not exist: ${planPath}`);
  }

  const realPath = fs.realpathSync(absolutePath);
  if (!isInside(repoRealPath, realPath)) {
    throw new Error("Plan path must be inside the repository.");
  }

  const stat = fs.statSync(realPath);
  if (!stat.isFile()) {
    throw new Error(`Plan path is not a file: ${planPath}`);
  }

  const buffer = fs.readFileSync(realPath);
  if (!isProbablyText(buffer)) {
    throw new Error(`Plan file appears to be binary: ${planPath}`);
  }

  const text = decodeUtf8(buffer, planPath);
  return {
    repoRoot,
    absolutePath,
    realPath,
    normalizedPlanPath: toRepoPath(repoRoot, absolutePath),
    text,
    byteLength: buffer.length
  };
}

export function collectPlanReviewSeedContext(cwd, planPath) {
  const resolved = resolvePlanReviewPath(cwd, planPath);
  const lines = splitLines(resolved.text);
  const planDir = path.dirname(resolved.absolutePath);
  const statusShort = readGitStatus(resolved.repoRoot);
  const adjacentContextCandidates = collectAdjacentContextCandidates(
    resolved.repoRoot,
    planDir,
    resolved.absolutePath
  );
  const declaredTouchpoints = collectDeclaredTouchpoints(resolved.repoRoot, lines);

  return {
    schema_version: PLAN_REVIEW_SEED_SCHEMA,
    repo_root: resolved.repoRoot,
    command_cwd: path.resolve(cwd),
    normalized_plan_path: resolved.normalizedPlanPath,
    plan_sha256: sha256(resolved.text),
    byte_length: resolved.byteLength,
    line_count: lines.length,
    plan_text: resolved.text,
    plan_lines: lines.map((text, index) => ({ line: index + 1, text })),
    git: {
      branch: getCurrentBranch(resolved.repoRoot),
      status_short: statusShort,
      dirty: statusShort.length > 0
    },
    guidance_candidates: collectGuidanceCandidates(resolved.repoRoot, planDir),
    adjacent_context_candidates: adjacentContextCandidates,
    declared_touchpoints: declaredTouchpoints,
    attached_context: collectAttachedContext(resolved.repoRoot, adjacentContextCandidates, declaredTouchpoints),
    historical_artifacts_policy: {
      read_by_default: false,
      excluded_patterns: ["review*.md", "audit*", "postmortem*"],
      summary:
        "Do not read historical `review*.md`, audit, or postmortem artifacts by default; use them only for explicit references or imported/deferred scope checks."
    }
  };
}

export function buildPlanReviewPrompt(seed) {
  const template = loadPromptTemplate(PLUGIN_ROOT, "plan-review");
  return interpolateTemplate(template, {
    PLAN_REVIEW_SEED_JSON: JSON.stringify(seed, null, 2),
    PLAN_TEXT: seed.plan_text,
    PLAN_LINES: seed.plan_lines.map((entry) => `${entry.line}: ${entry.text}`).join("\n")
  });
}

function pushRequiredStringError(errors, value, pathName) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`Missing string \`${pathName}\`.`);
    return false;
  }
  return true;
}

function validateArray(errors, value, pathName) {
  if (!Array.isArray(value)) {
    errors.push(`Missing array \`${pathName}\`.`);
    return false;
  }
  return true;
}

function validateEvidence(errors, evidence, pathName) {
  if (!validateArray(errors, evidence, pathName)) {
    return;
  }
  evidence.forEach((entry, index) => {
    const prefix = `${pathName}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`Expected object \`${prefix}\`.`);
      return;
    }
    if (!VALID_EVIDENCE_TYPES.has(entry.type)) {
      errors.push(`Invalid \`${prefix}.type\`.`);
    }
    pushRequiredStringError(errors, entry.summary, `${prefix}.summary`);
    if (entry.line_start != null && (!Number.isInteger(entry.line_start) || entry.line_start < 1)) {
      errors.push(`Invalid \`${prefix}.line_start\`.`);
    }
    if (
      entry.line_end != null &&
      (!Number.isInteger(entry.line_end) || entry.line_end < 1 || (entry.line_start && entry.line_end < entry.line_start))
    ) {
      errors.push(`Invalid \`${prefix}.line_end\`.`);
    }
  });
}

function validateOptions(errors, options, pathName) {
  if (!validateArray(errors, options, pathName)) {
    return;
  }
  options.forEach((entry, index) => {
    const prefix = `${pathName}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`Expected object \`${prefix}\`.`);
      return;
    }
    pushRequiredStringError(errors, entry.title, `${prefix}.title`);
    pushRequiredStringError(errors, entry.change, `${prefix}.change`);
    pushRequiredStringError(errors, entry.tradeoff, `${prefix}.tradeoff`);
  });
}

function validateFindings(errors, findings, seed) {
  if (!validateArray(errors, findings, "findings")) {
    return;
  }

  findings.forEach((finding, index) => {
    const prefix = `findings[${index}]`;
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      errors.push(`Expected object \`${prefix}\`.`);
      return;
    }
    if (!VALID_SEVERITIES.has(finding.severity)) {
      errors.push(`Invalid \`${prefix}.severity\`.`);
    }
    if (!VALID_READINESS_EFFECTS.has(finding.readiness_effect)) {
      errors.push(`Invalid \`${prefix}.readiness_effect\`.`);
    }
    if (typeof finding.requires_re_review !== "boolean") {
      errors.push(`Missing boolean \`${prefix}.requires_re_review\`.`);
    }
    pushRequiredStringError(errors, finding.title, `${prefix}.title`);
    if (finding.plan_file !== seed.normalized_plan_path) {
      errors.push(`Expected \`${prefix}.plan_file\` to equal \`${seed.normalized_plan_path}\`.`);
    }
    if (!Number.isInteger(finding.line_start) || finding.line_start < 1 || finding.line_start > seed.line_count) {
      errors.push(`Invalid \`${prefix}.line_start\` for plan line count ${seed.line_count}.`);
    }
    if (
      !Number.isInteger(finding.line_end) ||
      finding.line_end < finding.line_start ||
      finding.line_end > seed.line_count
    ) {
      errors.push(`Invalid \`${prefix}.line_end\` for plan line count ${seed.line_count}.`);
    }
    validateEvidence(errors, finding.evidence, `${prefix}.evidence`);
    pushRequiredStringError(errors, finding.risk, `${prefix}.risk`);
    pushRequiredStringError(errors, finding.recommendation, `${prefix}.recommendation`);
    validateOptions(errors, finding.options, `${prefix}.options`);
  });
}

function validateRequiresVerify(errors, requiresVerify) {
  if (!validateArray(errors, requiresVerify, "requires_verify")) {
    return;
  }
  requiresVerify.forEach((entry, index) => {
    const prefix = `requires_verify[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`Expected object \`${prefix}\`.`);
      return;
    }
    pushRequiredStringError(errors, entry.question, `${prefix}.question`);
    pushRequiredStringError(errors, entry.why_it_matters, `${prefix}.why_it_matters`);
    pushRequiredStringError(errors, entry.suggested_check, `${prefix}.suggested_check`);
    if (typeof entry.blocks_approval !== "boolean") {
      errors.push(`Missing boolean \`${prefix}.blocks_approval\`.`);
    }
    if (!Array.isArray(entry.related_refs)) {
      errors.push(`Missing array \`${prefix}.related_refs\`.`);
    }
  });
}

function validateCoverage(errors, coverage) {
  if (!validateArray(errors, coverage, "coverage")) {
    return;
  }
  coverage.forEach((entry, index) => {
    const prefix = `coverage[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`Expected object \`${prefix}\`.`);
      return;
    }
    pushRequiredStringError(errors, entry.area, `${prefix}.area`);
    if (!VALID_COVERAGE_STATUSES.has(entry.status)) {
      errors.push(`Invalid \`${prefix}.status\`.`);
    }
    if (!Array.isArray(entry.evidence)) {
      errors.push(`Missing array \`${prefix}.evidence\`.`);
    }
    if (typeof entry.notes !== "string") {
      errors.push(`Missing string \`${prefix}.notes\`.`);
    }
  });
}

function hasMeaningfulCoverage(coverage) {
  return (
    Array.isArray(coverage) &&
    coverage.some((entry) => {
      const hasEvidence =
        Array.isArray(entry?.evidence) &&
        entry.evidence.some((ref) => typeof ref === "string" && ref.trim());
      const hasNotes = typeof entry?.notes === "string" && entry.notes.trim();
      return hasEvidence || hasNotes;
    })
  );
}

export function validatePlanReviewResult(data, seed) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["Expected a top-level JSON object."] };
  }

  if (data.schema_version !== PLAN_REVIEW_OUTPUT_SCHEMA) {
    errors.push("Expected schema_version `plan-review-output/v1`.");
  }
  if (data.verdict !== "approve" && data.verdict !== "needs-attention") {
    errors.push("Expected verdict `approve` or `needs-attention`.");
  }
  pushRequiredStringError(errors, data.summary, "summary");
  validateFindings(errors, data.findings, seed);
  validateRequiresVerify(errors, data.requires_verify);
  validateCoverage(errors, data.coverage);
  if (!Array.isArray(data.residual_risks)) {
    errors.push("Missing array `residual_risks`.");
  }

  if (data.verdict === "approve") {
    if (Array.isArray(data.findings) && data.findings.length > 0) {
      errors.push("`approve` verdict is not allowed when findings are present.");
    }
    if (Array.isArray(data.requires_verify) && data.requires_verify.some((entry) => entry?.blocks_approval === true)) {
      errors.push("`approve` verdict is not allowed when `requires_verify` contains blocking questions.");
    }
    if (!hasMeaningfulCoverage(data.coverage)) {
      errors.push("`approve` verdict requires meaningful coverage.");
    }
  }
  if (
    data.verdict === "needs-attention" &&
    Array.isArray(data.findings) &&
    data.findings.length === 0 &&
    (!Array.isArray(data.requires_verify) || !data.requires_verify.some((entry) => entry?.blocks_approval === true))
  ) {
    errors.push("`needs-attention` verdict requires material findings or blocking verification questions.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function buildPlanReviewReadiness(status, implementationAllowed, requiresReReview, nextAction, reasons = []) {
  return {
    schema_version: PLAN_REVIEW_READINESS_SCHEMA,
    status,
    implementation_allowed: implementationAllowed,
    requires_re_review: requiresReReview,
    next_action: nextAction,
    reasons
  };
}

function findingReason(finding, index) {
  return {
    type: "finding",
    index,
    message: finding?.title || `Finding ${index + 1}`
  };
}

function requiresVerifyReason(entry, index) {
  return {
    type: "requires-verify",
    index,
    message: entry?.question || `Verification question ${index + 1}`
  };
}

export function derivePlanReviewReadiness({ parsed, validation, policyViolation } = {}) {
  if (policyViolation?.violated) {
    return buildPlanReviewReadiness("policy-failed", false, false, "inspect-policy-failure", [
      { type: "policy-violation", message: "Plan review violated the read-only policy." }
    ]);
  }

  if (!parsed || validation?.ok === false) {
    const errors =
      Array.isArray(validation?.errors) && validation.errors.length > 0
        ? validation.errors
        : ["Missing structured plan-review result."];
    return buildPlanReviewReadiness(
      "invalid-result",
      false,
      false,
      "rerun-plan-review",
      errors.map((message, index) => ({ type: "validation-error", index, message }))
    );
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const requiresVerify = Array.isArray(parsed.requires_verify) ? parsed.requires_verify : [];
  const blockingFindingReasons = findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding?.readiness_effect === "blocks-implementation")
    .map(({ finding, index }) => findingReason(finding, index));
  const requiresReReview = findings.some((finding) => finding?.requires_re_review === true);

  if (blockingFindingReasons.length > 0) {
    return buildPlanReviewReadiness(
      "blocked",
      false,
      requiresReReview,
      requiresReReview ? "edit-plan-and-rerun-review" : "edit-plan",
      blockingFindingReasons
    );
  }

  const blockingVerifyReasons = requiresVerify
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.blocks_approval === true)
    .map(({ entry, index }) => requiresVerifyReason(entry, index));

  if (blockingVerifyReasons.length > 0) {
    return buildPlanReviewReadiness(
      "blocked",
      false,
      false,
      "answer-blocking-verification",
      blockingVerifyReasons
    );
  }

  const reviseReasons = findings
    .map((finding, index) => ({ finding, index }))
    .filter(
      ({ finding }) =>
        finding?.readiness_effect === "should-fix-before-start" || finding?.requires_re_review === true
    )
    .map(({ finding, index }) => findingReason(finding, index));

  if (reviseReasons.length > 0) {
    return buildPlanReviewReadiness(
      "revise-before-start",
      false,
      requiresReReview,
      requiresReReview ? "edit-plan-and-rerun-review" : "edit-plan",
      reviseReasons
    );
  }

  const implementationNoteReasons = findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding?.readiness_effect === "can-fix-during-implementation")
    .map(({ finding, index }) => findingReason(finding, index));

  if (implementationNoteReasons.length > 0) {
    return buildPlanReviewReadiness(
      "ready-with-implementation-notes",
      true,
      false,
      "carry-notes-into-implementation",
      implementationNoteReasons
    );
  }

  return buildPlanReviewReadiness("ready", true, false, "start-implementation");
}

export function isForbiddenPlanReviewCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const forbiddenPatterns = [
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|build|lint|typecheck|type-check|check|verify|validate)\b/,
    /\bpytest\b/,
    /\b(?:jest|vitest|mocha|ava)\b/,
    /\bcargo\s+test\b/,
    /\bgo\s+test\b/,
    /\bmvn\s+test\b/,
    /\bgradlew?\s+test\b/,
    /\btsc\b/,
    /\beslint\b/,
    /\bruff\b/,
    /\bdocker(?:\s+compose)?\b/,
    /\bprisma\s+migrate\b/,
    /\balembic\b/,
    /\brails\s+db:migrate\b/
  ];

  return forbiddenPatterns.some((pattern) => pattern.test(normalized));
}

export function auditPlanReviewPolicy(result) {
  const commandExecutions = Array.isArray(result?.commandExecutions) ? result.commandExecutions : [];
  const fileChanges = Array.isArray(result?.fileChanges) ? result.fileChanges : [];
  const forbiddenCommands = commandExecutions
    .filter((item) => isForbiddenPlanReviewCommand(item?.command))
    .map((item) => ({
      command: item.command,
      reason: "verification command"
    }));
  const completedFileChanges = fileChanges.filter((item) => item?.status === "completed");

  return {
    violated: forbiddenCommands.length > 0 || completedFileChanges.length > 0,
    forbiddenCommands,
    fileChanges: completedFileChanges
  };
}
