import { Test, TestingModule } from "@nestjs/testing";
import { DecisionPromotionService } from "./decision-promotion.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";

describe("DecisionPromotionService", () => {
  let service: DecisionPromotionService;
  let prisma: {
    repository: { findFirst: jest.Mock };
    claim: { findFirst: jest.Mock };
    verificationSession: { findFirst: jest.Mock };
    engineeringDecision: { create: jest.Mock };
  };

  const mockWorkspaceId = "ws-123";
  const mockRepoId = "repo-456";
  const mockClaimId = "claim-789";
  const mockSessionId = "session-101";

  const mockRepository = {
    id: mockRepoId,
    workspaceId: mockWorkspaceId,
    fullName: "test-org/test-repo",
  };

  const mockSession = {
    id: mockSessionId,
    workspaceId: mockWorkspaceId,
    repositoryId: mockRepoId,
    explanation: "Cache must use Redis TTL of 60 seconds to avoid stale reads.",
    targetFilePath: "src/cache/redis.ts",
  };

  const mockEvidence = [
    {
      id: "ev-1",
      claimId: mockClaimId,
      sourceType: "COMMIT",
      referenceKey: "a1b2c3d",
      title: "Add 60s Redis TTL constraint",
      author: "Jane Doe",
      timestamp: new Date("2024-01-15T10:00:00Z"),
      url: "https://github.com/test-org/test-repo/commit/a1b2c3d",
      snippet: "const CACHE_TTL = 60;",
      filePath: "src/cache/redis.ts",
      lineStart: 12,
      lineEnd: 15,
      sourceRecord: {
        id: "sr-1",
        referenceKey: "a1b2c3d",
        title: "Add 60s Redis TTL constraint",
        author: "Jane Doe",
        recordedAt: new Date("2024-01-15T10:00:00Z"),
        url: "https://github.com/test-org/test-repo/commit/a1b2c3d",
        snippet: "const CACHE_TTL = 60;",
        filePath: "src/cache/redis.ts",
        lineStart: 12,
        lineEnd: 15,
      },
    },
    {
      id: "ev-2",
      claimId: mockClaimId,
      sourceType: "PULL_REQUEST",
      referenceKey: "#42",
      title: "Enforce cache expiration policy",
      author: "John Smith",
      timestamp: new Date("2024-01-16T12:00:00Z"),
      url: "https://github.com/test-org/test-repo/pull/42",
      snippet: "Resolves stale cache reads in production",
      filePath: "src/cache/redis.ts",
      lineStart: 1,
      lineEnd: 30,
      sourceRecord: null,
    },
  ];

  const mockClaim = {
    id: mockClaimId,
    sessionId: mockSessionId,
    text: "Redis TTL is strictly configured to 60s to prevent stale reads.",
    targetSymbol: "CACHE_TTL",
    humanVerdict: "CONFIRMED",
    session: mockSession,
    evidence: mockEvidence,
  };

  beforeEach(async () => {
    prisma = {
      repository: { findFirst: jest.fn() },
      claim: { findFirst: jest.fn() },
      verificationSession: { findFirst: jest.fn() },
      engineeringDecision: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionPromotionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DecisionPromotionService>(DecisionPromotionService);
  });

  describe("Draft Decision Creation with Provenance", () => {
    it("should successfully create a draft decision with provenance from a verified claim", async () => {
      prisma.repository.findFirst.mockResolvedValue(mockRepository);
      prisma.claim.findFirst.mockResolvedValue(mockClaim);

      const createdRecord = {
        id: "dec-999",
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepoId,
        title: "Architectural Constraint for CACHE_TTL",
        summary: `Derived from verified claim: "${mockClaim.text}"`,
        decision: `Preserve established architectural requirement: ${mockClaim.text}`,
        rationale: "Verified Explanation:\nCache must use Redis TTL...",
        targetFilePath: "src/cache/redis.ts",
        targetSymbol: "CACHE_TTL",
        status: "CANDIDATE", // Strictly CANDIDATE (Draft)
        severity: "HIGH",
        supportingEvidence: mockEvidence,
        relatedCommitSha: "a1b2c3d",
        relatedPrNumber: 42,
        createdFromClaimId: mockClaimId,
        reviewerId: null,
        reviewerName: null,
        reviewNotes: null,
        reviewedAt: null,
        createdAt: new Date("2026-11-21T18:00:00Z"),
        updatedAt: new Date("2026-11-21T18:00:00Z"),
      };
      prisma.engineeringDecision.create.mockResolvedValue(createdRecord);

      const result = await service.promoteToDecision(mockWorkspaceId, {
        claimId: mockClaimId,
        repositoryId: mockRepoId,
        severity: "HIGH",
      });

      // Assert draft status is strictly CANDIDATE (never auto-approved)
      expect(result.status).toBe("CANDIDATE");
      expect(result.decisionId).toBe("dec-999");
      expect(result.repositoryId).toBe(mockRepoId);
      expect(result.workspaceId).toBe(mockWorkspaceId);
      expect(result.relatedCommitSha).toBe("a1b2c3d");
      expect(result.relatedPrNumber).toBe(42);
      expect(result.createdFromClaimId).toBe(mockClaimId);
      expect(result.targetSymbol).toBe("CACHE_TTL");
      expect(result.targetFilePath).toBe("src/cache/redis.ts");

      // Verify Prisma create call payload
      expect(prisma.engineeringDecision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepoId,
          status: "CANDIDATE",
          severity: "HIGH",
          relatedCommitSha: "a1b2c3d",
          relatedPrNumber: 42,
          createdFromClaimId: mockClaimId,
          reviewerId: null,
          reviewedAt: null,
        }),
      });
    });

    it("should allow custom title, summary, decision, and rationale overrides", async () => {
      prisma.repository.findFirst.mockResolvedValue(mockRepository);
      prisma.claim.findFirst.mockResolvedValue(mockClaim);

      const customCreatedRecord = {
        id: "dec-custom",
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepoId,
        title: "Custom Cache Expiration Rule",
        summary: "Custom summary of the requirement",
        decision: "Enforce strict Redis 60s cache limit across all services",
        rationale: "Team consensus based on outage post-mortem",
        targetFilePath: "src/cache/redis.ts",
        targetSymbol: "CACHE_TTL",
        status: "CANDIDATE",
        severity: "CRITICAL",
        supportingEvidence: mockEvidence,
        relatedCommitSha: "a1b2c3d",
        relatedPrNumber: 42,
        createdFromClaimId: mockClaimId,
        reviewerId: null,
        reviewerName: null,
        reviewNotes: null,
        reviewedAt: null,
        createdAt: new Date("2026-11-21T18:00:00Z"),
        updatedAt: new Date("2026-11-21T18:00:00Z"),
      };
      prisma.engineeringDecision.create.mockResolvedValue(customCreatedRecord);

      const result = await service.promoteToDecision(mockWorkspaceId, {
        claimId: mockClaimId,
        repositoryId: mockRepoId,
        title: "Custom Cache Expiration Rule",
        summary: "Custom summary of the requirement",
        decision: "Enforce strict Redis 60s cache limit across all services",
        rationale: "Team consensus based on outage post-mortem",
        severity: "CRITICAL",
      });

      expect(result.title).toBe("Custom Cache Expiration Rule");
      expect(result.summary).toBe("Custom summary of the requirement");
      expect(result.decision).toBe(
        "Enforce strict Redis 60s cache limit across all services",
      );
      expect(result.rationale).toBe(
        "Team consensus based on outage post-mortem",
      );
      expect(result.status).toBe("CANDIDATE");
    });

    it("should successfully promote when given verificationSessionId without claimId", async () => {
      prisma.repository.findFirst.mockResolvedValue(mockRepository);
      prisma.verificationSession.findFirst.mockResolvedValue({
        ...mockSession,
        claims: [mockClaim],
      });

      const sessionCreatedRecord = {
        id: "dec-session-promo",
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepoId,
        title: "Architectural Constraint for CACHE_TTL",
        summary: `Derived from verified claim: "${mockClaim.text}"`,
        decision: `Preserve established architectural requirement: ${mockClaim.text}`,
        rationale: "Verified Explanation:\nCache must use Redis TTL...",
        targetFilePath: "src/cache/redis.ts",
        targetSymbol: "CACHE_TTL",
        status: "CANDIDATE",
        severity: "MEDIUM",
        supportingEvidence: mockEvidence,
        relatedCommitSha: "a1b2c3d",
        relatedPrNumber: 42,
        createdFromClaimId: mockClaimId,
        reviewerId: null,
        reviewerName: null,
        reviewNotes: null,
        reviewedAt: null,
        createdAt: new Date("2026-11-21T18:00:00Z"),
        updatedAt: new Date("2026-11-21T18:00:00Z"),
      };
      prisma.engineeringDecision.create.mockResolvedValue(sessionCreatedRecord);

      const result = await service.promoteToDecision(mockWorkspaceId, {
        verificationSessionId: mockSessionId,
        repositoryId: mockRepoId,
      });

      expect(result.decisionId).toBe("dec-session-promo");
      expect(result.status).toBe("CANDIDATE");
      expect(result.createdFromClaimId).toBe(mockClaimId);
    });
  });

  describe("Workspace Isolation & Security", () => {
    it("should throw NotFoundException if repository does not belong to workspace", async () => {
      prisma.repository.findFirst.mockResolvedValue(null);

      await expect(
        service.promoteToDecision(mockWorkspaceId, {
          claimId: mockClaimId,
          repositoryId: "unauthorized-repo",
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.claim.findFirst).not.toHaveBeenCalled();
      expect(prisma.engineeringDecision.create).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException if claim does not exist or belongs to different workspace", async () => {
      prisma.repository.findFirst.mockResolvedValue(mockRepository);
      prisma.claim.findFirst.mockResolvedValue(null);

      await expect(
        service.promoteToDecision(mockWorkspaceId, {
          claimId: "missing-claim",
          repositoryId: mockRepoId,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.engineeringDecision.create).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException if neither claimId nor verificationSessionId is provided", async () => {
      await expect(
        service.promoteToDecision(mockWorkspaceId, {
          repositoryId: mockRepoId,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
