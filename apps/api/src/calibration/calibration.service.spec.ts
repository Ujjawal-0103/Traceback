import { Test, TestingModule } from "@nestjs/testing";
import { CalibrationService } from "./calibration.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotFoundException } from "@nestjs/common";

describe("CalibrationService", () => {
  let service: CalibrationService;

  const mockPrisma = {
    workspace: {
      findUnique: jest.fn(),
    },
    claim: {
      findMany: jest.fn(),
    },
    engineeringDecision: {
      findMany: jest.fn(),
    },
    commitDiff: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    repository: {
      findMany: jest.fn(),
    },
    verificationSession: {
      count: jest.fn().mockResolvedValue(1),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalibrationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CalibrationService>(CalibrationService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should throw NotFoundException if workspace does not exist", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.getWorkspaceCalibration("non-existent"),
    ).rejects.toThrow(NotFoundException);
  });

  it("should calculate correct telemetry distributions and rates", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValueOnce({ id: "ws-1" });

    // Claims setup
    mockPrisma.claim.findMany.mockResolvedValueOnce([
      // Claim 1: Supported by human
      {
        id: "c-1",
        humanVerdicts: [{ verdict: "SUPPORTED", decidedAt: new Date() }],
        assessments: [{ confidence: "HIGH_SUPPORT", createdAt: new Date() }],
        session: { targetFilePath: "src/table.ts", repositoryId: "repo-1" },
      },
      // Claim 2: Human override (AI said HIGH_SUPPORT, human said CONTRADICTED)
      {
        id: "c-2",
        humanVerdicts: [{ verdict: "CONTRADICTED", decidedAt: new Date() }],
        assessments: [{ confidence: "HIGH_SUPPORT", createdAt: new Date() }],
        session: { targetFilePath: "src/auth.ts", repositoryId: "repo-1" },
      },
      // Claim 3: Sparse evidence, no human review
      {
        id: "c-3",
        humanVerdicts: [],
        assessments: [{ confidence: "SPARSE_EVIDENCE", createdAt: new Date() }],
        session: { targetFilePath: "src/legacy.ts", repositoryId: "repo-1" },
      },
    ]);

    // Decisions setup
    mockPrisma.engineeringDecision.findMany.mockResolvedValueOnce([
      {
        id: "d-1",
        status: "ACCEPTED",
        repositoryId: "repo-1",
        targetFilePath: "src/table.ts",
        updatedAt: new Date("2026-01-01"),
      },
      {
        id: "d-2",
        status: "CANDIDATE",
        repositoryId: "repo-1",
      },
    ]);

    // No drift for d-1
    mockPrisma.commitDiff.findFirst.mockResolvedValueOnce(null);

    mockPrisma.repository.findMany.mockResolvedValueOnce([
      { id: "repo-1", fullName: "test/repo" },
    ]);

    mockPrisma.commitDiff.findMany.mockResolvedValueOnce([
      { filePath: "src/legacy.ts", commit: { repositoryId: "repo-1" } },
      { filePath: "src/legacy.ts", commit: { repositoryId: "repo-1" } },
    ]);

    const result = await service.getWorkspaceCalibration("ws-1");

    expect(result.workspaceId).toBe("ws-1");
    expect(result.verdictDistribution.total).toBe(3);
    expect(result.verdictDistribution.supported).toBe(1);
    expect(result.verdictDistribution.contradicted).toBe(1);
    expect(result.verdictDistribution.insufficientEvidence).toBe(1);

    expect(result.humanOversight.totalEvaluated).toBe(3);
    expect(result.humanOversight.humanReviewedCount).toBe(2);
    expect(result.humanOversight.overrideCount).toBe(1);
    expect(result.humanOversight.agreementCount).toBe(1);
    expect(result.humanOversight.overrideRate).toBe(50); // 1 of 2 is 50%

    expect(result.decisionHealth.total).toBe(2);
    expect(result.decisionHealth.accepted).toBe(1);
    expect(result.decisionHealth.needsReview).toBe(0);
    expect(result.decisionHealth.candidate).toBe(1);

    expect(result.contextBlindSpots.length).toBeGreaterThanOrEqual(1);
    expect(result.contextBlindSpots[0].filePath).toBe("src/legacy.ts");
    expect(result.contextBlindSpots[0].hasAcceptedDecision).toBe(false);
    expect((result as any).totals.extractedClaims).toBe(3);
    expect((result as any).verdictBreakdown.supported.count).toBe(1);
    expect((result as any).humanOversight.overrideRatePercent).toBe(50);
    expect((result as any).decisionHealth.freshDecisionsCount).toBe(1);
    expect(result.contextBlindSpots[0].riskScore).toBe("HIGH");
  });
});
