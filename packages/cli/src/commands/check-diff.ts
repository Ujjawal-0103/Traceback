import { execFile } from "node:child_process";
import {
  HistoricalIntentCheckSessionDto,
  HistoricalIntentOutcome,
  IntentConflictItem,
  EvidenceReference,
} from "@traceback/shared-types";

export interface CheckDiffOptions {
  staged?: boolean;
  base?: string;
  workspace?: string;
  repo?: string;
  json?: boolean;
  apiUrl?: string;
  cwd?: string;
  fetchFn?: typeof fetch;
  execFileFn?: typeof execFile;
  logFn?: (msg: string) => void;
  errorFn?: (msg: string) => void;
}

export interface GitDiffResult {
  diff: string;
  changedFiles: string[];
  error?: string;
}

export interface CheckDiffJsonResult {
  status:
    | "OK"
    | "CONFLICT_DETECTED"
    | "POTENTIAL_RISK"
    | "INSUFFICIENT_CONTEXT"
    | "NO_CHANGES";
  outcome: HistoricalIntentOutcome | "NO_CHANGES";
  sessionId?: string;
  advisoryNotice: string;
  summary: string;
  filesChanged: string[];
  diffLength: number;
  conflicts: IntentConflictItem[];
  supportingEvidence: EvidenceReference[];
  inspectedSourcesCount: number;
  evaluatedAt: string;
  workspaceId: string;
  repositoryId: string;
  disclaimer: string;
}

export function parseCheckDiffArgs(argv: string[]): CheckDiffOptions {
  const options: CheckDiffOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--staged" || arg === "-s") {
      options.staged = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--base" || arg === "-b") {
      options.base = argv[++i];
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
    } else if (arg === "--workspace" || arg === "-w") {
      options.workspace = argv[++i];
    } else if (arg.startsWith("--workspace=")) {
      options.workspace = arg.slice("--workspace=".length);
    } else if (arg === "--repo" || arg === "-r") {
      options.repo = argv[++i];
    } else if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
    } else if (arg === "--api-url") {
      options.apiUrl = argv[++i];
    } else if (arg.startsWith("--api-url=")) {
      options.apiUrl = arg.slice("--api-url=".length);
    }
  }
  return options;
}

/**
 * Safely executes git commands using child_process.execFile with shell: false.
 * Extracts unified diff and list of modified tracked file paths.
 */
export async function executeGitDiff(options: {
  staged?: boolean;
  base?: string;
  cwd?: string;
  execFileFn?: typeof execFile;
}): Promise<GitDiffResult> {
  const execFileImpl = options.execFileFn || execFile;
  const cwd = options.cwd || process.cwd();

  const diffArgs: string[] = ["diff", "--no-color"];
  const fileArgs: string[] = ["diff", "--name-only", "--no-color"];

  if (options.base) {
    if (options.staged) {
      diffArgs.push("--staged", options.base);
      fileArgs.push("--staged", options.base);
    } else {
      diffArgs.push(options.base);
      fileArgs.push(options.base);
    }
  } else if (options.staged) {
    diffArgs.push("--staged");
    fileArgs.push("--staged");
  }

  const runCommand = (
    args: string[],
  ): Promise<{ stdout: string; stderr: string; error?: Error }> => {
    return new Promise((resolve) => {
      execFileImpl(
        "git",
        args,
        { shell: false, cwd, maxBuffer: 15 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ? stdout.toString() : "",
            stderr: stderr ? stderr.toString() : "",
            error: error || undefined,
          });
        },
      );
    });
  };

  const [diffRes, filesRes] = await Promise.all([
    runCommand(diffArgs),
    runCommand(fileArgs),
  ]);

  if (diffRes.error) {
    return {
      diff: "",
      changedFiles: [],
      error: diffRes.stderr || diffRes.error.message,
    };
  }

  const changedFiles = filesRes.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    diff: diffRes.stdout,
    changedFiles,
  };
}

export function formatTerminalOutput(result: CheckDiffJsonResult): string {
  const divider =
    "======================================================================";
  const subDivider =
    "----------------------------------------------------------------------";
  const lines: string[] = [];

  lines.push(divider);
  lines.push(" TRACEBACK ADVISORY INTENT CHECK");
  lines.push(divider);

  if (result.sessionId) {
    lines.push(`  Session ID      : ${result.sessionId}`);
  }
  lines.push(`  Advisory Status : ${result.outcome}`);
  lines.push(`  Summary         : ${result.summary}`);
  lines.push(`  Workspace ID    : ${result.workspaceId}`);
  lines.push(`  Repository ID   : ${result.repositoryId}`);
  lines.push(
    `  Files Changed   : ${result.filesChanged.length > 0 ? result.filesChanged.join(", ") : "(none)"} (${result.filesChanged.length} file(s), ${result.diffLength} chars)`,
  );

  if (result.conflicts && result.conflicts.length > 0) {
    lines.push("");
    lines.push(subDivider);
    lines.push(
      ` CONFLICTING DECISIONS & INVARIANTS (${result.conflicts.length} detected)`,
    );
    lines.push(subDivider);

    result.conflicts.forEach((c, idx) => {
      lines.push(`  [${c.severity || "MEDIUM"}] ${c.title}`);
      if (c.rationale) {
        lines.push(`    - Explanation   : ${c.rationale}`);
      }
      if (c.unestablishedContext) {
        lines.push(`    - Basis / Scope : ${c.unestablishedContext}`);
      }
      if (c.recommendedReview) {
        lines.push(`    - Action        : ${c.recommendedReview}`);
      }
      if (c.supportingEvidence && c.supportingEvidence.length > 0) {
        lines.push(`    - Supporting Evidence:`);
        c.supportingEvidence.forEach((ev) => {
          lines.push(
            `      * [${ev.sourceType || "DOC"}] ${ev.referenceKey || ""}: "${ev.title}"`,
          );
          if (ev.filePath) {
            lines.push(`        File: ${ev.filePath}`);
          }
        });
      }
      if (idx < result.conflicts.length - 1) {
        lines.push("");
      }
    });
  }

  if (result.supportingEvidence && result.supportingEvidence.length > 0) {
    lines.push("");
    lines.push(subDivider);
    lines.push(
      ` HISTORICAL EVIDENCE REFERENCES (${result.supportingEvidence.length} items)`,
    );
    lines.push(subDivider);
    result.supportingEvidence.forEach((ev, idx) => {
      lines.push(`  ${idx + 1}. [${ev.sourceType || "RECORD"}] ${ev.title}`);
      if (ev.referenceKey) {
        lines.push(`     Ref : ${ev.referenceKey}`);
      }
      if (ev.filePath) {
        lines.push(`     Path: ${ev.filePath}`);
      }
    });
  }

  lines.push("");
  lines.push(subDivider);
  lines.push(" ADVISORY NOTICE & DISCLAIMER");
  lines.push(subDivider);
  lines.push(`  ${result.advisoryNotice}`);
  lines.push(`  ${result.disclaimer}`);
  lines.push(divider);

  return lines.join("\n");
}

export async function checkDiff(
  options: CheckDiffOptions = {},
): Promise<CheckDiffJsonResult> {
  const log = options.logFn || console.log;
  const fetchImpl = options.fetchFn || globalThis.fetch;

  const workspaceId =
    options.workspace ||
    process.env.TRACEBACK_WORKSPACE_ID ||
    process.env.WORKSPACE_ID ||
    "default";

  const repositoryId =
    options.repo ||
    process.env.TRACEBACK_REPOSITORY_ID ||
    process.env.TRACEBACK_REPO_ID ||
    process.env.REPOSITORY_ID ||
    "default";

  const rawApiUrl =
    options.apiUrl ||
    process.env.TRACEBACK_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://127.0.0.1:3001/api";

  const apiUrl = rawApiUrl.replace(/\/+$/, "");
  const token =
    process.env.TRACEBACK_API_TOKEN ||
    process.env.TRACEBACK_TOKEN ||
    process.env.API_TOKEN ||
    "";

  // 1. Execute safe git diff extraction
  const gitResult = await executeGitDiff({
    staged: options.staged,
    base: options.base,
    cwd: options.cwd,
    execFileFn: options.execFileFn,
  });

  const evaluatedAt = new Date().toISOString();

  // 2. Handle git execution failures
  if (gitResult.error) {
    const errorResult: CheckDiffJsonResult = {
      status: "INSUFFICIENT_CONTEXT",
      outcome: "INSUFFICIENT_CONTEXT",
      advisoryNotice:
        "Failed to read git repository diff. Historical engineering rationale cannot be evaluated without diff context.",
      summary: `Git command failed: ${gitResult.error}. Human judgment is required.`,
      filesChanged: [],
      diffLength: 0,
      conflicts: [],
      supportingEvidence: [],
      inspectedSourcesCount: 0,
      evaluatedAt,
      workspaceId,
      repositoryId,
      disclaimer:
        "Traceback never marks changes as safe when diff context cannot be read. Strictly non-blocking advisory exit.",
    };

    if (options.json) {
      log(JSON.stringify(errorResult, null, 2));
    } else {
      log(formatTerminalOutput(errorResult));
    }
    process.exitCode = 0;
    return errorResult;
  }

  // 3. Handle empty diff (clean tree or clean staged index)
  if (!gitResult.diff.trim()) {
    const emptyResult: CheckDiffJsonResult = {
      status: "NO_CHANGES",
      outcome: "NO_CHANGES",
      advisoryNotice:
        "No modifications detected in target diff scope. No changes to evaluate against engineering decisions.",
      summary:
        "Target diff is empty. Working tree or staged index has no modified tracked files.",
      filesChanged: [],
      diffLength: 0,
      conflicts: [],
      supportingEvidence: [],
      inspectedSourcesCount: 0,
      evaluatedAt,
      workspaceId,
      repositoryId,
      disclaimer:
        "Advisory check complete. No changes detected to check against historical engineering decisions.",
    };

    if (options.json) {
      log(JSON.stringify(emptyResult, null, 2));
    } else {
      log(formatTerminalOutput(emptyResult));
    }
    process.exitCode = 0;
    return emptyResult;
  }

  // 4. Truncate diff if exceeding API boundary (25,000 max)
  let diffPayload = gitResult.diff;
  if (diffPayload.length > 24000) {
    diffPayload =
      diffPayload.slice(0, 24000) +
      "\n\n# [Diff truncated for advisory intent-check analysis]";
  }

  // 5. Query advisory intent-check API
  const endpoint = `${apiUrl}/workspaces/${encodeURIComponent(workspaceId)}/repositories/${encodeURIComponent(repositoryId)}/advisory/intent-check`;
  const primaryFile =
    gitResult.changedFiles[0] ||
    (gitResult.changedFiles.length > 0
      ? gitResult.changedFiles.slice(0, 5).join(", ")
      : undefined);

  let sessionDto: HistoricalIntentCheckSessionDto | null = null;
  let apiFailureReason = "";

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-workspace-id": workspaceId,
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        diff: diffPayload,
        filePath: primaryFile,
        changeDescription: `CLI check-diff inspection of ${gitResult.changedFiles.length} file(s)`,
      }),
    });

    if (response.ok) {
      sessionDto = (await response.json()) as HistoricalIntentCheckSessionDto;
    } else {
      let errText = "";
      try {
        const json = await response.json();
        errText = json.message || json.error || "";
      } catch {
        errText = await response.text().catch(() => "");
      }

      if (response.status === 401 || response.status === 403) {
        apiFailureReason = `Authentication required or invalid (HTTP ${response.status}). Set TRACEBACK_API_TOKEN in environment to query historical decisions.`;
      } else if (response.status === 404) {
        apiFailureReason = `Target workspace '${workspaceId}' or repository '${repositoryId}' was not found in Traceback database (HTTP 404).`;
      } else {
        apiFailureReason = `Traceback API returned HTTP ${response.status}: ${errText || response.statusText}`;
      }
    }
  } catch (err: any) {
    apiFailureReason = `Failed to connect to Traceback advisory API at ${apiUrl}: ${err?.message || String(err)}`;
  }

  // 6. Handle API failure or unreachable state with explicit INSUFFICIENT_CONTEXT abstention
  if (!sessionDto) {
    const fallbackResult: CheckDiffJsonResult = {
      status: "INSUFFICIENT_CONTEXT",
      outcome: "INSUFFICIENT_CONTEXT",
      advisoryNotice:
        "Historical rationale is missing or unavailable. Absence of evidence does not prove the change is risk-free. Human judgment is required.",
      summary: `${apiFailureReason} Traceback explicitly abstains and never falsely marks changes as 'safe'.`,
      filesChanged: gitResult.changedFiles,
      diffLength: gitResult.diff.length,
      conflicts: [],
      supportingEvidence: [],
      inspectedSourcesCount: 0,
      evaluatedAt,
      workspaceId,
      repositoryId,
      disclaimer:
        "This check is strictly advisory. Traceback does not block merges or commits. Manual review is required before merging.",
    };

    if (options.json) {
      log(JSON.stringify(fallbackResult, null, 2));
    } else {
      log(formatTerminalOutput(fallbackResult));
    }
    process.exitCode = 0;
    return fallbackResult;
  }

  // 7. Extract conflicts and evidence citations from successful API response
  const conflicts = sessionDto.conflicts || [];
  const allEvidence: EvidenceReference[] = [];
  const seenEvidenceIds = new Set<string>();

  for (const c of conflicts) {
    if (c.supportingEvidence) {
      for (const ev of c.supportingEvidence) {
        const key = ev.id || ev.referenceKey || ev.title;
        if (!seenEvidenceIds.has(key)) {
          seenEvidenceIds.add(key);
          allEvidence.push(ev);
        }
      }
    }
  }

  let status: CheckDiffJsonResult["status"] = "OK";
  if (sessionDto.outcome === "DOCUMENTED_CONFLICT") {
    status = "CONFLICT_DETECTED";
  } else if (sessionDto.outcome === "POTENTIAL_CONFLICT") {
    status = "POTENTIAL_RISK";
  } else if (sessionDto.outcome === "INSUFFICIENT_CONTEXT") {
    status = "INSUFFICIENT_CONTEXT";
  }

  const advisoryNotice =
    sessionDto.outcome === "INSUFFICIENT_CONTEXT"
      ? "NOTICE: No historical decisions, ADRs, or indexed constraints could be matched against this scope. Traceback explicitly abstains. Human judgment is required."
      : sessionDto.outcome === "DOCUMENTED_CONFLICT"
        ? "CRITICAL ADVISORY: Proposed code modifications conflict with recorded engineering decisions or historical invariants. Human review required."
        : sessionDto.outcome === "POTENTIAL_CONFLICT"
          ? "ADVISORY WARNING: Potential overlap with past decisions or candidate constraints detected. Architectural review recommended."
          : "ADVISORY: No direct conflicts with recorded historical decisions detected for this scope.";

  const finalResult: CheckDiffJsonResult = {
    status,
    outcome: sessionDto.outcome,
    sessionId: sessionDto.id,
    advisoryNotice,
    summary: sessionDto.summary,
    filesChanged: gitResult.changedFiles,
    diffLength: gitResult.diff.length,
    conflicts,
    supportingEvidence: allEvidence,
    inspectedSourcesCount: allEvidence.length + conflicts.length,
    evaluatedAt,
    workspaceId,
    repositoryId,
    disclaimer:
      "This analysis is strictly advisory. Traceback does not block merges, approve pull requests, or alter source code. Human review is required.",
  };

  if (options.json) {
    log(JSON.stringify(finalResult, null, 2));
  } else {
    log(formatTerminalOutput(finalResult));
  }

  // Enforce strictly non-blocking invariant
  process.exitCode = 0;
  return finalResult;
}

export const checkDiffCommand = {
  name: "check-diff",
  description:
    "Evaluate prospective git diff against historical engineering decisions and ADRs",
  run: async (argv: string[]): Promise<number> => {
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log("Usage: traceback check-diff [options]\n");
      console.log("Options:");
      console.log(
        "  --staged, -s          Inspect staged git changes (default: working-tree diff)",
      );
      console.log(
        "  --base <ref>, -b      Inspect diff against a base git reference (e.g., origin/main)",
      );
      console.log(
        "  --workspace <id>, -w  Target Traceback workspace ID (default: TRACEBACK_WORKSPACE_ID or 'default')",
      );
      console.log(
        "  --repo <id>, -r       Target repository ID (default: TRACEBACK_REPOSITORY_ID or 'default')",
      );
      console.log(
        "  --api-url <url>       Traceback backend API URL (default: TRACEBACK_API_URL or http://127.0.0.1:3001/api)",
      );
      console.log("  --json                Emit structured JSON output\n");
      console.log(
        "Note: traceback check-diff is strictly non-blocking and always exits with code 0.",
      );
      process.exitCode = 0;
      return 0;
    }

    const options = parseCheckDiffArgs(argv);
    await checkDiff(options);
    process.exitCode = 0;
    return 0;
  },
};
