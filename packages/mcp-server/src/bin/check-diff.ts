import { execFileSync } from "child_process";
import { TracebackApiClient } from "../client";
import { CheckChangeAgainstDecisionsResponse } from "@traceback/shared-types";

export interface CheckDiffCliOptions {
  repoId?: string;
  workspaceId?: string;
  apiUrl?: string;
  token?: string;
  staged?: boolean;
  base?: string;
  description?: string;
  json?: boolean;
  failOnConflict?: boolean;
  help?: boolean;
}

export function parseCheckDiffArgs(args: string[]): CheckDiffCliOptions {
  const options: CheckDiffCliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--repo" && i + 1 < args.length) {
      options.repoId = args[++i];
    } else if (arg === "--workspace" && i + 1 < args.length) {
      options.workspaceId = args[++i];
    } else if (arg === "--api-url" && i + 1 < args.length) {
      options.apiUrl = args[++i];
    } else if (arg === "--token" && i + 1 < args.length) {
      options.token = args[++i];
    } else if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "--base" && i + 1 < args.length) {
      options.base = args[++i];
    } else if (arg === "--description" && i + 1 < args.length) {
      options.description = args[++i];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--fail-on-conflict") {
      options.failOnConflict = true;
    }
  }

  return options;
}

export function getLocalGitDiff(staged?: boolean, base?: string): string {
  const gitArgs: string[] = ["diff"];
  if (staged) {
    gitArgs.push("--cached");
  } else if (base) {
    gitArgs.push(base);
  }

  try {
    const output = execFileSync("git", gitArgs, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return output.trim();
  } catch (err: any) {
    throw new Error(
      `Failed to execute git diff: ${err.message || String(err)}`,
    );
  }
}

export function extractTargetFilesFromDiff(diffText: string): string[] {
  const files: string[] = [];
  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/diff --git a\/(.+)\s+b\/(.+)/);
      if (match && match[2]) {
        files.push(match[2]);
      }
    }
  }
  return Array.from(new Set(files));
}

export function formatTerminalReport(
  res: CheckChangeAgainstDecisionsResponse,
): string {
  const lines: string[] = [];
  lines.push(
    "================================================================================",
  );
  lines.push(" TRACEBACK ADVISORY PRE-PUSH AUDIT");
  lines.push(
    "================================================================================",
  );

  let statusBadge = `[${res.advisoryStatus}]`;
  if (res.advisoryStatus === "NO_CONFLICT_DETECTED") {
    statusBadge = `\x1b[32m${statusBadge}\x1b[0m`; // Green
  } else if (res.advisoryStatus === "CONFLICT_DETECTED") {
    statusBadge = `\x1b[31m${statusBadge}\x1b[0m`; // Red
  } else if (res.advisoryStatus === "POTENTIAL_RISK") {
    statusBadge = `\x1b[33m${statusBadge}\x1b[0m`; // Yellow
  }

  lines.push(` Status:             ${statusBadge}`);
  lines.push(` Summary:            ${res.summary}`);
  lines.push(` Inspected Sources:  ${res.inspectedSourcesCount}`);
  lines.push(` Evaluated At:       ${res.evaluatedAt}`);

  if (res.conflicts && res.conflicts.length > 0) {
    lines.push("\n--- HISTORICAL CONFLICTS / CONSTRAINTS ---");
    res.conflicts.forEach((c, idx) => {
      lines.push(
        `[${idx + 1}] ${c.historicalConstraint} (Severity: ${c.severity})`,
      );
      lines.push(`    Rationale:          ${c.explanation}`);
      lines.push(`    Severity Basis:     ${c.severityBasis}`);
      lines.push(`    Recommended Review: ${c.recommendedFollowUp}`);
      if (c.supportingEvidence && c.supportingEvidence.length > 0) {
        lines.push("    Evidence Citations:");
        c.supportingEvidence.forEach((ev) => {
          lines.push(
            `      * [${ev.sourceType}] ${ev.referenceKey}: ${ev.title}${
              ev.url ? ` (${ev.url})` : ""
            }`,
          );
        });
      }
    });
  }

  if (res.limitations && res.limitations.length > 0) {
    lines.push("\n--- LIMITATIONS & BOUNDARIES ---");
    res.limitations.forEach((l) => lines.push(`  - ${l}`));
  }

  lines.push(
    "\n--------------------------------------------------------------------------------",
  );
  lines.push(" ADVISORY NOTICE:");
  lines.push(
    ` ${
      res.advisoryNotice ||
      "This analysis is advisory only. Traceback does not block merges, approve pull requests, or alter source code. Human review is required."
    }`,
  );
  lines.push(
    "================================================================================",
  );

  return lines.join("\n");
}

export async function runCheckDiff(args: string[]): Promise<number> {
  const options = parseCheckDiffArgs(args);

  if (options.help) {
    console.log(`
Traceback CLI - Pre-Push Advisory Change Check

Usage: traceback check-diff [options]

Options:
  --repo <id>             Target repository ID (or set TRACEBACK_REPO_ID)
  --workspace <id>        Target workspace ID (or set TRACEBACK_WORKSPACE_ID)
  --api-url <url>         API base URL (default: http://localhost:3001/api)
  --token <token>         API authentication token (or set TRACEBACK_API_TOKEN)
  --staged                Inspect staged changes only (git diff --staged)
  --base <ref>            Compare against specific base branch/commit (e.g. origin/main)
  --description <text>    Summary of intended change to enrich advisory evaluation
  --json                  Output raw JSON response for CI/CD scripting
  --fail-on-conflict      Exit with code 2 if historical conflict detected (default: non-blocking 0)
  -h, --help              Display this help message

Advisory Note:
  Traceback pre-push checks are advisory. They inform engineers of historical decisions without blocking merges unless --fail-on-conflict is passed.
`);
    return 0;
  }

  const apiUrl =
    options.apiUrl ||
    process.env.TRACEBACK_API_URL ||
    "http://localhost:3001/api";
  const token = options.token || process.env.TRACEBACK_API_TOKEN;
  const workspaceId = options.workspaceId || process.env.TRACEBACK_WORKSPACE_ID;
  const repoId = options.repoId || process.env.TRACEBACK_REPO_ID;

  // 1. Get git diff
  let diff = "";
  try {
    diff = getLocalGitDiff(options.staged, options.base);
  } catch (err: any) {
    console.error(
      `[traceback check-diff] Error reading git diff: ${err.message}`,
    );
    return 1;
  }

  if (!diff && !options.description) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "NO_DIFF",
          message: "No local git diff changes detected.",
        }),
      );
    } else {
      console.log(
        "\n[traceback check-diff] No local git diff changes detected. Working tree clean.\n",
      );
    }
    return 0;
  }

  if (!workspaceId || !repoId) {
    console.error(
      "\n[traceback check-diff] Error: Missing workspace ID or repository ID.\n" +
        "Provide them via --workspace <id> and --repo <id> or set TRACEBACK_WORKSPACE_ID and TRACEBACK_REPO_ID.\n",
    );
    return 1;
  }

  const client = new TracebackApiClient({
    apiUrl,
    apiToken: token,
  });

  const targetFiles = extractTargetFilesFromDiff(diff);

  try {
    const result = await client.checkChangeAgainstDecisions({
      workspaceId,
      repositoryId: repoId,
      diff,
      changeDescription: options.description,
      targetFilePaths: targetFiles,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatTerminalReport(result));
    }

    if (
      options.failOnConflict &&
      result.advisoryStatus === "CONFLICT_DETECTED"
    ) {
      return 2;
    }

    return 0;
  } catch (err: any) {
    console.error(`[traceback check-diff] API check failed: ${err.message}`);
    return 1;
  }
}
