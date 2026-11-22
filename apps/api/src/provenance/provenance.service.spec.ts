import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ProvenanceService } from "./provenance.service";
import { ProvenanceGraphSyncService } from "./provenance-graph-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { Neo4jService } from "../graph/neo4j.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { sanitizeProvenanceUrl } from "./provenance-url.util";

describe("ProvenanceService", () => {
  let service: ProvenanceService;
  let prisma: any;
  let neo4j: any;
  let workspacesService: any;
  let syncService: any;

  const mockRepo = {
    id: "repo-1",
    workspaceId: "ws-alpha",
    fullName: "test-org/test-repo",
    defaultBranch: "main",
  };

  beforeEach(async () => {
    prisma = {
      repository: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === "repo-1") return Promise.resolve(mockRepo);
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === "repo-1" && where.workspaceId === "ws-alpha") {
            return Promise.resolve(mockRepo);
          }
          return Promise.resolve(null);
        }),
      },
      gitCommit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "c-1",
            sha: "abcdef1234567890",
            message: "feat: initial socket connection logic\n\nFixes #10",
            authorName: "Alice",
            committedAt: new Date("2026-01-01T10:00:00Z"),
            url: "https://github.com/test-org/test-repo/commit/abcdef1",
            diffs: [{ filePath: "src/socket.ts", status: "added" }],
          },
          {
            id: "c-2",
            sha: "fedcba0987654321",
            message:
              "refactor: optimize socket heartbeat buffer\n\nRelates to PR #12",
            authorName: "Bob",
            committedAt: new Date("2026-01-05T12:00:00Z"),
            url: "https://github.com/test-org/test-repo/commit/fedcba0",
            diffs: [{ filePath: "src/socket.ts", status: "modified" }],
          },
        ]),
      },
      commitDiff: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { filePath: "src/socket.ts" },
            { filePath: "src/socket.ts" },
            { filePath: "src/index.ts" },
          ]),
      },
      pullRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pr-1",
            number: 12,
            title: "Implement heartbeat buffers (#10)",
            body: "Resolves #10 by introducing heartbeat buffers.",
            author: "Bob",
            state: "closed",
            isMerged: true,
            createdAt: new Date("2026-01-04T10:00:00Z"),
            mergedAt: new Date("2026-01-05T11:00:00Z"),
            url: "https://github.com/test-org/test-repo/pull/12",
          },
        ]),
      },
      issue: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "iss-1",
            number: 10,
            title: "Socket reconnection memory leak",
            body: "Reconnection buffers grow without bound.",
            author: "Charlie",
            state: "closed",
            createdAt: new Date("2025-12-28T09:00:00Z"),
            url: "https://github.com/test-org/test-repo/issues/10",
          },
        ]),
      },
      engineeringDecision: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dec-1",
            title: "Cap socket buffer memory",
            summary: "Enforce 500-record max buffer limit.",
            decision: "Use ring buffer for socket reconnect.",
            rationale: "Prevents unbounded heap exhaustion.",
            targetFilePath: "src/socket.ts",
            targetSymbol: "SocketBuffer",
            status: "ACCEPTED",
            severity: "HIGH",
            relatedCommitSha: "abcdef1234567890",
            relatedPrNumber: 12,
            reviewerName: "Dave",
            supersedesId: null,
            supersededById: null,
            createdAt: new Date("2026-01-06T15:00:00Z"),
          },
        ]),
      },
    };

    neo4j = {
      isAvailable: jest.fn().mockReturnValue(false),
      runQuery: jest.fn(),
      verifyOrReconnect: jest.fn().mockResolvedValue(false),
    };

    workspacesService = {
      getMembership: jest.fn().mockImplementation((wsId, uId) => {
        if (wsId === "ws-alpha" && uId === "user-1") {
          return Promise.resolve({ role: "MEMBER" });
        }
        return Promise.resolve(null);
      }),
    };

    syncService = {
      syncProvenanceGraph: jest.fn().mockResolvedValue({
        repositoryId: "repo-1",
        synced: true,
        neo4jConnected: true,
        nodesCount: 5,
        edgesCount: 4,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvenanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: Neo4jService, useValue: neo4j },
        { provide: WorkspacesService, useValue: workspacesService },
        { provide: ProvenanceGraphSyncService, useValue: syncService },
      ],
    }).compile();

    service = module.get<ProvenanceService>(ProvenanceService);
  });

  describe("Repository and Multi-Tenant Access Verification", () => {
    it("should throw NotFoundException when repository does not exist", async () => {
      await expect(
        service.verifyRepositoryAccess("ws-alpha", "non-existent-repo"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when repository belongs to a different workspace", async () => {
      await expect(
        service.verifyRepositoryAccess("ws-other", "repo-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user does not have membership in workspace", async () => {
      await expect(
        service.verifyRepositoryAccess(
          "ws-alpha",
          "repo-1",
          "user-unauthorized",
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should grant access when repository and user membership match", async () => {
      const repo = await service.verifyRepositoryAccess(
        "ws-alpha",
        "repo-1",
        "user-1",
      );
      expect(repo.id).toBe("repo-1");
      expect(repo.fullName).toBe("test-org/test-repo");
    });
  });

  describe("getTargets", () => {
    it("should return selectable files ranked by event count and decisions list", async () => {
      const targets = await service.getTargets("ws-alpha", "repo-1", "user-1");

      expect(targets.repository.fullName).toBe("test-org/test-repo");
      expect(targets.files.length).toBeGreaterThanOrEqual(1);
      expect(targets.files[0].path).toBe("src/socket.ts");
      expect(targets.files[0].eventCount).toBeGreaterThan(0);
      expect(targets.decisions.length).toBe(1);
      expect(targets.decisions[0].title).toBe("Cap socket buffer memory");
      expect(targets.neo4jStatus.connected).toBe(false);
    });
  });

  describe("getTimeline — Graceful PostgreSQL Fallback", () => {
    it("should return dataSource: postgres_fallback with chronologically ordered nodes and causal edges when Neo4j is offline", async () => {
      neo4j.isAvailable.mockReturnValue(false);

      const timeline = await service.getTimeline(
        "ws-alpha",
        "repo-1",
        { filePath: "src/socket.ts" },
        "user-1",
      );

      expect(timeline.dataSource).toBe("postgres_fallback");
      expect(timeline.neo4jConnected).toBe(false);
      expect(timeline.insufficientHistory).toBe(false);
      expect(timeline.nodes.length).toBeGreaterThanOrEqual(4);

      // Verify chronological ordering
      for (let i = 0; i < timeline.nodes.length - 1; i++) {
        const cur = new Date(timeline.nodes[i].timestamp).getTime();
        const next = new Date(timeline.nodes[i + 1].timestamp).getTime();
        expect(cur).toBeLessThanOrEqual(next);
      }

      // Check node stages
      const issueNode = timeline.nodes.find((n) => n.type === "ISSUE");
      const introCommitNode = timeline.nodes.find((n) => n.type === "COMMIT");
      const decisionNode = timeline.nodes.find((n) => n.type === "DECISION");
      const refactorNode = timeline.nodes.find((n) => n.type === "REFACTOR");

      expect(issueNode).toBeDefined();
      expect(issueNode?.stageOrder).toBe(1);

      expect(introCommitNode).toBeDefined();
      expect(introCommitNode?.stageOrder).toBe(2);

      expect(decisionNode).toBeDefined();
      expect(decisionNode?.stageOrder).toBe(3);

      expect(refactorNode).toBeDefined();
      expect(refactorNode?.stageOrder).toBe(4);

      // Verify causal relationships
      expect(timeline.edges.length).toBeGreaterThan(0);
      const motivatedEdge = timeline.edges.find(
        (e) => e.relation === "MOTIVATED",
      );
      expect(motivatedEdge).toBeDefined();
      const evidencesEdge = timeline.edges.find(
        (e) => e.relation === "EVIDENCES",
      );
      expect(evidencesEdge).toBeDefined();
    });

    it("should return explicit abstention (insufficientHistory: true) when no records match target", async () => {
      prisma.gitCommit.findMany.mockResolvedValueOnce([]);
      prisma.pullRequest.findMany.mockResolvedValueOnce([]);
      prisma.issue.findMany.mockResolvedValueOnce([]);
      prisma.engineeringDecision.findMany.mockResolvedValueOnce([]);

      const timeline = await service.getTimeline(
        "ws-alpha",
        "repo-1",
        { filePath: "src/non-existent.ts" },
        "user-1",
      );

      expect(timeline.insufficientHistory).toBe(true);
      expect(timeline.abstentionReason).toContain(
        "Insufficient historical evidence",
      );
      expect(timeline.nodes).toEqual([]);
      expect(timeline.edges).toEqual([]);
    });
  });

  describe("getTimeline — Neo4j Multi-Hop Traversal", () => {
    it("should return dataSource: neo4j with bound Cypher parameters when Neo4j is available", async () => {
      neo4j.isAvailable.mockReturnValue(true);

      // Mock count check to indicate existing nodes
      neo4j.runQuery
        .mockResolvedValueOnce([{ get: () => 5 }]) // count query
        .mockResolvedValueOnce([
          // Nodes query
          {
            get: (key: string) => {
              if (key === "nodeType") return "ProvenanceIssue";
              if (key === "props")
                return {
                  number: 10,
                  title: "Socket memory leak",
                  author: "Charlie",
                  state: "CLOSED",
                  timestamp: "2025-12-28T09:00:00.000Z",
                  url: "https://github.com/test-org/test-repo/issues/10",
                };
              return "repo-1:issue:10";
            },
          },
          {
            get: (key: string) => {
              if (key === "nodeType") return "ProvenanceCommit";
              if (key === "props")
                return {
                  sha: "abcdef1234567890",
                  title: "fix: socket buffers",
                  author: "Alice",
                  timestamp: "2026-01-01T10:00:00.000Z",
                  url: "https://github.com/test-org/test-repo/commit/abcdef1",
                  files: ["src/socket.ts"],
                };
              return "repo-1:commit:abcdef1234567890";
            },
          },
          {
            get: (key: string) => {
              if (key === "nodeType") return "ProvenanceDecision";
              if (key === "props")
                return {
                  decisionId: "dec-1",
                  title: "Cap socket buffer memory",
                  status: "ACCEPTED",
                  timestamp: "2026-01-06T15:00:00.000Z",
                };
              return "repo-1:decision:dec-1";
            },
          },
        ])
        .mockResolvedValueOnce([
          // Edges query
          {
            get: (key: string) => {
              if (key === "sourceUid") return "repo-1:issue:10";
              if (key === "targetUid") return "repo-1:commit:abcdef1234567890";
              if (key === "relType") return "MOTIVATED";
              return 1;
            },
          },
        ]);

      const timeline = await service.getTimeline(
        "ws-alpha",
        "repo-1",
        { filePath: "src/socket.ts" },
        "user-1",
      );

      expect(timeline.dataSource).toBe("neo4j");
      expect(timeline.neo4jConnected).toBe(true);
      expect(timeline.nodes.length).toBe(3);
      expect(timeline.edges.length).toBe(1);
      expect(timeline.edges[0].relation).toBe("MOTIVATED");

      // Verify that query parameters were safely bound (no unsafe string interpolation)
      expect(neo4j.runQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          repositoryId: "repo-1",
          workspaceId: "ws-alpha",
          filePath: "src/socket.ts",
        }),
      );
    });
  });

  describe("URL Sanitization", () => {
    it("should accept valid http and https URLs", () => {
      expect(
        sanitizeProvenanceUrl("https://github.com/owner/repo/commit/1234567"),
      ).toBe("https://github.com/owner/repo/commit/1234567");
      expect(
        sanitizeProvenanceUrl("http://internal.company.dev/issue/42"),
      ).toBe("http://internal.company.dev/issue/42");
    });

    it("should reject malicious or invalid URI schemes", () => {
      expect(sanitizeProvenanceUrl("javascript:alert(1)")).toBeUndefined();
      expect(sanitizeProvenanceUrl("data:text/html,<script>")).toBeUndefined();
      expect(sanitizeProvenanceUrl("file:///etc/passwd")).toBeUndefined();
      expect(sanitizeProvenanceUrl("")).toBeUndefined();
      expect(sanitizeProvenanceUrl(null)).toBeUndefined();
      expect(sanitizeProvenanceUrl(undefined)).toBeUndefined();
    });
  });
});
