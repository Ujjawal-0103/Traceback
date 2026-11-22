import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CalibrationScorecard } from "./CalibrationScorecard";
import { api } from "../lib/api";
import { CalibrationScorecardDto } from "@traceback/shared-types";

jest.mock("../lib/api", () => {
  const original = jest.requireActual("../lib/api");
  return {
    ...original,
    api: {
      ...original.api,
      getCalibrationScorecard: jest.fn(),
    },
  };
});

describe("CalibrationScorecard Component — Deliverable #4 Trust Dashboard", () => {
  const samplePopulatedScorecard: CalibrationScorecardDto = {
    workspaceId: "ws_alpha",
    totalVerifications: 14,
    totalClaims: 38,
    effectiveTrustScore: 74.2,
    aiGroundedRate: 68.4,
    effectiveGroundedRate: 63.2,
    groundedRate: 63.2,
    abstentionRate: 21.1,
    contradictedRate: 10.5,
    mixedRate: 5.3,
    overrideRate: 20.0,
    verdictBreakdown: {
      supported: { count: 24, percentage: 63.2 },
      contradicted: { count: 4, percentage: 10.5 },
      mixed: { count: 2, percentage: 5.3 },
      insufficientEvidence: { count: 8, percentage: 21.1 },
    },
    effectiveVerdictBreakdown: {
      supported: { count: 24, percentage: 63.2 },
      contradicted: { count: 4, percentage: 10.5 },
      mixed: { count: 2, percentage: 5.3 },
      insufficientEvidence: { count: 8, percentage: 21.1 },
    },
    aiVerdictBreakdown: {
      supported: { count: 26, percentage: 68.4 },
      contradicted: { count: 2, percentage: 5.3 },
      mixed: { count: 2, percentage: 5.3 },
      insufficientEvidence: { count: 8, percentage: 21.1 },
    },
    humanOverride: {
      totalReviewed: 10,
      agreedCount: 8,
      overrideCount: 2,
      overrideRate: 20.0,
      hasHumanReviews: true,
    },
    blindSpots: [
      {
        filePath: "src/auth/session-cache.ts",
        repositoryId: "repo_1",
        repositoryName: "org/core-engine",
        insufficientEvidenceCount: 6,
        totalQueries: 8,
        commitChurnCount: 15,
        hasAcceptedDecision: false,
        decisionsCount: 0,
        suggestedAction: "DOCUMENT_DECISION",
        lastQueriedAt: new Date().toISOString(),
      },
      {
        filePath: "src/db/connection-pool.ts",
        repositoryId: "repo_1",
        repositoryName: "org/core-engine",
        insufficientEvidenceCount: 2,
        totalQueries: 4,
        commitChurnCount: 8,
        hasAcceptedDecision: true,
        decisionsCount: 1,
        suggestedAction: "COVERED",
        lastQueriedAt: new Date().toISOString(),
      },
    ],
    sessionTrend: [
      {
        sessionId: "sess_1",
        label: "pool.ts",
        trustScore: 65,
        supportedCount: 2,
        contradictedCount: 1,
        abstainedCount: 1,
      },
      {
        sessionId: "sess_2",
        label: "jwt.ts",
        trustScore: 82,
        supportedCount: 4,
        contradictedCount: 0,
        abstainedCount: 1,
      },
    ],
    calibrationQuadrants: {
      verifiedGrounded: 24,
      silentHallucinations: 2,
      caughtContradictions: 2,
      safeAbstentions: 8,
    },
    recentDisagreements: [
      {
        claimId: "c_silent_1",
        sessionId: "sess_2",
        claimText: "Session tokens are revoked instantly across cluster",
        filePath: "src/auth/session-cache.ts",
        machineVerdict: "SUPPORTED",
        humanVerdict: "CONTRADICTED",
      },
    ],
    summaryTimestamp: new Date().toISOString(),
  };

  const sampleEmptyScorecard: CalibrationScorecardDto = {
    workspaceId: "ws_alpha",
    totalVerifications: 0,
    totalClaims: 0,
    effectiveTrustScore: 0,
    aiGroundedRate: 0,
    effectiveGroundedRate: 0,
    groundedRate: 0,
    abstentionRate: 0,
    contradictedRate: 0,
    mixedRate: 0,
    overrideRate: null,
    verdictBreakdown: {
      supported: { count: 0, percentage: 0 },
      contradicted: { count: 0, percentage: 0 },
      mixed: { count: 0, percentage: 0 },
      insufficientEvidence: { count: 0, percentage: 0 },
    },
    effectiveVerdictBreakdown: {
      supported: { count: 0, percentage: 0 },
      contradicted: { count: 0, percentage: 0 },
      mixed: { count: 0, percentage: 0 },
      insufficientEvidence: { count: 0, percentage: 0 },
    },
    aiVerdictBreakdown: {
      supported: { count: 0, percentage: 0 },
      contradicted: { count: 0, percentage: 0 },
      mixed: { count: 0, percentage: 0 },
      insufficientEvidence: { count: 0, percentage: 0 },
    },
    humanOverride: {
      totalReviewed: 0,
      agreedCount: 0,
      overrideCount: 0,
      overrideRate: null,
      hasHumanReviews: false,
    },
    blindSpots: [],
    sessionTrend: [],
    calibrationQuadrants: {
      verifiedGrounded: 0,
      silentHallucinations: 0,
      caughtContradictions: 0,
      safeAbstentions: 0,
    },
    recentDisagreements: [],
    summaryTimestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders loading skeleton initially while fetching telemetry", () => {
    (api.getCalibrationScorecard as jest.Mock).mockReturnValue(
      new Promise(() => {}),
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);
    expect(
      screen.getByTestId("calibration-scorecard-loading"),
    ).toBeInTheDocument();
  });

  it("renders error state when API request fails", async () => {
    (api.getCalibrationScorecard as jest.Mock).mockRejectedValue(
      new Error("Network connection error"),
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(
        screen.getByTestId("calibration-scorecard-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Telemetry Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Network connection error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry Telemetry" }),
    ).toBeInTheDocument();
  });

  it("renders clean empty state for a workspace with zero verification runs", async () => {
    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      sampleEmptyScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(
        screen.getByTestId("calibration-scorecard-empty"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("No Verification Sessions Recorded Yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Run First Verification/i }),
    ).toBeInTheDocument();
  });

  it("renders headline trust score with calibration grade, sparkline, and 3-column KPI strip", async () => {
    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      samplePopulatedScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("calibration-scorecard")).toBeInTheDocument();
    });

    // Headline Effective Trust Score Hero
    const trustScoreBanner = screen.getByTestId("kpi-trust-score");
    expect(trustScoreBanner).toHaveTextContent("74.2%");
    expect(trustScoreBanner).toHaveTextContent(
      "Rewards verified grounded claims; actively penalizes incorrect solutions",
    );
    expect(trustScoreBanner).toHaveTextContent("Human-Supervised Calibration");

    // Dynamic Calibration Grade Badge (74.2% -> Grade C)
    const gradeBadge = screen.getByTestId("calibration-grade-badge");
    expect(gradeBadge).toHaveTextContent("C");
    expect(gradeBadge).toHaveTextContent("Grade");

    // Trust Trajectory Sparkline
    expect(
      screen.getByTestId("trust-trajectory-sparkline"),
    ).toBeInTheDocument();

    // KPI 1: Total Verifications
    const totalKpi = screen.getByTestId("kpi-total-verifications");
    expect(totalKpi).toHaveTextContent("14");
    expect(totalKpi).toHaveTextContent("Across 38 decomposed claims");

    // KPI 2: Effective Grounded Rate with Delta vs AI
    const groundedKpi = screen.getByTestId("kpi-grounded-rate");
    expect(groundedKpi).toHaveTextContent("63.2%");
    expect(groundedKpi).toHaveTextContent("-5.2% vs AI");
    expect(groundedKpi).toHaveTextContent("SUPPORTED");

    // KPI 3: Explicit Abstention Rate & Contradiction Rate
    const abstentionKpi = screen.getByTestId("kpi-abstention-rate");
    expect(abstentionKpi).toHaveTextContent("21.1%");
    expect(abstentionKpi).toHaveTextContent("10.5% Contradicted");
    expect(abstentionKpi).toHaveTextContent("ABSTAINED");

    // Verify Human Override Rate card is strictly NOT rendered
    expect(screen.queryByTestId("kpi-override-rate")).not.toBeInTheDocument();
    expect(screen.queryByText(/2\/10 OVERRIDES/i)).not.toBeInTheDocument();
  });

  it("supports Simulate ADR Coverage toggle to preview projected Trust Score lift", async () => {
    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      samplePopulatedScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("simulate-adr-toggle")).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId("simulate-adr-toggle");
    expect(toggleBtn).toHaveTextContent("Simulate ADR Coverage");

    // Click toggle to enter simulation mode
    fireEvent.click(toggleBtn);

    // Simulated Preview pill should now be visible
    expect(screen.getByTestId("simulated-preview-pill")).toBeInTheDocument();
    expect(screen.getByText(/projected lift/i)).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent("Exit Simulation");

    // Click again to exit
    fireEvent.click(toggleBtn);
    expect(
      screen.queryByTestId("simulated-preview-pill"),
    ).not.toBeInTheDocument();
  });

  it("supports Copy Audit Snapshot button and copies formatted markdown to clipboard", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      samplePopulatedScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("copy-audit-btn")).toBeInTheDocument();
    });

    const copyBtn = screen.getByTestId("copy-audit-btn");
    expect(copyBtn).toHaveTextContent("Copy Audit Snapshot");

    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0][0]).toContain(
      "# Traceback AI Calibration & Trust Audit Snapshot",
    );
    expect(writeTextMock.mock.calls[0][0]).toContain(
      "**Headline Calibration & Trust Score**: 74.2%",
    );

    await waitFor(() => {
      expect(copyBtn).toHaveTextContent("Copied!");
    });
  });

  it("renders 4-Quadrant Honesty Matrix and Recent Disagreements feed", async () => {
    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      samplePopulatedScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(
        screen.getByTestId("honesty-quadrants-matrix"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Verified Grounded")).toBeInTheDocument();
    expect(screen.getByText("Silent Hallucinations")).toBeInTheDocument();
    expect(screen.getByText("Caught Contradictions")).toBeInTheDocument();
    expect(screen.getByText("Safe Abstentions")).toBeInTheDocument();

    // Check values in matrix
    expect(screen.getByText("24")).toBeInTheDocument(); // Verified Grounded count
    expect(
      screen.getByText(/Session tokens are revoked instantly across cluster/i),
    ).toBeInTheDocument();
    expect(screen.getByText("AI: SUPPORTED")).toBeInTheDocument();
    expect(screen.getByText("Human: CONTRADICTED")).toBeInTheDocument();
  });

  it("renders segmented verdict distribution bar and comparison with AI preliminary guesses", async () => {
    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      samplePopulatedScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(
        screen.getByTestId("verdict-breakdown-visual"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Effective Verdict Distribution (Human-Supervised)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI Preliminary Guess:/i)).toBeInTheDocument();
    expect(screen.getByText(/68.4% Supported/i)).toBeInTheDocument();
  });

  it("renders ranked Context Blind-Spot radar with severity badges, risk bars, and Document Fix CTAs", async () => {
    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      samplePopulatedScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("context-blind-spot-map")).toBeInTheDocument();
    });

    expect(screen.getByText("Context Blind-Spot Radar")).toBeInTheDocument();
    expect(
      screen.getAllByText("src/auth/session-cache.ts").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("src/db/connection-pool.ts")).toBeInTheDocument();
    expect(screen.getByText("15 commits")).toBeInTheDocument();
    expect(screen.getByText("⚠️ Missing Decision")).toBeInTheDocument();
    expect(screen.getByText("✓ Decision Accepted (1)")).toBeInTheDocument();

    // Severity pill checks
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("MODERATE")).toBeInTheDocument();

    const documentFixLink = screen.getByRole("link", {
      name: "Document Fix →",
    });
    expect(documentFixLink).toHaveAttribute(
      "href",
      "/decisions?repoId=repo_1&targetFilePath=src%2Fauth%2Fsession-cache.ts",
    );
  });

  it("reflects drop in headline trust score and increases contradicted count when incorrect claims are caught", async () => {
    const degradedScorecard: CalibrationScorecardDto = {
      ...samplePopulatedScorecard,
      effectiveTrustScore: 38.5,
      effectiveGroundedRate: 40.0,
      contradictedRate: 35.0,
      verdictBreakdown: {
        supported: { count: 8, percentage: 40.0 },
        contradicted: { count: 7, percentage: 35.0 },
        mixed: { count: 2, percentage: 10.0 },
        insufficientEvidence: { count: 3, percentage: 15.0 },
      },
    };

    (api.getCalibrationScorecard as jest.Mock).mockResolvedValue(
      degradedScorecard,
    );

    render(<CalibrationScorecard workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("kpi-trust-score")).toBeInTheDocument();
    });

    const trustBanner = screen.getByTestId("kpi-trust-score");
    expect(trustBanner).toHaveTextContent("38.5%");

    // Grade F for < 60
    const gradeBadge = screen.getByTestId("calibration-grade-badge");
    expect(gradeBadge).toHaveTextContent("F");

    const abstentionKpi = screen.getByTestId("kpi-abstention-rate");
    expect(abstentionKpi).toHaveTextContent("35% Contradicted");

    expect(screen.queryByTestId("kpi-override-rate")).not.toBeInTheDocument();
  });
});
