import { Test, TestingModule } from "@nestjs/testing";
import { CalibrationController } from "./calibration.controller";
import { CalibrationService } from "./calibration.service";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";

describe("CalibrationController", () => {
  let controller: CalibrationController;
  let service: jest.Mocked<CalibrationService>;

  const mockCalibrationResult: any = {
    workspaceId: "ws-test",
    calculatedAt: "2026-11-22T06:00:00.000Z",
    totals: {
      verifiedSessions: 5,
      extractedClaims: 20,
      humanReviews: 10,
    },
    verdictBreakdown: {
      supported: { count: 12, percentage: 60 },
      contradicted: { count: 4, percentage: 20 },
      insufficientEvidence: { count: 2, percentage: 10 },
      mixed: { count: 2, percentage: 10 },
    },
    verdictDistribution: {
      total: 20,
      supported: 12,
      supportedPct: 60,
      contradicted: 4,
      contradictedPct: 20,
      mixed: 2,
      mixedPct: 10,
      insufficientEvidence: 2,
      insufficientEvidencePct: 10,
    },
    humanOversight: {
      totalEvaluated: 20,
      totalReviewed: 10,
      humanReviewedCount: 10,
      humanReviewRate: 50,
      agreementCount: 8,
      overrideCount: 2,
      overridden: 2,
      overrideRate: 20,
      overrideRatePercent: 20,
      averageConfidence: 0.85,
    },
    decisionHealth: {
      total: 10,
      totalDecisions: 10,
      accepted: 8,
      freshDecisionsCount: 8,
      needsReview: 2,
      staleDecisionsCount: 2,
      superseded: 0,
      rejected: 0,
      candidate: 0,
    },
    contextBlindSpots: [],
  };

  beforeEach(async () => {
    const mockService = {
      getWorkspaceCalibration: jest
        .fn()
        .mockResolvedValue(mockCalibrationResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalibrationController],
      providers: [
        {
          provide: CalibrationService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CalibrationController>(CalibrationController);
    service = module.get(CalibrationService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should return workspace calibration telemetry from service", async () => {
    const result = await controller.getCalibration("ws-test");
    expect(service.getWorkspaceCalibration).toHaveBeenCalledWith("ws-test");
    expect(result.workspaceId).toBe("ws-test");
    expect((result as any).totals.verifiedSessions).toBe(5);
    expect((result as any).verdictBreakdown.supported.count).toBe(12);
  });
});
