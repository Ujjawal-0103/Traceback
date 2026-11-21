import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTracebackMcpServer } from "../server";
import { TracebackApiClient, McpClientError } from "../client";
import {
  handleCheckLocalDiffGuardrail,
  executeLocalGitDiff,
  CheckDiffGuardrailResult,
} from "./check-diff-guardrail";
import { HistoricalIntentCheckSessionDto } from "@traceback/shared-types";

describe("MCP Tool: check_local_diff_guardrail", () => {
  let mockApiClient: jest.Mocked<TracebackApiClient>;

  beforeEach(() => {
    mockApiClient = {
      verifyExplanation: jest.fn(),
      searchEvidence: jest.fn(),
      checkChangeAgainstDecisions: jest.fn(),
      getEngineeringDecisions: jest.fn(),
      proposeEngineeringDecision: jest.fn(),
      runHistoricalIntentCheck: jest.fn(),
      setToken: jest.fn(),
    } as unknown as jest.Mocked<TracebackApiClient>;
  });

  describe("1. Supplied diff piping", () => {
    it("pipes caller-supplied diff directly into intent-check API without invoking git", async () => {
      let gitInvoked = false;
      const mockExecFile: any = () => {
        gitInvoked = true;
      };

      const mockSession: HistoricalIntentCheckSessionDto = {
        id: "intent-session-101",
        workspaceId: "ws_alpha",
        repositoryId: "repo_core",
        diff: "+ const featureEnabled = true;\n",
        filePath: "src/feature.ts",
        status: "COMPLETED",
        outcome: "NO_KNOWN_CONFLICT",
        summary:
          "No conflicts detected with recorded architectural invariants.",
        conflicts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockApiClient.runHistoricalIntentCheck.mockResolvedValueOnce(mockSession);

      const response = await handleCheckLocalDiffGuardrail(
        {
          diff: "+ const featureEnabled = true;\n",
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
        mockExecFile,
      );

      expect(gitInvoked).toBe(false);
      expect(mockApiClient.runHistoricalIntentCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
          diff: "+ const featureEnabled = true;",
        }),
      );

      const parsed: CheckDiffGuardrailResult = JSON.parse(
        response.content[0].text,
      );
      expect(parsed.nonBlocking).toBe(true);
      expect(parsed.advisoryStatus).toBe("NO_KNOWN_CONFLICT");
      expect(parsed.humanReviewNotice).toContain("advisory guardrail");
    });
  });

  describe("2. Local git diff capture (staged and baseRef)", () => {
    it("safely captures local staged git changes when diff is omitted and staged: true", async () => {
      const executedCommands: string[][] = [];
      const mockExecFile: any = (
        _file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        executedCommands.push(args);
        if (args.includes("--name-only")) {
          cb(null, "src/auth/guard.ts\n", "");
        } else {
          cb(null, "- checkAuth();\n+ // bypass\n", "");
        }
      };

      const mockSession: HistoricalIntentCheckSessionDto = {
        id: "intent-session-102",
        workspaceId: "ws_alpha",
        repositoryId: "repo_core",
        diff: "- checkAuth();\n+ // bypass\n",
        filePath: "src/auth/guard.ts",
        status: "COMPLETED",
        outcome: "POTENTIAL_CONFLICT",
        summary: "Potential security check modification detected.",
        conflicts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockApiClient.runHistoricalIntentCheck.mockResolvedValueOnce(mockSession);

      const response = await handleCheckLocalDiffGuardrail(
        {
          staged: true,
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
        mockExecFile,
      );

      expect(executedCommands).toContainEqual([
        "diff",
        "--no-color",
        "--staged",
      ]);
      expect(mockApiClient.runHistoricalIntentCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          diff: "- checkAuth();\n+ // bypass",
          filePath: "src/auth/guard.ts",
        }),
      );

      const parsed: CheckDiffGuardrailResult = JSON.parse(
        response.content[0].text,
      );
      expect(parsed.nonBlocking).toBe(true);
      expect(parsed.advisoryStatus).toBe("POTENTIAL_RISK");
    });

    it("safely executes git diff with baseRef comparison", async () => {
      const executedCommands: string[][] = [];
      const mockExecFile: any = (
        _file: string,
        args: string[],
        _opts: any,
        cb: any,
      ) => {
        executedCommands.push(args);
        if (args.includes("--name-only")) {
          cb(null, "src/index.ts\n", "");
        } else {
          cb(null, "diff against base", "");
        }
      };

      mockApiClient.runHistoricalIntentCheck.mockResolvedValueOnce({
        id: "intent-103",
        workspaceId: "ws_alpha",
        repositoryId: "repo_core",
        diff: "diff against base",
        status: "COMPLETED",
        outcome: "NO_KNOWN_CONFLICT",
        summary: "Clean",
        conflicts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await handleCheckLocalDiffGuardrail(
        {
          baseRef: "origin/main",
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
        mockExecFile,
      );

      expect(executedCommands).toContainEqual([
        "diff",
        "--no-color",
        "origin/main",
      ]);
    });
  });

  describe("3. Conflict output & evidence citation", () => {
    it("returns DOCUMENTED_CONFLICT with supporting evidence citations and nonBlocking: true", async () => {
      const mockSession: HistoricalIntentCheckSessionDto = {
        id: "intent-session-conflict-201",
        workspaceId: "ws_alpha",
        repositoryId: "repo_core",
        diff: "- mutex.lock();\n+ // removed\n",
        filePath: "src/pool.ts",
        status: "COMPLETED",
        outcome: "DOCUMENTED_CONFLICT",
        summary:
          "Detected high-severity violation of Mutex Synchronization Invariant.",
        conflicts: [
          {
            id: "cnf_mutex",
            title: "Mutex Synchronization Invariant",
            severity: "HIGH",
            outcome: "DOCUMENTED_CONFLICT",
            rationale:
              "Removal of mutex locking introduced race conditions and corruption.",
            unestablishedContext: "Shared queue dispatch state",
            recommendedReview: "Retain mutex lock or consult architecture team",
            supportingEvidence: [
              {
                id: "ev_commit_1",
                sourceType: "COMMIT",
                referenceKey: "7f8a9b1",
                title: "fix: prevent race condition with mutex",
                author: "Core Team",
                timestamp: new Date().toISOString(),
                filePath: "src/pool.ts",
                url: "https://github.com/org/repo/commit/7f8a9b1",
              },
              {
                id: "ev_adr_1",
                sourceType: "DOCUMENTATION",
                referenceKey: "ADR-002",
                title: "ADR-002: Concurrency Strategy",
                author: "Architecture Team",
                timestamp: new Date().toISOString(),
                filePath: "docs/adr/ADR-002.md",
                url: "",
              },
            ],
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockApiClient.runHistoricalIntentCheck.mockResolvedValueOnce(mockSession);

      const response = await handleCheckLocalDiffGuardrail(
        {
          diff: "- mutex.lock();\n+ // removed\n",
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
      );

      const parsed: CheckDiffGuardrailResult = JSON.parse(
        response.content[0].text,
      );
      expect(parsed.nonBlocking).toBe(true);
      expect(parsed.advisoryStatus).toBe("DOCUMENTED_CONFLICT");
      expect(parsed.conflicts).toHaveLength(1);
      expect(parsed.conflicts[0].title).toBe("Mutex Synchronization Invariant");
      expect(parsed.supportingEvidence).toHaveLength(2);
      expect(parsed.humanReviewNotice).toContain(
        "Traceback is an advisory guardrail, not an automated approval or rejection gate",
      );
      expect(parsed.humanReviewNotice).toContain("Human review is required");
    });
  });

  describe("4. Explicit abstention (INSUFFICIENT_CONTEXT)", () => {
    it("reports INSUFFICIENT_CONTEXT when diff is empty without calling backend API", async () => {
      const mockExecFile: any = (
        _file: string,
        _args: string[],
        _opts: any,
        cb: any,
      ) => {
        cb(null, "", "");
      };

      const response = await handleCheckLocalDiffGuardrail(
        {
          staged: true,
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
        mockExecFile,
      );

      expect(mockApiClient.runHistoricalIntentCheck).not.toHaveBeenCalled();

      const parsed: CheckDiffGuardrailResult = JSON.parse(
        response.content[0].text,
      );
      expect(parsed.nonBlocking).toBe(true);
      expect(parsed.advisoryStatus).toBe("INSUFFICIENT_CONTEXT");
      expect(parsed.summary).toContain("Target diff is empty");
      expect(parsed.humanReviewNotice).toContain(
        "Traceback is an advisory guardrail, not an automated approval or rejection gate",
      );
    });

    it("reports INSUFFICIENT_CONTEXT when backend API signals lack of historical evidence", async () => {
      const mockSession: HistoricalIntentCheckSessionDto = {
        id: "intent-session-insufficient",
        workspaceId: "ws_alpha",
        repositoryId: "repo_core",
        diff: "+ const helper = () => {};\n",
        filePath: "src/new-module.ts",
        status: "COMPLETED",
        outcome: "INSUFFICIENT_CONTEXT",
        summary:
          "No historical decisions, ADRs, or indexed constraints match the target files.",
        conflicts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockApiClient.runHistoricalIntentCheck.mockResolvedValueOnce(mockSession);

      const response = await handleCheckLocalDiffGuardrail(
        {
          diff: "+ const helper = () => {};\n",
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
      );

      const parsed: CheckDiffGuardrailResult = JSON.parse(
        response.content[0].text,
      );
      expect(parsed.nonBlocking).toBe(true);
      expect(parsed.advisoryStatus).toBe("INSUFFICIENT_CONTEXT");
      expect(parsed.humanReviewNotice).toContain(
        "Traceback is an advisory guardrail, not an automated approval or rejection gate",
      );
      expect(parsed.humanReviewNotice).toContain(
        "Absence of historical evidence does not prove change is safe",
      );
    });
  });

  describe("5. API failure fallback and error resilience", () => {
    it("falls back to INSUFFICIENT_CONTEXT when backend API throws or is unreachable", async () => {
      mockApiClient.runHistoricalIntentCheck.mockRejectedValueOnce(
        new McpClientError(
          "Failed to communicate with Traceback API at http://localhost:3001/api: ECONNREFUSED",
          503,
          "SERVICE_UNAVAILABLE",
        ),
      );

      const response = await handleCheckLocalDiffGuardrail(
        {
          diff: "+ const x = 1;\n",
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
      );

      const parsed: CheckDiffGuardrailResult = JSON.parse(
        response.content[0].text,
      );
      expect(parsed.nonBlocking).toBe(true);
      expect(parsed.advisoryStatus).toBe("INSUFFICIENT_CONTEXT");
      expect(parsed.summary).toContain("ECONNREFUSED");
      expect(parsed.humanReviewNotice).toContain("advisory guardrail");
    });

    it("handles invalid repository directory gracefully", async () => {
      const response = await handleCheckLocalDiffGuardrail(
        {
          repoPath: "/non/existent/path/for/repo/test",
          workspaceId: "ws_alpha",
          repositoryId: "repo_core",
        },
        mockApiClient,
      );

      const parsed: CheckDiffGuardrailResult = JSON.parse(
        response.content[0].text,
      );
      expect(parsed.nonBlocking).toBe(true);
      expect(parsed.advisoryStatus).toBe("INSUFFICIENT_CONTEXT");
      expect(parsed.summary).toContain("does not exist");
    });
  });

  describe("6. MCP Protocol Server Integration & Tool Discovery", () => {
    it("discovers check_local_diff_guardrail tool with valid input schema on MCP server", async () => {
      const server = createTracebackMcpServer({
        client: mockApiClient,
        enableGuardrailTool: true,
      });

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: {} },
      );

      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const toolsList = await client.listTools();
      const guardrailTool = toolsList.tools.find(
        (t) => t.name === "check_local_diff_guardrail",
      );

      expect(guardrailTool).toBeDefined();
      expect(guardrailTool?.description).toContain(
        "Advisory local git diff guardrail",
      );
      expect(guardrailTool?.inputSchema.properties).toHaveProperty("diff");
      expect(guardrailTool?.inputSchema.properties).toHaveProperty("repoPath");
      expect(guardrailTool?.inputSchema.properties).toHaveProperty("staged");
      expect(guardrailTool?.inputSchema.properties).toHaveProperty("baseRef");
      expect(guardrailTool?.inputSchema.properties).toHaveProperty(
        "workspaceId",
      );
      expect(guardrailTool?.inputSchema.properties).toHaveProperty(
        "repositoryId",
      );

      await client.close();
      await server.close();
    });
  });

  describe("7. Non-blocking guarantee across all pathways", () => {
    it("guarantees nonBlocking: true in every result", async () => {
      // Pathway A: Normal execution
      mockApiClient.runHistoricalIntentCheck.mockResolvedValueOnce({
        id: "intent-1",
        workspaceId: "ws_alpha",
        repositoryId: "repo_core",
        diff: "diff",
        status: "COMPLETED",
        outcome: "NO_KNOWN_CONFLICT",
        summary: "Clean",
        conflicts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const res1 = await handleCheckLocalDiffGuardrail(
        { diff: "+ change" },
        mockApiClient,
      );
      expect(JSON.parse(res1.content[0].text).nonBlocking).toBe(true);

      // Pathway B: Empty diff
      const res2 = await handleCheckLocalDiffGuardrail(
        { diff: "" },
        mockApiClient,
      );
      expect(JSON.parse(res2.content[0].text).nonBlocking).toBe(true);

      // Pathway C: API error
      mockApiClient.runHistoricalIntentCheck.mockRejectedValueOnce(
        new Error("500 Internal Server Error"),
      );
      const res3 = await handleCheckLocalDiffGuardrail(
        { diff: "+ error test" },
        mockApiClient,
      );
      expect(JSON.parse(res3.content[0].text).nonBlocking).toBe(true);
    });
  });
});
