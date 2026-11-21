import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TracebackApiClient } from "../client";
import {
  HistoricalIntentCheckSessionDto,
  HistoricalIntentOutcome,
  IntentConflictItem,
  EvidenceReference,
} from "@traceback/shared-types";

export const checkLocalDiffGuardrailSchema = {
  diff: z
    .string()
    .max(
      25000,
      "Diff exceeds 25,000 character limit. Supply a smaller patch or targeted file diff.",
    )
    .optional()
    .describe(
      "Optional unified diff or patch string if already captured by the agent",
    ),
  repoPath: z
    .string()
    .max(1000)
    .optional()
    .describe(
      "Optional absolute or relative path to local repository directory (default: current working directory)",
    ),
  staged: z
    .boolean()
    .optional()
    .describe(
      "If true, inspects staged changes (git diff --staged). Default: false (unstaged working-tree changes)",
    ),
  baseRef: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Optional base git reference to diff against (e.g., origin/main or HEAD~1)",
    ),
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Target workspace ID (falling back to TRACEBACK_WORKSPACE_ID or 'default')",
    ),
  repositoryId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Target repository ID (falling back to TRACEBACK_REPOSITORY_ID or 'default')",
    ),
};

export interface CheckDiffGuardrailResult {
  nonBlocking: true;
  advisoryStatus:
    | "INSUFFICIENT_CONTEXT"
    | "DOCUMENTED_CONFLICT"
    | "POTENTIAL_CONFLICT"
    | "POTENTIAL_RISK"
    | "NO_KNOWN_CONFLICT";
  outcome: HistoricalIntentOutcome | "INSUFFICIENT_CONTEXT";
  summary: string;
  filesChanged: string[];
  diffLength: number;
  conflicts: IntentConflictItem[];
  supportingEvidence: EvidenceReference[];
  humanReviewNotice: string;
  evaluatedAt: string;
  workspaceId: string;
  repositoryId: string;
  sessionId?: string;
}

export interface GitDiffCaptureResult {
  diff: string;
  changedFiles: string[];
  error?: string;
}

/**
 * Safely executes git diff via execFile with shell: false.
 */
export async function executeLocalGitDiff(options: {
  cwd: string;
  staged?: boolean;
  baseRef?: string;
  execFileFn?: typeof execFile;
}): Promise<GitDiffCaptureResult> {
  const execFileImpl = options.execFileFn || execFile;
  const cwd = options.cwd;

  const diffArgs: string[] = ["diff", "--no-color"];
  const fileArgs: string[] = ["diff", "--name-only", "--no-color"];

  if (options.baseRef) {
    if (options.staged) {
      diffArgs.push("--staged", options.baseRef);
      fileArgs.push("--staged", options.baseRef);
    } else {
      diffArgs.push(options.baseRef);
      fileArgs.push(options.baseRef);
    }
  } else if (options.staged) {
    diffArgs.push("--staged");
    fileArgs.push("--staged");
  }

  const runCmd = (
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
    runCmd(diffArgs),
    runCmd(fileArgs),
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

export async function handleCheckLocalDiffGuardrail(
  args: z.infer<z.ZodObject<typeof checkLocalDiffGuardrailSchema>>,
  client: TracebackApiClient,
  injectedExecFile?: typeof execFile,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const evaluatedAt = new Date().toISOString();

  const workspaceId =
    args.workspaceId ||
    process.env.TRACEBACK_WORKSPACE_ID ||
    process.env.WORKSPACE_ID ||
    "default";

  const repositoryId =
    args.repositoryId ||
    process.env.TRACEBACK_REPOSITORY_ID ||
    process.env.TRACEBACK_REPO_ID ||
    process.env.REPOSITORY_ID ||
    "default";

  let rawDiff = (args.diff || "").trim();
  let changedFiles: string[] = [];

  // 1. If diff not provided directly, execute safe local git diff
  if (!rawDiff) {
    let targetDir = process.cwd();
    if (args.repoPath) {
      const resolvedPath = path.resolve(args.repoPath);
      try {
        if (
          !fs.existsSync(resolvedPath) ||
          !fs.statSync(resolvedPath).isDirectory()
        ) {
          const pathErrorResult: CheckDiffGuardrailResult = {
            nonBlocking: true,
            advisoryStatus: "INSUFFICIENT_CONTEXT",
            outcome: "INSUFFICIENT_CONTEXT",
            summary: `Provided repository path does not exist or is not a directory: ${args.repoPath}`,
            filesChanged: [],
            diffLength: 0,
            conflicts: [],
            supportingEvidence: [],
            humanReviewNotice:
              "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Local diff context could not be read. Human review is required.",
            evaluatedAt,
            workspaceId,
            repositoryId,
          };
          return {
            content: [
              { type: "text", text: JSON.stringify(pathErrorResult, null, 2) },
            ],
          };
        }
        targetDir = resolvedPath;
      } catch (err: any) {
        const pathErrorResult: CheckDiffGuardrailResult = {
          nonBlocking: true,
          advisoryStatus: "INSUFFICIENT_CONTEXT",
          outcome: "INSUFFICIENT_CONTEXT",
          summary: `Failed to access repository directory: ${err?.message || String(err)}`,
          filesChanged: [],
          diffLength: 0,
          conflicts: [],
          supportingEvidence: [],
          humanReviewNotice:
            "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Local diff context could not be read. Human review is required.",
          evaluatedAt,
          workspaceId,
          repositoryId,
        };
        return {
          content: [
            { type: "text", text: JSON.stringify(pathErrorResult, null, 2) },
          ],
        };
      }
    }

    // Validate baseRef format to prevent malicious arguments
    if (args.baseRef && !/^[a-zA-Z0-9_\-\.\/@^~]+$/.test(args.baseRef)) {
      const invalidRefResult: CheckDiffGuardrailResult = {
        nonBlocking: true,
        advisoryStatus: "INSUFFICIENT_CONTEXT",
        outcome: "INSUFFICIENT_CONTEXT",
        summary: `Invalid git base reference format: ${args.baseRef}`,
        filesChanged: [],
        diffLength: 0,
        conflicts: [],
        supportingEvidence: [],
        humanReviewNotice:
          "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Invalid git reference. Human review is required.",
        evaluatedAt,
        workspaceId,
        repositoryId,
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(invalidRefResult, null, 2) },
        ],
      };
    }

    const gitResult = await executeLocalGitDiff({
      cwd: targetDir,
      staged: args.staged,
      baseRef: args.baseRef,
      execFileFn: injectedExecFile,
    });

    if (gitResult.error) {
      const gitErrorResult: CheckDiffGuardrailResult = {
        nonBlocking: true,
        advisoryStatus: "INSUFFICIENT_CONTEXT",
        outcome: "INSUFFICIENT_CONTEXT",
        summary: `Git command execution failed: ${gitResult.error}`,
        filesChanged: [],
        diffLength: 0,
        conflicts: [],
        supportingEvidence: [],
        humanReviewNotice:
          "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Local git history could not be diffed. Human review is required.",
        evaluatedAt,
        workspaceId,
        repositoryId,
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(gitErrorResult, null, 2) },
        ],
      };
    }

    rawDiff = gitResult.diff.trim();
    changedFiles = gitResult.changedFiles;
  }

  // 2. Handle empty diff (clean tree or clean staged index)
  if (!rawDiff) {
    const emptyResult: CheckDiffGuardrailResult = {
      nonBlocking: true,
      advisoryStatus: "INSUFFICIENT_CONTEXT",
      outcome: "INSUFFICIENT_CONTEXT",
      summary:
        "Target diff is empty. No code changes detected in local repository scope.",
      filesChanged: [],
      diffLength: 0,
      conflicts: [],
      supportingEvidence: [],
      humanReviewNotice:
        "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. No code changes were detected. Human review is required.",
      evaluatedAt,
      workspaceId,
      repositoryId,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(emptyResult, null, 2) }],
    };
  }

  // 3. Truncate diff safely if exceeding 24,000 characters
  let diffPayload = rawDiff;
  if (diffPayload.length > 24000) {
    diffPayload =
      diffPayload.slice(0, 24000) +
      "\n\n# [Diff truncated for advisory intent-check analysis]";
  }

  // 4. Query backend historical intent-check API
  let sessionDto: HistoricalIntentCheckSessionDto | null = null;
  let apiErrorMessage = "";

  try {
    sessionDto = await client.runHistoricalIntentCheck({
      workspaceId,
      repositoryId,
      diff: diffPayload,
      filePath: changedFiles[0],
      changeDescription: `MCP check_local_diff_guardrail analysis of ${changedFiles.length > 0 ? changedFiles.length : 1} file(s)`,
    });
  } catch (err: any) {
    apiErrorMessage = err?.message || String(err);
  }

  // 5. Handle API failure or unreachable state with explicit INSUFFICIENT_CONTEXT abstention
  if (!sessionDto) {
    const apiFailureResult: CheckDiffGuardrailResult = {
      nonBlocking: true,
      advisoryStatus: "INSUFFICIENT_CONTEXT",
      outcome: "INSUFFICIENT_CONTEXT",
      summary: `Failed to query historical decision memory: ${apiErrorMessage}. Traceback explicitly abstains and never falsely marks changes as safe.`,
      filesChanged: changedFiles,
      diffLength: rawDiff.length,
      conflicts: [],
      supportingEvidence: [],
      humanReviewNotice:
        "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Historical rationale is missing or unavailable. Absence of evidence does not prove change is safe. Human review is required.",
      evaluatedAt,
      workspaceId,
      repositoryId,
    };
    return {
      content: [
        { type: "text", text: JSON.stringify(apiFailureResult, null, 2) },
      ],
    };
  }

  // 6. Format successful result with humanReviewNotice
  const conflicts = sessionDto.conflicts || [];
  const allEvidence: EvidenceReference[] = [];
  const seenIds = new Set<string>();

  for (const c of conflicts) {
    if (c.supportingEvidence) {
      for (const ev of c.supportingEvidence) {
        const key = ev.id || ev.referenceKey || ev.title;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          allEvidence.push(ev);
        }
      }
    }
  }

  let advisoryStatus: CheckDiffGuardrailResult["advisoryStatus"] =
    "NO_KNOWN_CONFLICT";
  if (sessionDto.outcome === "DOCUMENTED_CONFLICT") {
    advisoryStatus = "DOCUMENTED_CONFLICT";
  } else if (sessionDto.outcome === "POTENTIAL_CONFLICT") {
    advisoryStatus = "POTENTIAL_RISK";
  } else if (sessionDto.outcome === "INSUFFICIENT_CONTEXT") {
    advisoryStatus = "INSUFFICIENT_CONTEXT";
  }

  let humanReviewNotice = "";
  if (advisoryStatus === "DOCUMENTED_CONFLICT") {
    humanReviewNotice =
      "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Proposed code change conflicts with documented historical engineering decisions or invariants. Human review is required before merging.";
  } else if (advisoryStatus === "POTENTIAL_RISK") {
    humanReviewNotice =
      "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Potential architectural risk or decision overlap detected. Human review is recommended.";
  } else if (advisoryStatus === "INSUFFICIENT_CONTEXT") {
    humanReviewNotice =
      "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. Historical rationale is missing or unavailable. Absence of historical evidence does not prove change is safe. Human judgment and review are required.";
  } else {
    humanReviewNotice =
      "Advisory guardrail notice: Traceback is an advisory guardrail, not an automated approval or rejection gate. No direct conflicts with recorded historical decisions were detected. Standard code review is recommended.";
  }

  const finalResult: CheckDiffGuardrailResult = {
    nonBlocking: true,
    advisoryStatus,
    outcome: sessionDto.outcome,
    summary: sessionDto.summary,
    filesChanged: changedFiles,
    diffLength: rawDiff.length,
    conflicts,
    supportingEvidence: allEvidence,
    humanReviewNotice,
    evaluatedAt,
    workspaceId,
    repositoryId,
    sessionId: sessionDto.id,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(finalResult, null, 2) }],
  };
}

export function registerCheckDiffGuardrailTool(
  server: McpServer,
  client: TracebackApiClient,
): void {
  server.tool(
    "check_local_diff_guardrail",
    "Advisory local git diff guardrail for AI coding assistants. Evaluates uncommitted or staged changes against recorded historical engineering decisions, ADRs, and invariants.",
    checkLocalDiffGuardrailSchema,
    async (args) => handleCheckLocalDiffGuardrail(args, client),
  );
}
