import {
  checkDiff,
  parseCheckDiffArgs,
  executeGitDiff,
  formatTerminalOutput,
  checkDiffCommand,
  CheckDiffOptions,
} from "./check-diff";

describe("traceback check-diff CLI", () => {
  const originalExitCode = process.exitCode;
  const mockLogs: string[] = [];
  const captureLog = (msg: string) => {
    mockLogs.push(msg);
  };

  beforeEach(() => {
    mockLogs.length = 0;
    process.exitCode = 0;
  });

  afterAll(() => {
    process.exitCode = originalExitCode;
  });

  describe("parseCheckDiffArgs", () => {
    it("parses short and long flags correctly", () => {
      const parsed1 = parseCheckDiffArgs(["--staged", "--json"]);
      expect(parsed1.staged).toBe(true);
      expect(parsed1.json).toBe(true);

      const parsed2 = parseCheckDiffArgs([
        "-s",
        "-b",
        "origin/main",
        "-w",
        "ws-123",
        "-r",
        "repo-456",
        "--api-url",
        "http://localhost:3001/api",
      ]);
      expect(parsed2.staged).toBe(true);
      expect(parsed2.base).toBe("origin/main");
      expect(parsed2.workspace).toBe("ws-123");
      expect(parsed2.repo).toBe("repo-456");
      expect(parsed2.apiUrl).toBe("http://localhost:3001/api");

      const parsed3 = parseCheckDiffArgs([
        "--base=HEAD~1",
        "--workspace=my-ws",
        "--repo=my-repo",
      ]);
      expect(parsed3.base).toBe("HEAD~1");
      expect(parsed3.workspace).toBe("my-ws");
      expect(parsed3.repo).toBe("my-repo");
    });
  });

  describe("git diff execution (staged vs unstaged vs --base)", () => {
    it("executes default unstaged working-tree diff", async () => {
      const executedCommands: string[][] = [];
      const mockExecFile: any = (
        file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        executedCommands.push(args);
        if (args.includes("--name-only")) {
          cb(null, "src/index.ts\nsrc/utils.ts\n", "");
        } else {
          cb(null, "diff --git a/src/index.ts b/src/index.ts\n+added", "");
        }
      };

      const result = await executeGitDiff({
        staged: false,
        execFileFn: mockExecFile,
      });

      expect(result.diff).toContain("+added");
      expect(result.changedFiles).toEqual(["src/index.ts", "src/utils.ts"]);
      expect(executedCommands).toContainEqual(["diff", "--no-color"]);
      expect(executedCommands).toContainEqual([
        "diff",
        "--name-only",
        "--no-color",
      ]);
    });

    it("executes staged diff when --staged is specified", async () => {
      const executedCommands: string[][] = [];
      const mockExecFile: any = (
        file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        executedCommands.push(args);
        if (args.includes("--name-only")) {
          cb(null, "src/auth/guard.ts\n", "");
        } else {
          cb(null, "diff --git a/src/auth/guard.ts\n+staged-line", "");
        }
      };

      const result = await executeGitDiff({
        staged: true,
        execFileFn: mockExecFile,
      });

      expect(result.diff).toContain("+staged-line");
      expect(result.changedFiles).toEqual(["src/auth/guard.ts"]);
      expect(executedCommands).toContainEqual([
        "diff",
        "--no-color",
        "--staged",
      ]);
      expect(executedCommands).toContainEqual([
        "diff",
        "--name-only",
        "--no-color",
        "--staged",
      ]);
    });

    it("executes base ref comparison when --base is specified", async () => {
      const executedCommands: string[][] = [];
      const mockExecFile: any = (
        file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        executedCommands.push(args);
        if (args.includes("--name-only")) {
          cb(null, "packages/cli/src/main.ts\n", "");
        } else {
          cb(null, "diff --git a/packages/cli/src/main.ts\n+base-diff", "");
        }
      };

      const result = await executeGitDiff({
        base: "origin/main",
        execFileFn: mockExecFile,
      });

      expect(result.diff).toContain("+base-diff");
      expect(executedCommands).toContainEqual([
        "diff",
        "--no-color",
        "origin/main",
      ]);
      expect(executedCommands).toContainEqual([
        "diff",
        "--name-only",
        "--no-color",
        "origin/main",
      ]);
    });

    it("handles combined --base and --staged flags", async () => {
      const executedCommands: string[][] = [];
      const mockExecFile: any = (
        file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        executedCommands.push(args);
        cb(null, "diff", "");
      };

      await executeGitDiff({
        base: "origin/main",
        staged: true,
        execFileFn: mockExecFile,
      });

      expect(executedCommands).toContainEqual([
        "diff",
        "--no-color",
        "--staged",
        "origin/main",
      ]);
    });
  });

  describe("empty diff handling", () => {
    it("prints clear notice and returns 0 without calling API when diff is empty", async () => {
      let apiCalled = false;
      const mockExecFile: any = (
        _file: string,
        _args: string[],
        _opts: any,
        cb: any,
      ) => {
        cb(null, "", "");
      };
      const mockFetch: any = async () => {
        apiCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      const result = await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockFetch,
        logFn: captureLog,
      });

      expect(apiCalled).toBe(false);
      expect(result.status).toBe("NO_CHANGES");
      expect(result.outcome).toBe("NO_CHANGES");
      expect(process.exitCode).toBe(0);
      expect(mockLogs.join("\n")).toContain("No modifications detected");
    });
  });

  describe("conflict output and terminal display", () => {
    it("formats and displays DOCUMENTED_CONFLICT with supporting evidence citations", async () => {
      const mockExecFile: any = (
        _file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        if (args.includes("--name-only")) {
          cb(null, "src/concurrency/lock.ts\n", "");
        } else {
          cb(null, "- mutex.lock();\n+ // lock removed\n", "");
        }
      };

      const mockSessionDto = {
        id: "intent-session-999",
        workspaceId: "ws-test",
        repositoryId: "repo-test",
        diff: "- mutex.lock();\n+ // lock removed\n",
        filePath: "src/concurrency/lock.ts",
        status: "COMPLETED",
        outcome: "DOCUMENTED_CONFLICT",
        summary: "Detected high-severity violation of Mutex Locking Invariant.",
        conflicts: [
          {
            id: "conflict-1",
            title: "Concurrency Synchronization & Mutex Locking Invariant",
            severity: "HIGH",
            outcome: "DOCUMENTED_CONFLICT",
            rationale:
              "Removal of mutex locking introduced race conditions and corruption.",
            unestablishedContext:
              "Protected memory state requires active synchronization guard.",
            recommendedReview:
              "Verify concurrency safety with stress tests or retain the mutex lock.",
            supportingEvidence: [
              {
                id: "ev-1",
                sourceType: "COMMIT",
                referenceKey: "c83b8a1",
                title: "fix: add mutex lock to prevent state corruption",
                filePath: "src/concurrency/lock.ts",
                url: "https://github.com/org/repo/commit/c83b8a1",
              },
              {
                id: "ev-2",
                sourceType: "DOCUMENTATION",
                referenceKey: "ADR-007",
                title: "ADR-007: Concurrency & Lock Invariants",
                filePath: "docs/adr/ADR-007.md",
                url: "",
              },
            ],
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockFetch: any = async () => ({
        ok: true,
        json: async () => mockSessionDto,
      });

      const result = await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockFetch,
        logFn: captureLog,
      });

      expect(result.status).toBe("CONFLICT_DETECTED");
      expect(result.outcome).toBe("DOCUMENTED_CONFLICT");
      expect(result.conflicts).toHaveLength(1);
      expect(result.supportingEvidence).toHaveLength(2);
      expect(process.exitCode).toBe(0);

      const logs = mockLogs.join("\n");
      expect(logs).toContain("DOCUMENTED_CONFLICT");
      expect(logs).toContain(
        "Concurrency Synchronization & Mutex Locking Invariant",
      );
      expect(logs).toContain(
        "Removal of mutex locking introduced race conditions",
      );
      expect(logs).toContain("fix: add mutex lock to prevent state corruption");
      expect(logs).toContain("ADR-007: Concurrency & Lock Invariants");
      expect(logs).toContain("This analysis is strictly advisory");
    });
  });

  describe("explicit abstention (INSUFFICIENT_CONTEXT)", () => {
    it("reports INSUFFICIENT_CONTEXT when API returns insufficient evidence and never reports safe", async () => {
      const mockExecFile: any = (
        _file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        if (args.includes("--name-only")) {
          cb(null, "src/new-feature.ts\n", "");
        } else {
          cb(null, "+ export const foo = 42;\n", "");
        }
      };

      const mockSessionDto = {
        id: "intent-session-abc",
        workspaceId: "ws-test",
        repositoryId: "repo-test",
        diff: "+ export const foo = 42;\n",
        filePath: "src/new-feature.ts",
        status: "COMPLETED",
        outcome: "INSUFFICIENT_CONTEXT",
        summary:
          "No historical decisions, ADRs, or indexed constraints found for target scope.",
        conflicts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockFetch: any = async () => ({
        ok: true,
        json: async () => mockSessionDto,
      });

      const result = await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockFetch,
        logFn: captureLog,
      });

      expect(result.status).toBe("INSUFFICIENT_CONTEXT");
      expect(result.outcome).toBe("INSUFFICIENT_CONTEXT");
      expect(process.exitCode).toBe(0);

      const logs = mockLogs.join("\n");
      expect(logs).toContain("INSUFFICIENT_CONTEXT");
      expect(logs).toContain("Traceback explicitly abstains");
      expect(logs).toContain("Human judgment is required");
      expect(logs).not.toContain("NO_CONFLICT_DETECTED");
    });
  });

  describe("API failure fallback and error resilience", () => {
    it("falls back to INSUFFICIENT_CONTEXT when backend API is unreachable", async () => {
      const mockExecFile: any = (
        _file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        if (args.includes("--name-only")) {
          cb(null, "src/config.ts\n", "");
        } else {
          cb(null, "+ const x = 1;\n", "");
        }
      };

      const mockFetch: any = async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:3001");
      };

      const result = await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockFetch,
        logFn: captureLog,
      });

      expect(result.status).toBe("INSUFFICIENT_CONTEXT");
      expect(result.outcome).toBe("INSUFFICIENT_CONTEXT");
      expect(result.summary).toContain("ECONNREFUSED");
      expect(process.exitCode).toBe(0);

      const logs = mockLogs.join("\n");
      expect(logs).toContain("INSUFFICIENT_CONTEXT");
      expect(logs).toContain(
        "Traceback explicitly abstains and never falsely marks changes as 'safe'",
      );
    });

    it("falls back to INSUFFICIENT_CONTEXT when API returns 401 Unauthorized", async () => {
      const mockExecFile: any = (
        _file: string,
        _args: string[],
        _opts: any,
        cb: any,
      ) => {
        cb(null, "+ change\n", "");
      };

      const mockFetch: any = async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ message: "Invalid session token" }),
      });

      const result = await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockFetch,
        logFn: captureLog,
      });

      expect(result.status).toBe("INSUFFICIENT_CONTEXT");
      expect(result.outcome).toBe("INSUFFICIENT_CONTEXT");
      expect(result.summary).toContain("Authentication required");
      expect(process.exitCode).toBe(0);
    });

    it("handles git execution failure gracefully", async () => {
      const mockExecFile: any = (
        _file: string,
        _args: string[],
        _opts: any,
        cb: any,
      ) => {
        cb(
          new Error("fatal: not a git repository"),
          "",
          "fatal: not a git repo",
        );
      };

      const result = await checkDiff({
        execFileFn: mockExecFile,
        logFn: captureLog,
      });

      expect(result.status).toBe("INSUFFICIENT_CONTEXT");
      expect(result.outcome).toBe("INSUFFICIENT_CONTEXT");
      expect(result.summary).toContain("fatal: not a git repo");
      expect(process.exitCode).toBe(0);
    });
  });

  describe("JSON output mode", () => {
    it("emits valid parseable JSON when --json flag is passed", async () => {
      const mockExecFile: any = (
        _file: string,
        _args: string[],
        _opts: any,
        cb: any,
      ) => {
        cb(null, "+ test\n", "");
      };

      const mockFetch: any = async () => ({
        ok: true,
        json: async () => ({
          id: "intent-json-1",
          outcome: "NO_KNOWN_CONFLICT",
          summary: "Clean evaluation.",
          conflicts: [],
        }),
      });

      const result = await checkDiff({
        json: true,
        execFileFn: mockExecFile,
        fetchFn: mockFetch,
        logFn: captureLog,
      });

      expect(result.outcome).toBe("NO_KNOWN_CONFLICT");
      expect(process.exitCode).toBe(0);

      const rawJson = mockLogs.join("\n");
      const parsed = JSON.parse(rawJson);
      expect(parsed.outcome).toBe("NO_KNOWN_CONFLICT");
      expect(parsed.summary).toBe("Clean evaluation.");
      expect(parsed.status).toBe("OK");
    });
  });

  describe("checkDiffCommand runner", () => {
    it("prints help and exits with 0 on --help flag", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const exitCode = await checkDiffCommand.run(["--help"]);
      expect(exitCode).toBe(0);
      expect(process.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Usage: traceback check-diff"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("STRICT NON-BLOCKING INVARIANT: process.exitCode is ALWAYS 0", () => {
    it("always sets process.exitCode to 0 across all possible execution pathways", async () => {
      // Pathway 1: Conflict detected
      const mockConflictFetch: any = async () => ({
        ok: true,
        json: async () => ({
          id: "s1",
          outcome: "DOCUMENTED_CONFLICT",
          summary: "Conflict found",
          conflicts: [
            {
              id: "c1",
              title: "Critical Invariant Violation",
              severity: "CRITICAL",
              outcome: "DOCUMENTED_CONFLICT",
              rationale: "Violation",
              supportingEvidence: [],
              recommendedReview: "Review",
            },
          ],
        }),
      });

      const mockExecFile: any = (
        _file: string,
        _args: string[],
        _opts: any,
        cb: any,
      ) => {
        cb(null, "+ modified line\n", "");
      };

      process.exitCode = 99; // Intentionally set to non-zero before call
      await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockConflictFetch,
        logFn: captureLog,
      });
      expect(process.exitCode).toBe(0);

      // Pathway 2: Insufficient context
      process.exitCode = 42;
      const mockInsufficientFetch: any = async () => ({
        ok: true,
        json: async () => ({
          id: "s2",
          outcome: "INSUFFICIENT_CONTEXT",
          summary: "No evidence",
          conflicts: [],
        }),
      });
      await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockInsufficientFetch,
        logFn: captureLog,
      });
      expect(process.exitCode).toBe(0);

      // Pathway 3: Backend unreachable error
      process.exitCode = 1;
      const mockFailFetch: any = async () => {
        throw new Error("Network down");
      };
      await checkDiff({
        execFileFn: mockExecFile,
        fetchFn: mockFailFetch,
        logFn: captureLog,
      });
      expect(process.exitCode).toBe(0);

      // Pathway 4: Empty diff
      process.exitCode = 5;
      const mockEmptyExec: any = (
        _file: string,
        _args: string[],
        _opts: any,
        cb: any,
      ) => {
        cb(null, "", "");
      };
      await checkDiff({
        execFileFn: mockEmptyExec,
        logFn: captureLog,
      });
      expect(process.exitCode).toBe(0);
    });
  });
});
