import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DecisionDriftBanner } from "../DecisionDriftBanner";
import { EngineeringDecisionDto } from "@traceback/shared-types";

describe("DecisionDriftBanner", () => {
  const baseDecision: EngineeringDecisionDto = {
    id: "dec-11112222",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    title: "Table Row Memoization",
    summary: "Memoize above 500 rows",
    decision: "Preserve memoization",
    rationale: "Prevents UI freezing",
    status: "ACCEPTED",
    severity: "HIGH",
    supportingEvidence: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("should render nothing when decision has no drift and no lineage", () => {
    const { container } = render(
      <DecisionDriftBanner
        decision={{ ...baseDecision, isPotentiallyStale: false }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render warning banner when decision is potentially stale", () => {
    const staleDecision: EngineeringDecisionDto = {
      ...baseDecision,
      isPotentiallyStale: true,
      driftStatus: "NEEDS_REVIEW",
      newerCommitCount: 3,
      latestDriftingCommitSha: "abc987654321",
      driftedFiles: ["src/table.ts"],
    };

    render(
      <DecisionDriftBanner
        decision={staleDecision}
        onConfirmValid={jest.fn()}
        onSupersede={jest.fn()}
      />,
    );

    expect(screen.getByText(/Decision Drift Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Needs Review/i)).toBeInTheDocument();
    expect(screen.getByText(/src\/table\.ts/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirm still valid/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /propose superseding decision/i }),
    ).toBeInTheDocument();
  });

  it("should trigger onConfirmValid when confirm button clicked", async () => {
    const onConfirmMock = jest.fn().mockResolvedValue(undefined);
    const staleDecision: EngineeringDecisionDto = {
      ...baseDecision,
      isPotentiallyStale: true,
      driftStatus: "NEEDS_REVIEW",
    };

    render(
      <DecisionDriftBanner
        decision={staleDecision}
        onConfirmValid={onConfirmMock}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /confirm still valid/i }),
      );
    });

    expect(onConfirmMock).toHaveBeenCalledWith("dec-11112222");
  });

  it("should display lineage indicators when supersedesId is set", () => {
    const lineageDecision: EngineeringDecisionDto = {
      ...baseDecision,
      supersedesId: "old-dec-9999",
    };

    render(<DecisionDriftBanner decision={lineageDecision} />);
    expect(
      screen.getByText(/Supersedes previous decision/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/DEC-old-dec-/i)).toBeInTheDocument();
  });
});
