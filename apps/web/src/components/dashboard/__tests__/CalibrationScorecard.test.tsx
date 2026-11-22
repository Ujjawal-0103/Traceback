import React from "react";
import { render, screen } from "@testing-library/react";
import { CalibrationScorecard } from "../CalibrationScorecard";
import { WorkspaceCalibrationDto } from "@traceback/shared-types";

describe("CalibrationScorecard", () => {
  const mockCalibration: WorkspaceCalibrationDto = {
    workspaceId: "ws-1",
    verdictDistribution: {
      total: 10,
      supported: 6,
      supportedPct: 60,
      contradicted: 2,
      contradictedPct: 20,
      mixed: 1,
      mixedPct: 10,
      insufficientEvidence: 1,
      insufficientEvidencePct: 10,
    },
    humanOversight: {
      totalEvaluated: 10,
      humanReviewedCount: 5,
      humanReviewRate: 50,
      agreementCount: 4,
      overrideCount: 1,
      overrideRate: 20,
    },
    decisionHealth: {
      total: 8,
      accepted: 5,
      needsReview: 1,
      superseded: 1,
      rejected: 0,
      candidate: 1,
    },
    contextBlindSpots: [
      {
        repositoryId: "repo-1",
        repositoryName: "test/repo",
        filePath: "src/concurrency/lock.ts",
        commitCount: 12,
        insufficientEvidenceHits: 3,
        hasAcceptedDecision: false,
      },
    ],
  };

  it("should render loading state when isLoading is true", () => {
    render(<CalibrationScorecard calibration={null} isLoading={true} />);
    expect(
      screen.getByText(/loading calibration telemetry\.\.\./i),
    ).toBeInTheDocument();
  });

  it("should render null when calibration is null and not loading", () => {
    const { container } = render(
      <CalibrationScorecard calibration={null} isLoading={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render telemetry metrics, distributions, and blind spots correctly", () => {
    render(<CalibrationScorecard calibration={mockCalibration} />);

    // Verdict distribution
    expect(screen.getByText(/Workspace Calibration/i)).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getAllByText("20%").length).toBeGreaterThanOrEqual(1);

    // Human oversight
    expect(screen.getByText(/Human Override Rate/i)).toBeInTheDocument();
    expect(screen.getByText(/4 claims/i)).toBeInTheDocument();
    expect(screen.getByText(/1 claims/i)).toBeInTheDocument();

    // Decision freshness
    expect(screen.getByText(/⚠️ 1/i)).toBeInTheDocument();

    // Blind spots
    expect(screen.getByText("src/concurrency/lock.ts")).toBeInTheDocument();
    expect(screen.getByText("Blind Spot (No Decision)")).toBeInTheDocument();
    expect(screen.getByText("Explain & Verify →")).toBeInTheDocument();
  });
});
