import {
  parseCheckDiffArgs,
  extractTargetFilesFromDiff,
  formatTerminalReport,
} from "../bin/check-diff";
import { CheckChangeAgainstDecisionsResponse } from "@traceback/shared-types";

describe("check-diff CLI helpers", () => {
  it("should parse CLI arguments correctly", () => {
    const args = [
      "--repo",
      "repo-123",
      "--workspace",
      "ws-456",
      "--api-url",
      "http://localhost:3001/api",
      "--token",
      "tb_tok_xyz",
      "--staged",
      "--fail-on-conflict",
      "--description",
      "Refactored concurrency locks",
      "--json",
    ];

    const parsed = parseCheckDiffArgs(args);
    expect(parsed.repoId).toBe("repo-123");
    expect(parsed.workspaceId).toBe("ws-456");
    expect(parsed.apiUrl).toBe("http://localhost:3001/api");
    expect(parsed.token).toBe("tb_tok_xyz");
    expect(parsed.staged).toBe(true);
    expect(parsed.failOnConflict).toBe(true);
    expect(parsed.description).toBe("Refactored concurrency locks");
    expect(parsed.json).toBe(true);
  });

  it("should extract modified target files from diff", () => {
    const diff = `diff --git a/src/table.ts b/src/table.ts
index 123456..789012 100644
--- a/src/table.ts
+++ b/src/table.ts
@@ -10,3 +10,4 @@
+const x = 1;
diff --git a/src/auth/guard.ts b/src/auth/guard.ts
index abcdef..ghijkl 100644
--- a/src/auth/guard.ts
+++ b/src/auth/guard.ts`;

    const files = extractTargetFilesFromDiff(diff);
    expect(files).toEqual(["src/table.ts", "src/auth/guard.ts"]);
  });

  it("should format a human-readable terminal report with advisory notice", () => {
    const mockResponse: CheckChangeAgainstDecisionsResponse = {
      advisoryStatus: "CONFLICT_DETECTED",
      summary: "Detected 1 conflict with recorded decisions.",
      conflicts: [
        {
          conflictId: "c-1",
          historicalConstraint: "Mutex Lock Invariant",
          severity: "HIGH",
          severityBasis: "Historical race condition recorded.",
          explanation: "Proposed change removes mutex locking.",
          supportingEvidence: [
            {
              id: "ev-1",
              sourceType: "COMMIT",
              referenceKey: "a1b2c3d",
              title: "fix: add mutex lock to table render",
              author: "Engineering",
              timestamp: "2026-01-01T00:00:00Z",
              url: "https://github.com/example/repo/commit/a1b2c3d",
            },
          ],
          recommendedFollowUp: "Retain mutex lock or verify concurrency.",
        },
      ],
      advisoryNotice:
        "This analysis is advisory only. Traceback does not block merges, approve pull requests, or alter source code. Human review is required.",
      limitations: ["No ADRs found for component."],
      inspectedSourcesCount: 5,
      evaluatedAt: "2026-11-22T06:00:00.000Z",
      repositoryId: "repo-123",
    };

    const report = formatTerminalReport(mockResponse);
    expect(report).toContain("TRACEBACK ADVISORY PRE-PUSH AUDIT");
    expect(report).toContain("CONFLICT_DETECTED");
    expect(report).toContain("Mutex Lock Invariant");
    expect(report).toContain("fix: add mutex lock to table render");
    expect(report).toContain("ADVISORY NOTICE:");
    expect(report).toContain(
      "This analysis is advisory only. Traceback does not block merges, approve pull requests, or alter source code.",
    );
  });

  it("should parse --help flag", () => {
    const parsedShort = parseCheckDiffArgs(["-h"]);
    expect(parsedShort.help).toBe(true);

    const parsedLong = parseCheckDiffArgs(["--help"]);
    expect(parsedLong.help).toBe(true);
  });

  it("should parse --base flag for git diff comparison", () => {
    const parsed = parseCheckDiffArgs(["--base", "origin/main"]);
    expect(parsed.base).toBe("origin/main");
  });

  it("should format clean report when no conflict is detected", () => {
    const mockResponse: CheckChangeAgainstDecisionsResponse = {
      advisoryStatus: "NO_CONFLICT_DETECTED",
      summary: "No historical decision conflicts detected in diff.",
      conflicts: [],
      advisoryNotice:
        "This analysis is advisory only. Traceback does not block merges, approve pull requests, or alter source code.",
      limitations: [],
      inspectedSourcesCount: 8,
      evaluatedAt: "2026-11-22T06:00:00.000Z",
      repositoryId: "repo-123",
    };

    const report = formatTerminalReport(mockResponse);
    expect(report).toContain("NO_CONFLICT_DETECTED");
    expect(report).toContain(
      "No historical decision conflicts detected in diff.",
    );
    expect(report).toContain("ADVISORY NOTICE:");
  });
});
