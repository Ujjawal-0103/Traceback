import { Test, TestingModule } from "@nestjs/testing";
import { TelemetryService } from "./telemetry.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AIAssessmentConfidence,
  HumanVerdict,
  SessionStatus,
} from "@prisma/client";

describe("TelemetryService — AI Hallucination & Calibration Scorecard", () => {
  let service: TelemetryService;
  let prismaMock: {
    verificationSession: {
      findMany: jest.Mock;
    };
    commitDiff: {
      findMany: jest.Mock;
    };
    engineeringDecision: {
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prismaMock = {
      verificationSession: {
        findMany: jest.fn(),
      },
      commitDiff: {
        findMany: jest.fn(),
      },
      engineeringDecision: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<TelemetryService>(TelemetryService);
  });

  describe("Zero-data / Empty Workspace Safety", () => {
    it("should return clean zero metrics and null override rate without divide-by-zero errors", async () => {
      prismaMock.verificationSession.findMany.mockResolvedValue([]);

      const result = await service.getCalibrationScorecard("ws_empty");

      expect(result.workspaceId).toBe("ws_empty");
      expect(result.totalVerifications).toBe(0);
      expect(result.totalClaims).toBe(0);
      expect(result.groundedRate).toBe(0);
      expect(result.abstentionRate).toBe(0);
      expect(result.contradictedRate).toBe(0);
      expect(result.mixedRate).toBe(0);

      expect(result.verdictBreakdown).toEqual({
        supported: { count: 0, percentage: 0 },
        contradicted: { count: 0, percentage: 0 },
        mixed: { count: 0, percentage: 0 },
        insufficientEvidence: { count: 0, percentage: 0 },
      });

      expect(result.humanOverride).toEqual({
        totalReviewed: 0,
        agreedCount: 0,
        overrideCount: 0,
        overrideRate: null,
        hasHumanReviews: false,
      });

      expect(result.blindSpots).toEqual([]);
      expect(result.sessionTrend).toEqual([]);
      expect(result.calibrationQuadrants).toEqual({
        verifiedGrounded: 0,
        silentHallucinations: 0,
        caughtContradictions: 0,
        safeAbstentions: 0,
      });
      expect(result.recentDisagreements).toEqual([]);
      expect(typeof result.summaryTimestamp).toBe("string");
    });
  });

  describe("Verdict Breakdown & Calibration Rates", () => {
    it("should accurately aggregate verdicts and compute percentage rates", async () => {
      const mockSessions = [
        {
          id: "sess_1",
          workspaceId: "ws_alpha",
          targetFilePath: "src/auth/jwt.service.ts",
          createdAt: new Date("2026-11-20T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "claim_1",
              text: "JWT tokens expire after 15 minutes",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT, // SUPPORTED
              humanVerdict: null,
              evidence: [{ filePath: "src/auth/jwt.service.ts" }],
            },
            {
              id: "claim_2",
              text: "Legacy auth bypasses rate limits",
              preliminaryConfidence: AIAssessmentConfidence.CONTRADICTED, // CONTRADICTED
              humanVerdict: null,
              evidence: [{ filePath: "src/auth/jwt.service.ts" }],
            },
          ],
        },
        {
          id: "sess_2",
          workspaceId: "ws_alpha",
          targetFilePath: "src/billing/stripe.ts",
          createdAt: new Date("2026-11-21T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "claim_3",
              text: "Webhook retries are backed off quadratically",
              preliminaryConfidence: AIAssessmentConfidence.PARTIAL_SUPPORT, // MIXED
              humanVerdict: null,
              evidence: [{ filePath: "src/billing/stripe.ts" }],
            },
            {
              id: "claim_4",
              text: "Custom refunds require secondary approval",
              preliminaryConfidence: AIAssessmentConfidence.SPARSE_EVIDENCE, // INSUFFICIENT_EVIDENCE
              humanVerdict: null,
              evidence: [],
            },
          ],
        },
      ];

      prismaMock.verificationSession.findMany.mockResolvedValue(mockSessions);
      prismaMock.commitDiff.findMany.mockResolvedValue([]);
      prismaMock.engineeringDecision.findMany.mockResolvedValue([]);

      const result = await service.getCalibrationScorecard("ws_alpha");

      expect(result.totalVerifications).toBe(2);
      expect(result.totalClaims).toBe(4);

      // 1 out of 4 each = 25.0%
      expect(result.groundedRate).toBe(25);
      expect(result.abstentionRate).toBe(25);
      expect(result.contradictedRate).toBe(25);
      expect(result.mixedRate).toBe(25);

      expect(result.verdictBreakdown.supported).toEqual({
        count: 1,
        percentage: 25,
      });
      expect(result.verdictBreakdown.contradicted).toEqual({
        count: 1,
        percentage: 25,
      });
      expect(result.verdictBreakdown.mixed).toEqual({
        count: 1,
        percentage: 25,
      });
      expect(result.verdictBreakdown.insufficientEvidence).toEqual({
        count: 1,
        percentage: 25,
      });
    });
  });

  describe("Human-vs-AI Override Rate", () => {
    it("should compute override rate when human adjudicates claims", async () => {
      const mockSessions = [
        {
          id: "sess_1",
          workspaceId: "ws_alpha",
          targetFilePath: "src/gateway/proxy.ts",
          createdAt: new Date("2026-11-21T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            // Claim 1: AI says HIGH_SUPPORT, human confirms SUPPORTED -> Agree
            {
              id: "c1",
              text: "Proxy retries idempotently",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: HumanVerdict.SUPPORTED,
              evidence: [],
            },
            // Claim 2: AI says HIGH_SUPPORT, human overrides CONTRADICTED -> Override
            {
              id: "c2",
              text: "Proxy buffers entire response in memory",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: HumanVerdict.CONTRADICTED,
              evidence: [],
            },
            // Claim 3: AI says SPARSE_EVIDENCE, human overturns to SUPPORTED -> Override
            {
              id: "c3",
              text: "Proxy limits upstream connections to 100",
              preliminaryConfidence: AIAssessmentConfidence.SPARSE_EVIDENCE,
              humanVerdict: HumanVerdict.SUPPORTED,
              evidence: [],
            },
            // Claim 4: AI says SPARSE_EVIDENCE, human agrees UNVERIFIED -> Agree
            {
              id: "c4",
              text: "Proxy timeout is 30 seconds",
              preliminaryConfidence: AIAssessmentConfidence.SPARSE_EVIDENCE,
              humanVerdict: HumanVerdict.UNVERIFIED,
              evidence: [],
            },
            // Claim 5: Unreviewed claim -> Should not affect reviewed denominator
            {
              id: "c5",
              text: "Proxy logs request headers",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: null,
              evidence: [],
            },
          ],
        },
      ];

      prismaMock.verificationSession.findMany.mockResolvedValue(mockSessions);
      prismaMock.commitDiff.findMany.mockResolvedValue([]);
      prismaMock.engineeringDecision.findMany.mockResolvedValue([]);

      const result = await service.getCalibrationScorecard("ws_alpha");

      expect(result.humanOverride.totalReviewed).toBe(4);
      expect(result.humanOverride.agreedCount).toBe(2);
      expect(result.humanOverride.overrideCount).toBe(2);
      expect(result.humanOverride.overrideRate).toBe(50); // 2 / 4 = 50.0%
      expect(result.humanOverride.hasHumanReviews).toBe(true);
    });

    it("should dynamically lower the Effective Trust Score and update verdict counts when human overrides AI claims to CONTRADICTED", async () => {
      // Scenario A: Clean baseline where AI believes all 3 claims are HIGH_SUPPORT and human has not reviewed yet
      const unreviewedSessions = [
        {
          id: "sess_baseline",
          workspaceId: "ws_alpha",
          targetFilePath: "src/auth/token.ts",
          createdAt: new Date("2026-11-21T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "c1",
              text: "Token expiration is validated",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: null,
              evidence: [],
            },
            {
              id: "c2",
              text: "Token signature uses RS256",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: null,
              evidence: [],
            },
            {
              id: "c3",
              text: "Token revocation list is cached",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: null,
              evidence: [],
            },
          ],
        },
      ];

      prismaMock.verificationSession.findMany.mockResolvedValue(
        unreviewedSessions,
      );
      prismaMock.commitDiff.findMany.mockResolvedValue([]);
      prismaMock.engineeringDecision.findMany.mockResolvedValue([]);

      const baselineResult = await service.getCalibrationScorecard("ws_alpha");
      expect(baselineResult.effectiveTrustScore).toBe(100);
      expect(baselineResult.aiGroundedRate).toBe(100);
      expect(baselineResult.effectiveGroundedRate).toBe(100);
      expect(baselineResult.verdictBreakdown.contradicted.count).toBe(0);

      // Scenario B: Human reviewer catches an AI hallucination and marks c1 as CONTRADICTED
      const overriddenSessions = [
        {
          id: "sess_baseline",
          workspaceId: "ws_alpha",
          targetFilePath: "src/auth/token.ts",
          createdAt: new Date("2026-11-21T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "c1",
              text: "Token expiration is validated",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT, // AI thought HIGH_SUPPORT
              humanVerdict: HumanVerdict.CONTRADICTED, // Human caught false claim!
              evidence: [],
            },
            {
              id: "c2",
              text: "Token signature uses RS256",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: HumanVerdict.SUPPORTED, // Human verified
              evidence: [],
            },
            {
              id: "c3",
              text: "Token revocation list is cached",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: null,
              evidence: [],
            },
          ],
        },
      ];

      prismaMock.verificationSession.findMany.mockResolvedValue(
        overriddenSessions,
      );

      const overriddenResult =
        await service.getCalibrationScorecard("ws_alpha");

      // Effective grounded rate should drop from 3/3 (100%) to 2/3 (66.7%)
      expect(overriddenResult.effectiveGroundedRate).toBe(66.7);
      // AI grounded rate preserves raw AI guess
      expect(overriddenResult.aiGroundedRate).toBe(100);
      // Contradicted count should now be 1 in effective breakdown
      expect(overriddenResult.verdictBreakdown.contradicted.count).toBe(1);
      expect(overriddenResult.verdictBreakdown.contradicted.percentage).toBe(
        33.3,
      );
      expect(overriddenResult.aiVerdictBreakdown.contradicted.count).toBe(0);

      // Effective Trust Score must be penalized significantly (dropped from 100)
      expect(overriddenResult.effectiveTrustScore).toBeLessThan(
        baselineResult.effectiveTrustScore,
      );
      expect(overriddenResult.effectiveTrustScore).toBeLessThanOrEqual(50);
    });

    it("should lower Effective Trust Score when overriding an AI SPARSE_EVIDENCE claim with CONTRADICTED", async () => {
      const mockSessions = [
        {
          id: "sess_abstention",
          workspaceId: "ws_alpha",
          targetFilePath: "src/crypto/cipher.ts",
          createdAt: new Date("2026-11-21T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "c1",
              text: "AES key size is 256 bits",
              preliminaryConfidence: AIAssessmentConfidence.SPARSE_EVIDENCE,
              humanVerdict: HumanVerdict.CONTRADICTED, // Overridden from sparse to contradicted
              evidence: [],
            },
            {
              id: "c2",
              text: "IV is generated randomly",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: HumanVerdict.SUPPORTED,
              evidence: [],
            },
          ],
        },
      ];

      prismaMock.verificationSession.findMany.mockResolvedValue(mockSessions);
      prismaMock.commitDiff.findMany.mockResolvedValue([]);
      prismaMock.engineeringDecision.findMany.mockResolvedValue([]);

      const result = await service.getCalibrationScorecard("ws_alpha");

      // Effective breakdown has 1 supported and 1 contradicted (0 insufficient)
      expect(result.verdictBreakdown.supported.count).toBe(1);
      expect(result.verdictBreakdown.contradicted.count).toBe(1);
      expect(result.verdictBreakdown.insufficientEvidence.count).toBe(0);

      // Raw AI breakdown has 1 supported and 1 insufficient
      expect(result.aiVerdictBreakdown.supported.count).toBe(1);
      expect(result.aiVerdictBreakdown.insufficientEvidence.count).toBe(1);
      expect(result.aiVerdictBreakdown.contradicted.count).toBe(0);

      // Score should reflect the contradiction penalty
      expect(result.contradictedRate).toBe(50);
      expect(result.effectiveTrustScore).toBeLessThan(50);
    });
  });

  describe("Context Blind-Spot Map", () => {
    it("should rank under-documented files triggering INSUFFICIENT_EVIDENCE and attach commit churn & decision status", async () => {
      const mockSessions = [
        {
          id: "sess_1",
          workspaceId: "ws_alpha",
          targetFilePath: "src/auth/session-cache.ts",
          createdAt: new Date("2026-11-21T08:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "c1",
              text: "Redis cache TTL is 3600 seconds",
              preliminaryConfidence: AIAssessmentConfidence.SPARSE_EVIDENCE,
              humanVerdict: null,
              evidence: [{ filePath: "src/auth/session-cache.ts" }],
            },
          ],
        },
        {
          id: "sess_2",
          workspaceId: "ws_alpha",
          targetFilePath: "src/auth/session-cache.ts",
          createdAt: new Date("2026-11-21T12:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "c2",
              text: "Redis reconnects with exponential backoff",
              preliminaryConfidence: AIAssessmentConfidence.SPARSE_EVIDENCE,
              humanVerdict: null,
              evidence: [{ filePath: "src/auth/session-cache.ts" }],
            },
          ],
        },
        {
          id: "sess_3",
          workspaceId: "ws_alpha",
          targetFilePath: "src/db/connection-pool.ts",
          createdAt: new Date("2026-11-20T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            {
              id: "c3",
              text: "Max connections is 20",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: null,
              evidence: [{ filePath: "src/db/connection-pool.ts" }],
            },
          ],
        },
      ];

      prismaMock.verificationSession.findMany.mockResolvedValue(mockSessions);

      // Churn diffs: session-cache has 5 commits, connection-pool has 2 commits
      prismaMock.commitDiff.findMany.mockResolvedValue([
        { filePath: "src/auth/session-cache.ts" },
        { filePath: "src/auth/session-cache.ts" },
        { filePath: "src/auth/session-cache.ts" },
        { filePath: "src/auth/session-cache.ts" },
        { filePath: "src/auth/session-cache.ts" },
        { filePath: "src/db/connection-pool.ts" },
        { filePath: "src/db/connection-pool.ts" },
      ]);

      // Engineering decisions: connection-pool is ACCEPTED, session-cache has none
      prismaMock.engineeringDecision.findMany.mockResolvedValue([
        {
          targetFilePath: "src/db/connection-pool.ts",
          status: "ACCEPTED",
        },
      ]);

      const result = await service.getCalibrationScorecard("ws_alpha");

      expect(result.blindSpots.length).toBeGreaterThanOrEqual(1);

      const topBlindSpot = result.blindSpots[0];
      expect(topBlindSpot.filePath).toBe("src/auth/session-cache.ts");
      expect(topBlindSpot.insufficientEvidenceCount).toBeGreaterThan(0);
      expect(topBlindSpot.commitChurnCount).toBe(5);
      expect(topBlindSpot.hasAcceptedDecision).toBe(false);
      expect(topBlindSpot.suggestedAction).toBe("DOCUMENT_DECISION");
      expect(topBlindSpot.repositoryName).toBe("org/core-api");

      // Connection pool has an accepted decision
      const coveredSpot = result.blindSpots.find(
        (b) => b.filePath === "src/db/connection-pool.ts",
      );
      if (coveredSpot) {
        expect(coveredSpot.hasAcceptedDecision).toBe(true);
        expect(coveredSpot.suggestedAction).toBe("COVERED");
      }
    });
  });

  describe("Derived Epistemological Structures: Session Trend, Quadrants & Disagreements", () => {
    it("should compute chronological session trend, 4-quadrant honesty matrix, and recent disagreements", async () => {
      const mockSessions = [
        {
          id: "sess_recent_2",
          workspaceId: "ws_alpha",
          targetFilePath: "src/auth/jwt.ts",
          createdAt: new Date("2026-11-21T14:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            // High support overridden to contradicted -> Silent Hallucination
            {
              id: "claim_silent",
              text: "JWT expiration is strictly 15 minutes",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: HumanVerdict.CONTRADICTED,
              evidence: [{ filePath: "src/auth/jwt.ts" }],
            },
            // High support verified supported -> Verified Grounded
            {
              id: "claim_grounded",
              text: "Tokens are signed with RSA-256",
              preliminaryConfidence: AIAssessmentConfidence.HIGH_SUPPORT,
              humanVerdict: HumanVerdict.SUPPORTED,
              evidence: [{ filePath: "src/auth/jwt.ts" }],
            },
          ],
        },
        {
          id: "sess_earlier_1",
          workspaceId: "ws_alpha",
          targetFilePath: "src/db/pool.ts",
          createdAt: new Date("2026-11-20T10:00:00Z"),
          repository: { id: "repo_1", fullName: "org/core-api" },
          claims: [
            // AI says CONTRADICTED and was contradicted -> Caught Contradiction
            {
              id: "claim_caught",
              text: "Pool size defaults to 500",
              preliminaryConfidence: AIAssessmentConfidence.CONTRADICTED,
              humanVerdict: HumanVerdict.CONTRADICTED,
              evidence: [{ filePath: "src/db/pool.ts" }],
            },
            // AI says SPARSE_EVIDENCE unreviewed -> Safe Abstention
            {
              id: "claim_abstained",
              text: "Pool connection timeout is configurable via env",
              preliminaryConfidence: AIAssessmentConfidence.SPARSE_EVIDENCE,
              humanVerdict: null,
              evidence: [{ filePath: "src/db/pool.ts" }],
            },
          ],
        },
      ];

      prismaMock.verificationSession.findMany.mockResolvedValue(mockSessions);
      prismaMock.commitDiff.findMany.mockResolvedValue([]);
      prismaMock.engineeringDecision.findMany.mockResolvedValue([]);

      const result = await service.getCalibrationScorecard("ws_alpha");

      // Session Trend (ordered oldest to newest: earlier_1, then recent_2)
      expect(result.sessionTrend.length).toBe(2);
      expect(result.sessionTrend[0].sessionId).toBe("sess_earlier_1");
      expect(result.sessionTrend[0].label).toBe("pool.ts");
      expect(typeof result.sessionTrend[0].trustScore).toBe("number");
      expect(result.sessionTrend[1].sessionId).toBe("sess_recent_2");
      expect(result.sessionTrend[1].label).toBe("jwt.ts");

      // 4-Quadrant Honesty Matrix
      expect(result.calibrationQuadrants.verifiedGrounded).toBe(1);
      expect(result.calibrationQuadrants.silentHallucinations).toBe(1);
      expect(result.calibrationQuadrants.caughtContradictions).toBe(1);
      expect(result.calibrationQuadrants.safeAbstentions).toBe(1);

      // Recent Disagreements
      expect(result.recentDisagreements.length).toBeGreaterThanOrEqual(1);
      const disagreement = result.recentDisagreements[0];
      expect(disagreement.claimId).toBe("claim_silent");
      expect(disagreement.claimText).toBe(
        "JWT expiration is strictly 15 minutes",
      );
      expect(disagreement.machineVerdict).toBe("SUPPORTED");
      expect(disagreement.humanVerdict).toBe(HumanVerdict.CONTRADICTED);
      expect(disagreement.filePath).toBe("src/auth/jwt.ts");
    });
  });
});
