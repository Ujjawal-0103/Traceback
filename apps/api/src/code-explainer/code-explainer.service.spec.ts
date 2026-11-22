import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { CodeExplainerService } from "./code-explainer.service";
import { PrismaService } from "../prisma/prisma.service";
import { VerificationSessionService } from "../verification/verification-session.service";

describe("CodeExplainerService", () => {
  let service: CodeExplainerService;
  let prisma: any;
  let sessionService: any;

  const mockWorkspaceId = "ws-123";
  const mockRepoId = "repo-456";

  beforeEach(async () => {
    prisma = {
      repository: {
        findUnique: jest.fn(),
      },
      commitDiff: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sourceRecord: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      engineeringDecision: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      gitCommit: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      pullRequest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      issue: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    sessionService = {
      verifyExplanation: jest.fn().mockResolvedValue({
        sessionId: "sess-abc",
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepoId,
        status: "COMPLETED",
        explanation: "Test explanation",
        claimsCount: 2,
        assessments: [],
        citationValidityRate: 1.0,
        executionTimeMs: 120,
        estimatedTokensUsed: 50,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodeExplainerService,
        { provide: PrismaService, useValue: prisma },
        { provide: VerificationSessionService, useValue: sessionService },
      ],
    }).compile();

    service = module.get<CodeExplainerService>(CodeExplainerService);
  });

  describe("verifyRepositoryAccess", () => {
    it("throws NotFoundException if repository does not exist", async () => {
      prisma.repository.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyRepositoryAccess(mockWorkspaceId, "non-existent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException if repository belongs to another workspace", async () => {
      prisma.repository.findUnique.mockResolvedValue({
        id: mockRepoId,
        workspaceId: "other-ws",
      });

      await expect(
        service.verifyRepositoryAccess(mockWorkspaceId, mockRepoId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("succeeds when repository belongs to workspace", async () => {
      prisma.repository.findUnique.mockResolvedValue({
        id: mockRepoId,
        workspaceId: mockWorkspaceId,
      });

      await expect(
        service.verifyRepositoryAccess(mockWorkspaceId, mockRepoId),
      ).resolves.toBeUndefined();
    });
  });

  describe("getTargets", () => {
    it("returns ranked selectable file paths and recent decisions", async () => {
      prisma.repository.findUnique.mockResolvedValue({
        id: mockRepoId,
        workspaceId: mockWorkspaceId,
      });

      prisma.commitDiff.findMany.mockResolvedValue([
        {
          filePath: "src/auth/jwt.ts",
          commit: { committedAt: new Date("2026-01-01") },
        },
        {
          filePath: "src/auth/jwt.ts",
          commit: { committedAt: new Date("2026-02-01") },
        },
        {
          filePath: "src/components/Table.tsx",
          commit: { committedAt: new Date("2026-01-15") },
        },
      ]);

      prisma.sourceRecord.findMany.mockResolvedValue([
        {
          filePath: "src/auth/jwt.ts",
          recordedAt: new Date("2026-01-02"),
        },
      ]);

      prisma.engineeringDecision.findMany.mockResolvedValue([
        {
          id: "dec-1",
          title: "Use JWT Authentication",
          targetFilePath: "src/auth/jwt.ts",
          status: "ACCEPTED",
          createdAt: new Date("2026-01-05"),
        },
      ]);

      const res = await service.getTargets(mockWorkspaceId, mockRepoId);

      expect(res.repositoryId).toBe(mockRepoId);
      expect(res.targets.length).toBe(2);
      expect(res.targets[0].filePath).toBe("src/auth/jwt.ts");
      expect(res.targets[0].activityCount).toBe(3); // 2 diffs + 1 source
      expect(res.targets[0].relatedDecisionCount).toBe(1);
      expect(res.recentDecisions.length).toBe(1);
      expect(res.recentDecisions[0].title).toBe("Use JWT Authentication");
    });
  });

  describe("explainCode", () => {
    beforeEach(() => {
      prisma.repository.findUnique.mockResolvedValue({
        id: mockRepoId,
        workspaceId: mockWorkspaceId,
      });
    });

    it("throws BadRequestException when all target parameters are empty", async () => {
      await expect(
        service.explainCode(mockWorkspaceId, mockRepoId, "user-1", {}),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.explainCode(mockWorkspaceId, mockRepoId, "user-1", {
          filePath: "   ",
          symbol: "",
          codeSnippet: "  ",
          question: "",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("explicitly abstains when zero historical records are found (Never invents claims)", async () => {
      prisma.gitCommit.findMany.mockResolvedValue([]);
      prisma.pullRequest.findMany.mockResolvedValue([]);
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.engineeringDecision.findMany.mockResolvedValue([]);

      const result = await service.explainCode(
        mockWorkspaceId,
        mockRepoId,
        "user-1",
        {
          filePath: "src/unknown/legacy.ts",
          question: "Why was this written?",
        },
      );

      expect(result.insufficientHistory).toBe(true);
      expect(result.synthesisMode).toBe("abstained");
      expect(result.generatedExplanation).toContain(
        "Insufficient historical evidence",
      );
      expect(result.evidenceSummary.totalSources).toBe(0);
      expect(result.abstentionReason).toBeDefined();
      expect(result.explanationBreakdown).toBeDefined();
      expect(result.explanationBreakdown?.whyItWasBuilt).toContain(
        "Undocumented in repository history",
      );
      expect(result.explanationBreakdown?.cautionBeforeEditing).toContain(
        "consult with senior team maintainers",
      );
    });

    it("synthesizes deterministic evidence-grounded explanation and verifies via VerificationService", async () => {
      prisma.gitCommit.findMany.mockResolvedValue([
        {
          sha: "c0ffee1234567890",
          message: "feat: add user authentication",
          authorName: "Alice Dev",
          committedAt: new Date("2026-01-01"),
          diffs: [{ filePath: "src/auth/jwt.ts" }],
        },
        {
          sha: "b00b1e1234567890",
          message: "refactor: optimize token rotation",
          authorName: "Bob Eng",
          committedAt: new Date("2026-02-01"),
          diffs: [{ filePath: "src/auth/jwt.ts" }],
        },
      ]);

      prisma.pullRequest.findMany.mockResolvedValue([
        {
          number: 42,
          title: "Implement JWT auth pipeline",
          body: "Fixes auth token leaks",
          isMerged: true,
          mergedAt: new Date("2026-01-02"),
        },
      ]);

      prisma.issue.findMany.mockResolvedValue([
        {
          number: 10,
          title: "Session hijacking risk",
          body: "Need stateless authentication",
          state: "closed",
        },
      ]);

      prisma.engineeringDecision.findMany.mockResolvedValue([
        {
          id: "dec-1",
          title: "Adopt Stateless JWTs",
          decision: "Store claims in JWT",
          rationale: "Ensures horizontal scalability without shared redis",
          status: "ACCEPTED",
          relatedCommitSha: "c0ffee1234567890",
          relatedPrNumber: 42,
          createdAt: new Date("2026-01-03"),
        },
      ]);

      const result = await service.explainCode(
        mockWorkspaceId,
        mockRepoId,
        "user-1",
        {
          filePath: "src/auth/jwt.ts",
          symbol: "verifyToken",
          question: "Why do we use JWT tokens?",
          codeSnippet: "export function verifyToken(token: string) { return jwt.verify(token); }",
        },
      );

      expect(result.insufficientHistory).toBe(false);
      expect(result.synthesisMode).toBe("deterministic_grounded");
      expect(result.evidenceSummary.commits).toBe(2);
      expect(result.evidenceSummary.pullRequests).toBe(1);
      expect(result.evidenceSummary.issues).toBe(1);
      expect(result.evidenceSummary.decisions).toBe(1);
      expect(result.evidenceSummary.totalSources).toBe(5);

      // Verify explanation cites concrete entities
      expect(result.generatedExplanation).toContain("Issue #10");
      expect(result.generatedExplanation).toContain("Pull Request #42");
      expect(result.generatedExplanation).toContain("Adopt Stateless JWTs");
      expect(result.generatedExplanation).toContain("c0ffee1");

      // Verify rich structured breakdown
      expect(result.explanationBreakdown).toBeDefined();
      expect(result.explanationBreakdown?.summary).toBeDefined();
      expect(result.explanationBreakdown?.whatCodeDoes).toContain("Code Reading");
      expect(result.explanationBreakdown?.whyItWasBuilt).toContain("Issue #10");
      expect(result.explanationBreakdown?.howItWasImplemented).toContain("Pull Request #42");
      expect(result.explanationBreakdown?.governingConstraints.length).toBeGreaterThan(0);
      expect(result.explanationBreakdown?.evolutionSummary).toContain("2 recorded commits");
      expect(result.explanationBreakdown?.cautionBeforeEditing).toBeDefined();

      // Verify automatic pipeline verification occurred
      expect(sessionService.verifyExplanation).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepoId,
          targetFilePath: "src/auth/jwt.ts",
          targetSymbol: "verifyToken",
        }),
      );
      expect(result.verificationSession).toBeDefined();
      expect(result.verificationSession.sessionId).toBe("sess-abc");
    });
  });
});
