import { derivePlanReviewReadiness, validatePlanReviewResult } from "./plan-review.mjs";

function severityRank(severity) {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}

function formatLineRange(finding) {
  if (!finding.line_start) {
    return "";
  }
  if (!finding.line_end || finding.line_end === finding.line_start) {
    return `:${finding.line_start}`;
  }
  return `:${finding.line_start}-${finding.line_end}`;
}

function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Expected a top-level JSON object.";
  }
  if (typeof data.verdict !== "string" || !data.verdict.trim()) {
    return "Missing string `verdict`.";
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    return "Missing string `summary`.";
  }
  if (!Array.isArray(data.findings)) {
    return "Missing array `findings`.";
  }
  if (!Array.isArray(data.next_steps)) {
    return "Missing array `next_steps`.";
  }
  return null;
}

function normalizeReviewFinding(finding, index) {
  const source = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const lineStart = Number.isInteger(source.line_start) && source.line_start > 0 ? source.line_start : null;
  const lineEnd =
    Number.isInteger(source.line_end) && source.line_end > 0 && (!lineStart || source.line_end >= lineStart)
      ? source.line_end
      : lineStart;

  return {
    severity: typeof source.severity === "string" && source.severity.trim() ? source.severity.trim() : "low",
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `Finding ${index + 1}`,
    body: typeof source.body === "string" && source.body.trim() ? source.body.trim() : "No details provided.",
    file: typeof source.file === "string" && source.file.trim() ? source.file.trim() : "unknown",
    line_start: lineStart,
    line_end: lineEnd,
    recommendation: typeof source.recommendation === "string" ? source.recommendation.trim() : ""
  };
}

function normalizeReviewResultData(data) {
  return {
    verdict: data.verdict.trim(),
    summary: data.summary.trim(),
    findings: data.findings.map((finding, index) => normalizeReviewFinding(finding, index)),
    next_steps: data.next_steps
      .filter((step) => typeof step === "string" && step.trim())
      .map((step) => step.trim())
  };
}

function isStructuredReviewStoredResult(storedJob) {
  const result = storedJob?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(result, "result") ||
    Object.prototype.hasOwnProperty.call(result, "parseError")
  );
}

function formatJobLine(job) {
  const parts = [job.id, `${job.status || "unknown"}`];
  if (job.kindLabel) {
    parts.push(job.kindLabel);
  }
  if (job.title) {
    parts.push(job.title);
  }
  return parts.join(" | ");
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function formatCodexResumeCommand(job) {
  if (!job?.threadId) {
    return null;
  }
  return `codex resume ${job.threadId}`;
}

function appendActiveJobsTable(lines, jobs) {
  lines.push("Active jobs:");
  lines.push("| Job | Kind | Status | Phase | Elapsed | Codex Session ID | Summary | Actions |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    const actions = [`/codex:status ${job.id}`];
    if (job.status === "queued" || job.status === "running") {
      actions.push(`/codex:cancel ${job.id}`);
    }
    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? "")} | ${escapeMarkdownCell(job.elapsed ?? "")} | ${escapeMarkdownCell(job.threadId ?? "")} | ${escapeMarkdownCell(job.summary ?? "")} | ${actions.map((action) => `\`${action}\``).join("<br>")} |`
    );
  }
}

function pushJobDetails(lines, job, options = {}) {
  lines.push(`- ${formatJobLine(job)}`);
  if (job.summary) {
    lines.push(`  Summary: ${job.summary}`);
  }
  if (job.phase) {
    lines.push(`  Phase: ${job.phase}`);
  }
  if (options.showElapsed && job.elapsed) {
    lines.push(`  Elapsed: ${job.elapsed}`);
  }
  if (options.showDuration && job.duration) {
    lines.push(`  Duration: ${job.duration}`);
  }
  if (job.threadId) {
    lines.push(`  Codex session ID: ${job.threadId}`);
  }
  const resumeCommand = formatCodexResumeCommand(job);
  if (resumeCommand) {
    lines.push(`  Resume in Codex: ${resumeCommand}`);
  }
  if (job.logFile && options.showLog) {
    lines.push(`  Log: ${job.logFile}`);
  }
  if ((job.status === "queued" || job.status === "running") && options.showCancelHint) {
    lines.push(`  Cancel: /codex:cancel ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && options.showResultHint) {
    lines.push(`  Result: /codex:result ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && job.jobClass === "task" && job.write && options.showReviewHint) {
    lines.push("  Review changes: /codex:review --wait");
    lines.push("  Stricter review: /codex:adversarial-review --wait");
  }
  if (job.progressPreview?.length) {
    lines.push("  Progress:");
    for (const line of job.progressPreview) {
      lines.push(`    ${line}`);
    }
  }
}

function appendReasoningSection(lines, reasoningSummary) {
  if (!Array.isArray(reasoningSummary) || reasoningSummary.length === 0) {
    return;
  }

  lines.push("", "Reasoning:");
  for (const section of reasoningSummary) {
    lines.push(`- ${section}`);
  }
}

export function renderSetupReport(report) {
  const lines = [
    "# Codex Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- npm: ${report.npm.detail}`,
    `- codex: ${report.codex.detail}`,
    `- auth: ${report.auth.detail}`,
    `- session runtime: ${report.sessionRuntime.label}`,
    `- review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`,
    ""
  ];

  if (report.actionsTaken.length > 0) {
    lines.push("Actions taken:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  if (report.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderReviewResult(parsedResult, meta) {
  if (!parsedResult.parsed) {
    const lines = [
      `# Codex ${meta.reviewLabel}`,
      "",
      "Codex did not return valid structured JSON.",
      "",
      `- Parse error: ${parsedResult.parseError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const validationError = validateReviewResultShape(parsedResult.parsed);
  if (validationError) {
    const lines = [
      `# Codex ${meta.reviewLabel}`,
      "",
      `Target: ${meta.targetLabel}`,
      "Codex returned JSON with an unexpected review shape.",
      "",
      `- Validation error: ${validationError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const data = normalizeReviewResultData(parsedResult.parsed);
  const findings = [...data.findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const lines = [
    `# Codex ${meta.reviewLabel}`,
    "",
    `Target: ${meta.targetLabel}`,
    `Verdict: ${data.verdict}`,
    "",
    data.summary,
    ""
  ];

  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    for (const finding of findings) {
      const lineSuffix = formatLineRange(finding);
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file}${lineSuffix})`);
      lines.push(`  ${finding.body}`);
      if (finding.recommendation) {
        lines.push(`  Recommendation: ${finding.recommendation}`);
      }
    }
  }

  if (data.next_steps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of data.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  appendReasoningSection(lines, meta.reasoningSummary);

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatPlanLineRange(finding) {
  if (!finding?.line_start) {
    return "";
  }
  if (!finding.line_end || finding.line_end === finding.line_start) {
    return `${finding.plan_file}:${finding.line_start}`;
  }
  return `${finding.plan_file}:${finding.line_start}-${finding.line_end}`;
}

function formatEvidenceRef(entry) {
  const path = entry.path ? `${entry.path}` : entry.type;
  if (entry.line_start && entry.line_end && entry.line_end !== entry.line_start) {
    return `${path}:${entry.line_start}-${entry.line_end}`;
  }
  if (entry.line_start) {
    return `${path}:${entry.line_start}`;
  }
  return path;
}

function normalizePlanReviewValidation(parsedResult, meta) {
  if (parsedResult?.validation) {
    return parsedResult.validation;
  }
  if (!parsedResult?.parsed || !meta?.seed) {
    return { ok: true, errors: [] };
  }
  return validatePlanReviewResult(parsedResult.parsed, meta.seed);
}

function appendPlanReviewRawOutput(lines, rawOutput, heading = "Raw final message:") {
  if (!rawOutput) {
    return;
  }
  lines.push("", heading, "", "```text", rawOutput, "```");
}

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
  return (
    parsedResult?.readiness ??
    derivePlanReviewReadiness({
      parsed: parsedResult?.parsed ?? null,
      validation,
      policyViolation
    })
  );
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

export function renderPlanReviewResult(parsedResult, meta = {}) {
  const planPath = meta.planPath ?? meta.seed?.normalized_plan_path ?? "unknown";
  const policyViolation = parsedResult?.policyViolation ?? null;
  if (policyViolation?.violated) {
    const readiness = resolvePlanReviewReadiness(parsedResult, parsedResult?.validation, policyViolation);
    const lines = [
      "# Codex Plan Review Policy Failure",
      "",
      `Plan: ${planPath}`,
      ""
    ];
    appendPlanReviewReadiness(lines, readiness);
    lines.push(
      "",
      "Codex violated the plan-review read-only policy. The stored result is marked failed."
    );

    if (policyViolation.forbiddenCommands?.length) {
      lines.push("", "Forbidden commands:");
      for (const command of policyViolation.forbiddenCommands) {
        lines.push(`- ${command.command}`);
      }
    }

    if (policyViolation.fileChanges?.length) {
      lines.push("", "Unexpected file changes:");
      for (const change of policyViolation.fileChanges) {
        const paths = (change.changes ?? []).map((entry) => entry.path).filter(Boolean).join(", ");
        lines.push(`- ${paths || "file change item"}`);
      }
    }

    appendPlanReviewRawOutput(lines, parsedResult.rawOutput, "Captured output:");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  if (!parsedResult?.parsed) {
    const validation = parsedResult?.validation ?? {
      ok: false,
      errors: parsedResult?.parseError ? [parsedResult.parseError] : ["Missing structured plan-review result."]
    };
    const readiness = resolvePlanReviewReadiness(parsedResult, validation, policyViolation);
    const lines = [
      "# Codex Plan Review",
      "",
      `Plan: ${planPath}`,
      ""
    ];
    appendPlanReviewReadiness(lines, readiness);
    lines.push(
      "",
      "Codex did not return valid structured JSON.",
      "",
      `- Parse error: ${parsedResult?.parseError}`
    );
    appendPlanReviewRawOutput(lines, parsedResult?.rawOutput);
    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult?.reasoningSummary);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const validation = normalizePlanReviewValidation(parsedResult, meta);
  if (!validation.ok) {
    const readiness = resolvePlanReviewReadiness(parsedResult, validation, policyViolation);
    const lines = [
      "# Codex Plan Review",
      "",
      `Plan: ${planPath}`,
      ""
    ];
    appendPlanReviewReadiness(lines, readiness);
    lines.push(
      "",
      "Codex returned JSON with an unexpected plan-review shape.",
      "",
      "Validation errors:"
    );
    for (const error of validation.errors) {
      lines.push(`- ${error}`);
    }
    appendPlanReviewRawOutput(lines, parsedResult.rawOutput);
    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const data = parsedResult.parsed;
  const readiness = resolvePlanReviewReadiness(parsedResult, validation, policyViolation);
  const findings = [...data.findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const lines = [
    "# Codex Plan Review",
    "",
    `Plan: ${planPath}`,
    `Verdict: ${data.verdict}`
  ];
  appendPlanReviewReadiness(lines, readiness);
  lines.push(
    "",
    data.summary,
    ""
  );

  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    lines.push("| Severity | Readiness effect | Re-review | Finding | Location |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const finding of findings) {
      lines.push(
        `| ${escapeMarkdownCell(finding.severity)} | ${escapeMarkdownCell(finding.readiness_effect)} | ${finding.requires_re_review ? "yes" : "no"} | ${escapeMarkdownCell(finding.title)} | ${escapeMarkdownCell(formatPlanLineRange(finding))} |`
      );
    }

    lines.push("");
    for (const finding of findings) {
      lines.push(`### ${finding.title}`);
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Readiness effect: ${finding.readiness_effect}`);
      lines.push(`- Requires re-review: ${finding.requires_re_review ? "yes" : "no"}`);
      lines.push(`- Derived action: ${formatPlanReviewFindingAction(finding)}`);
      lines.push(`- Location: ${formatPlanLineRange(finding)}`);
      lines.push(`- Risk: ${finding.risk}`);
      lines.push(`- Recommendation: ${finding.recommendation}`);
      if (finding.evidence?.length) {
        lines.push("- Evidence:");
        for (const entry of finding.evidence) {
          lines.push(`  - ${formatEvidenceRef(entry)}: ${entry.summary}`);
        }
      }
      if (finding.options?.length) {
        lines.push("- Options:");
        for (const option of finding.options) {
          lines.push(`  - ${option.title}: ${option.change} Tradeoff: ${option.tradeoff}`);
        }
      }
      lines.push("");
    }
  }

  if (data.requires_verify.length > 0) {
    lines.push("", "Requires verify:");
    for (const item of data.requires_verify) {
      lines.push(`- ${item.blocks_approval ? "[blocks approval] " : ""}${item.question}`);
      lines.push(`  Suggested check: ${item.suggested_check}`);
      lines.push(`  Why it matters: ${item.why_it_matters}`);
    }
  }

  if (data.coverage.length > 0) {
    lines.push("", "Coverage:");
    for (const item of data.coverage) {
      const evidence = item.evidence?.length ? ` Evidence: ${item.evidence.join(", ")}.` : "";
      const notes = item.notes ? ` ${item.notes}` : "";
      lines.push(`- ${item.area}: ${item.status}.${evidence}${notes}`);
    }
  }

  if (data.residual_risks.length > 0) {
    lines.push("", "Residual risks:");
    for (const risk of data.residual_risks) {
      lines.push(`- ${risk}`);
    }
  }

  appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderNativeReviewResult(result, meta) {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const lines = [
    `# Codex ${meta.reviewLabel}`,
    "",
    `Target: ${meta.targetLabel}`,
    ""
  ];

  if (stdout) {
    lines.push(stdout);
  } else if (result.status === 0) {
    lines.push("Codex review completed without any stdout output.");
  } else {
    lines.push("Codex review failed.");
  }

  if (stderr) {
    lines.push("", "stderr:", "", "```text", stderr, "```");
  }

  appendReasoningSection(lines, meta.reasoningSummary);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderTaskResult(parsedResult, meta) {
  const rawOutput = typeof parsedResult?.rawOutput === "string" ? parsedResult.rawOutput : "";
  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  }

  const message = String(parsedResult?.failureMessage ?? "").trim() || "Codex did not return a final message.";
  return `${message}\n`;
}

export function renderStatusReport(report) {
  const lines = [
    "# Codex Status",
    "",
    `Session runtime: ${report.sessionRuntime.label}`,
    `Review gate: ${report.config.stopReviewGate ? "enabled" : "disabled"}`,
    ""
  ];

  if (report.running.length > 0) {
    appendActiveJobsTable(lines, report.running);
    lines.push("");
    lines.push("Live details:");
    for (const job of report.running) {
      pushJobDetails(lines, job, {
        showElapsed: true,
        showLog: true
      });
    }
    lines.push("");
  }

  if (report.latestFinished) {
    lines.push("Latest finished:");
    pushJobDetails(lines, report.latestFinished, {
      showDuration: true,
      showLog: report.latestFinished.status === "failed"
    });
    lines.push("");
  }

  if (report.recent.length > 0) {
    lines.push("Recent jobs:");
    for (const job of report.recent) {
      pushJobDetails(lines, job, {
        showDuration: true,
        showLog: job.status === "failed"
      });
    }
    lines.push("");
  } else if (report.running.length === 0 && !report.latestFinished) {
    lines.push("No jobs recorded yet.", "");
  }

  if (report.needsReview) {
    lines.push("The stop-time review gate is enabled.");
    lines.push("Ending the session will trigger a fresh Codex adversarial review and block if it finds issues.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderJobStatusReport(job) {
  const lines = ["# Codex Job Status", ""];
  pushJobDetails(lines, job, {
    showElapsed: job.status === "queued" || job.status === "running",
    showDuration: job.status !== "queued" && job.status !== "running",
    showLog: true,
    showCancelHint: true,
    showResultHint: true,
    showReviewHint: true
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderStoredJobResult(job, storedJob) {
  const threadId = storedJob?.threadId ?? job.threadId ?? null;
  const resumeCommand = threadId ? `codex resume ${threadId}` : null;
  if (isStructuredReviewStoredResult(storedJob) && storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nCodex session ID: ${threadId}\nResume in Codex: ${resumeCommand}\n`;
  }

  const rawOutput =
    (typeof storedJob?.result?.rawOutput === "string" && storedJob.result.rawOutput) ||
    (typeof storedJob?.result?.codex?.stdout === "string" && storedJob.result.codex.stdout) ||
    "";
  if (rawOutput) {
    const output = rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nCodex session ID: ${threadId}\nResume in Codex: ${resumeCommand}\n`;
  }

  if (storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nCodex session ID: ${threadId}\nResume in Codex: ${resumeCommand}\n`;
  }

  const lines = [
    `# ${job.title ?? "Codex Result"}`,
    "",
    `Job: ${job.id}`,
    `Status: ${job.status}`
  ];

  if (threadId) {
    lines.push(`Codex session ID: ${threadId}`);
    lines.push(`Resume in Codex: ${resumeCommand}`);
  }

  if (job.summary) {
    lines.push(`Summary: ${job.summary}`);
  }

  if (job.errorMessage) {
    lines.push("", job.errorMessage);
  } else if (storedJob?.errorMessage) {
    lines.push("", storedJob.errorMessage);
  } else {
    lines.push("", "No captured result payload was stored for this job.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderCancelReport(job) {
  const lines = [
    "# Codex Cancel",
    "",
    `Cancelled ${job.id}.`,
    ""
  ];

  if (job.title) {
    lines.push(`- Title: ${job.title}`);
  }
  if (job.summary) {
    lines.push(`- Summary: ${job.summary}`);
  }
  lines.push("- Check `/codex:status` for the updated queue.");

  return `${lines.join("\n").trimEnd()}\n`;
}
