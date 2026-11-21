import { Test, TestingModule } from "@nestjs/testing";
import { DecisionsService } from "./decisions.service";
import { PrismaService } from "../prisma/prisma.service";
import * as fs from "fs";
import * as path from "path";

describe("DecisionsService (Feature 4 Evidence-to-Decision & ADR Sync)", () => {
  let service: DecisionsService;
  let prisma: any;

  const mockRepository = {
    id: "repo-1",
    workspaceId: "ws-1",
    fullName: "test-org/test-repo",
  };

  const mockClaim = {
    id: "claim-101",
    sessionId: "sess-1",
    text: "Row mapping is memoized to prevent UI thread lockups.",
    targetSymbol: "memoizedRows",
    preliminaryConfidence: "HIGH_SUPPORT",
    session: {
      id: "sess-1",
      workspaceId: "ws-1",
      repositoryId: "repo-1",
      explanation: "Full explanation of why memoization exists.",
      targetFilePath: "src/Table.tsx",
    },
    evidence: [
      {
        id: "ev-1",
        claimId: "claim-101",
        sourceType: "COMMIT",
        referenceKey: "7a8b9c",
        title: "feat: memoize rows",
        author: "Alex",
        timestamp: new Date("2026-10-10T10:00:00Z"),
        url: "https://github.com/test-org/test-repo/commit/7a8b9c",
        snippet: "+ useMemo(() => rows, [rows])",
        filePath: "src/Table.tsx",
        lineStart: 10,
        lineEnd: 25,
      },
      {
        id: "ev-2",
        claimId: "claim-101",
        sourceType: "PULL_REQUEST",
        referenceKey: "#42",
        title: "Optimise table",
        author: "Alex",
        timestamp: new Date("2026-10-10T12:00:00Z"),
        url: "https://github.com/test-org/test-repo/pull/42",
      },
    ],
  };

  const mockDecisionRecord = {
    id: "dec-1",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    title: "Architectural Constraint for memoizedRows",
    summary: 'Derived from verified claim: "Row mapping is memoized to prevent UI thread lockups."',
    decision: "Preserve established architectural constraint: Row mapping is memoized to prevent UI thread lockups.",
    rationale: "Verified historical evidence confirms this requirement was intentionally implemented.",
    targetFilePath: "src/Table.tsx",
    targetSymbol: "memoizedRows",
    status: "CANDIDATE",
    severity: "HIGH",
    supportingEvidence: [
      {
        id: "ev-1",
        sourceType: "COMMIT",
        referenceKey: "7a8b9c",
        title: "feat: memoize rows",
        author: "Alex",
        timestamp: "2026-10-10T10:00:00.000Z",
        url: "https://github.com/test-org/test-repo/commit/7a8b9c",
        filePath: "src/Table.tsx",
      },
    ],
    relatedCommitSha: "7a8b9c",
    relatedPrNumber: 42,
    reviewerId: null,
    reviewerName: null,
    reviewNotes: null,
    reviewedAt: null,
    supersedesId: null,
    supersededById: null,
    createdFromClaimId: "claim-101",
    createdAt: new Date("2026-10-10T12:00:00Z"),
    updatedAt: new Date("2026-10-10T12:00:00Z"),
  };

  beforeEach(async () => {
    prisma = {
      repository: {
        findFirst: jest.fn().mockResolvedValue(mockRepository),
      },
      claim: {
        findUnique: jest.fn().mockResolvedValue(mockClaim),
      },
      engineeringDecision: {
        findMany: jest.fn().mockResolvedValue([mockDecisionRecord]),
        findFirst: jest.fn().mockResolvedValue(mockDecisionRecord),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({
            ...mockDecisionRecord,
            ...args.data,
            id: "dec-created-999",
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        update: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({
            ...mockDecisionRecord,
            ...args.data,
            updatedAt: new Date(),
          }),
        ),
      },
      sourceRecord: {
        upsert: jest.fn().mockResolvedValue({ id: "source-rec-1" }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DecisionsService>(DecisionsService);
  });

  describe("proposeFromClaim (Evidence-to-Decision Loop)", () => {
    it("proposes candidate decision prepopulated from verified claim and evidence", async () => {
      const result = await service.proposeFromClaim("ws-1", "repo-1", {
        claimId: "claim-101",
      });

      expect(result.status).toBe("CANDIDATE");
      expect(result.createdFromClaimId).toBe("claim-101");
      expect(result.title).toBe("Architectural Constraint for memoizedRows");
      expect(result.relatedCommitSha).toBe("7a8b9c");
      expect(result.relatedPrNumber).toBe(42);
      expect(result.supportingEvidence.length).toBe(2);
      expect(prisma.engineeringDecision.create).toHaveBeenCalled();
    });

    it("allows immediate human acceptance during promotion with audit trail", async () => {
      const result = await service.proposeFromClaim(
        "ws-1",
        "repo-1",
        {
          claimId: "claim-101",
          status: "ACCEPTED",
          title: "Approved Table Memoization",
          reviewNotes: "Explicit human sign-off on historical rationale.",
        },
        { id: "usr-1", name: "Alex Lead", email: "alex@lead.com" } as any,
      );

      expect(result.status).toBe("ACCEPTED");
      expect(result.title).toBe("Approved Table Memoization");
      expect(result.reviewerName).toBe("Alex Lead");
      expect(result.reviewNotes).toBe("Explicit human sign-off on historical rationale.");
      expect(result.reviewedAt).not.toBeNull();
    });
  });

  describe("Decision State Transitions", () => {
    it("accepts a candidate decision with reviewer audit", async () => {
      const result = await service.acceptDecision(
        "ws-1",
        "repo-1",
        "dec-1",
        { reviewNotes: "Meets invariant criteria." },
        { id: "usr-1", name: "Alex Lead" } as any,
      );

      expect(result.status).toBe("ACCEPTED");
      expect(result.reviewerName).toBe("Alex Lead");
      expect(prisma.engineeringDecision.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "dec-1" },
          data: expect.objectContaining({ status: "ACCEPTED" }),
        }),
      );
    });

    it("rejects and archives candidate decision", async () => {
      const result = await service.rejectDecision(
        "ws-1",
        "repo-1",
        "dec-1",
        { reviewNotes: "Not an invariant." },
        { id: "usr-1", name: "Alex Lead" } as any,
      );

      expect(result.status).toBe("ARCHIVED");
    });
  });

  describe("ADR Generation & Synchronization", () => {
    it("generates structured ADR markdown for a decision", async () => {
      const adr = await service.getDecisionAdr("ws-1", "repo-1", "dec-1");

      expect(adr.decisionId).toBe("dec-1");
      expect(adr.identifier).toMatch(/^ADR-\d+$/);
      expect(adr.markdown).toContain("# ADR-001: Architectural Constraint for memoizedRows");
      expect(adr.markdown).toContain("## Supporting Evidence & Provenance");
    });

    it("exports decision to ADR file and projects to SourceRecords", async () => {
      const repoRoot = (service as any).resolveAdrDirectory().repoRoot;
      const tempAdrDir = path.resolve(repoRoot, "tmp-test-adrs");
      if (fs.existsSync(tempAdrDir)) fs.rmSync(tempAdrDir, { recursive: true });

      try {
        const adrFile = await service.exportDecisionToAdr("ws-1", "repo-1", "dec-1", {
          adrDirectory: "tmp-test-adrs",
        });

        expect(adrFile.fileName).toMatch(/ADR-001.*\.md/);
        expect(fs.existsSync(path.resolve(repoRoot, adrFile.filePath))).toBe(true);
        expect(prisma.sourceRecord.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              repositoryId_sourceType_externalId: expect.objectContaining({
                sourceType: "ADR",
              }),
            }),
          }),
        );
      } finally {
        if (fs.existsSync(tempAdrDir)) fs.rmSync(tempAdrDir, { recursive: true });
      }
    });

    it("executes bidirectional sync cleanly", async () => {
      const repoRoot = (service as any).resolveAdrDirectory().repoRoot;
      const tempAdrDir = path.resolve(repoRoot, "tmp-test-sync");
      if (fs.existsSync(tempAdrDir)) fs.rmSync(tempAdrDir, { recursive: true });

      try {
        const syncResult = await service.syncAdrsBidirectional("ws-1", "repo-1", {
          direction: "BIDIRECTIONAL",
          adrDirectory: "tmp-test-sync",
        });

        expect(syncResult.exportedCount).toBeGreaterThanOrEqual(1);
        expect(syncResult.syncedFiles.length).toBeGreaterThan(0);
      } finally {
        if (fs.existsSync(tempAdrDir)) fs.rmSync(tempAdrDir, { recursive: true });
      }
    });

    it("prevents arbitrary directory traversal attacks in ADR directory resolution", () => {
      expect(() =>
        (service as any).resolveAdrDirectory("../../../../etc"),
      ).toThrow();
      expect(() =>
        (service as any).resolveAdrDirectory("foo/../../../../outside"),
      ).toThrow();
    });

    it("enforces role-based permissions preventing viewers from accepting decisions", async () => {
      prisma.workspaceMember = {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: "ws-1",
          userId: "viewer-user-1",
          role: "VIEWER",
        }),
      };

      await expect(
        service.acceptDecision(
          "ws-1",
          "repo-1",
          "dec-1",
          { reviewNotes: "Viewer attempting acceptance" },
          { id: "viewer-user-1", email: "viewer@org.com", name: "Viewer" } as any,
        ),
      ).rejects.toThrow("Workspace viewers are not permitted");
    });
  });
});
