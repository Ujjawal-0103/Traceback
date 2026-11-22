import { Test, TestingModule } from "@nestjs/testing";
import { TelemetryController } from "./telemetry.controller";
import { TelemetryService } from "./telemetry.service";
import { WorkspaceGuard } from "../workspaces/workspace.guard";
import { AuthGuard } from "../auth/auth.guard";
import { CalibrationScorecardDto } from "@traceback/shared-types";

describe("TelemetryController", () => {
  let controller: TelemetryController;
  let serviceMock: {
    getCalibrationScorecard: jest.Mock;
  };

  const sampleScorecard: CalibrationScorecardDto = {
    workspaceId: "ws_alpha",
    totalVerifications: 5,
    totalClaims: 12,
    effectiveTrustScore: 68.5,
    aiGroundedRate: 75.0,
    effectiveGroundedRate: 66.7,
    groundedRate: 66.7,
    abstentionRate: 16.7,
    contradictedRate: 8.3,
    mixedRate: 8.3,
    overrideRate: 33.3,
    verdictBreakdown: {
      supported: { count: 8, percentage: 66.7 },
      contradicted: { count: 1, percentage: 8.3 },
      mixed: { count: 1, percentage: 8.3 },
      insufficientEvidence: { count: 2, percentage: 16.7 },
    },
    effectiveVerdictBreakdown: {
      supported: { count: 8, percentage: 66.7 },
      contradicted: { count: 1, percentage: 8.3 },
      mixed: { count: 1, percentage: 8.3 },
      insufficientEvidence: { count: 2, percentage: 16.7 },
    },
    aiVerdictBreakdown: {
      supported: { count: 9, percentage: 75.0 },
      contradicted: { count: 0, percentage: 0 },
      mixed: { count: 1, percentage: 8.3 },
      insufficientEvidence: { count: 2, percentage: 16.7 },
    },
    humanOverride: {
      totalReviewed: 3,
      agreedCount: 2,
      overrideCount: 1,
      overrideRate: 33.3,
      hasHumanReviews: true,
    },
    blindSpots: [],
    sessionTrend: [
      {
        sessionId: "sess_1",
        label: "proxy.ts",
        trustScore: 75,
        supportedCount: 3,
        contradictedCount: 0,
        abstainedCount: 1,
      },
    ],
    calibrationQuadrants: {
      verifiedGrounded: 8,
      silentHallucinations: 1,
      caughtContradictions: 0,
      safeAbstentions: 2,
    },
    recentDisagreements: [],
    summaryTimestamp: "2026-11-21T12:00:00Z",
  };

  beforeEach(async () => {
    serviceMock = {
      getCalibrationScorecard: jest.fn().mockResolvedValue(sampleScorecard),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [
        {
          provide: TelemetryService,
          useValue: serviceMock,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TelemetryController>(TelemetryController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should return the calibration scorecard for a workspace", async () => {
    const result = await controller.getCalibrationScorecard("ws_alpha");
    expect(serviceMock.getCalibrationScorecard).toHaveBeenCalledWith(
      "ws_alpha",
    );
    expect(result).toEqual(sampleScorecard);
  });
});
