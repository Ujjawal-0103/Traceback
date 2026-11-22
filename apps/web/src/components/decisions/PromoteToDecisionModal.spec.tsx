import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PromoteToDecisionModal } from "./PromoteToDecisionModal";
import { adrSyncApi } from "../../lib/adr-sync-api";

jest.mock("../../lib/adr-sync-api", () => ({
  adrSyncApi: {
    promoteClaimToDecision: jest.fn(),
  },
}));

describe("PromoteToDecisionModal Component", () => {
  const mockProps = {
    claimId: "claim-101",
    sessionId: "session-202",
    repositoryId: "repo-303",
    claimText:
      "Redis TTL is strictly configured to 60s to prevent stale reads.",
    targetSymbol: "CACHE_TTL",
    targetFilePath: "src/cache/redis.ts",
    explanation: "Cache must use Redis TTL of 60 seconds to avoid stale reads.",
    evidence: [
      {
        sourceType: "COMMIT",
        referenceKey: "a1b2c3d",
        title: "Add 60s Redis TTL constraint",
        snippet: "const CACHE_TTL = 60;",
        url: "https://github.com/org/repo/commit/a1b2c3d",
        filePath: "src/cache/redis.ts",
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders trigger button and opens modal with pre-populated fields and draft notice", () => {
    render(<PromoteToDecisionModal {...mockProps} />);

    const triggerBtn = screen.getByRole("button", {
      name: /promote to decision/i,
    });
    expect(triggerBtn).toBeInTheDocument();

    fireEvent.click(triggerBtn);

    // Assert modal header
    expect(
      screen.getByText(/promote to engineering decision memory/i),
    ).toBeInTheDocument();

    // Assert explicit draft / pending approval notice badge
    const badge = screen.getByText(/Draft — Requires Human Approval/i);
    expect(badge).toBeInTheDocument();
    expect(
      screen.getByText(/never be auto-approved without manual team consensus/i),
    ).toBeInTheDocument();

    // Assert pre-populated title and rationale
    const titleInput = screen.getByLabelText(
      /decision title/i,
    ) as HTMLInputElement;
    expect(titleInput.value).toBe("Architectural Constraint for CACHE_TTL");

    const rationaleInput = screen.getByLabelText(
      /rationale & provenance excerpts/i,
    ) as HTMLTextAreaElement;
    expect(rationaleInput.value).toContain(
      "Cache must use Redis TTL of 60 seconds to avoid stale reads.",
    );
    expect(rationaleInput.value).toContain(
      "[COMMIT] a1b2c3d: Add 60s Redis TTL constraint",
    );

    // Assert provenance tags
    expect(screen.getByText("COMMIT: a1b2c3d")).toBeInTheDocument();
  });

  it("submits the draft decision and displays success confirmation with link to /decisions", async () => {
    (adrSyncApi.promoteClaimToDecision as jest.Mock).mockResolvedValue({
      decisionId: "dec-new-999",
      id: "dec-new-999",
      status: "CANDIDATE",
      title: "Architectural Constraint for CACHE_TTL",
    });

    render(<PromoteToDecisionModal {...mockProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: /promote to decision/i }),
    );

    const submitBtn = screen.getByRole("button", {
      name: /save as draft decision/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(adrSyncApi.promoteClaimToDecision).toHaveBeenCalledWith({
        claimId: "claim-101",
        verificationSessionId: "session-202",
        repositoryId: "repo-303",
        title: "Architectural Constraint for CACHE_TTL",
        rationale: expect.stringContaining("Cache must use Redis TTL"),
        severity: "MEDIUM",
        targetFilePath: "src/cache/redis.ts",
        targetSymbol: "CACHE_TTL",
      });
    });

    // Assert success view
    await waitFor(() => {
      expect(
        screen.getByText(/decision draft created successfully!/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/CANDIDATE/)).toBeInTheDocument();
    });

    const viewLink = screen.getByRole("link", {
      name: /view in decision memory studio/i,
    });
    expect(viewLink).toHaveAttribute("href", "/decisions?id=dec-new-999");
  });

  it("allows overriding title and severity before submitting", async () => {
    (adrSyncApi.promoteClaimToDecision as jest.Mock).mockResolvedValue({
      decisionId: "dec-custom-123",
      id: "dec-custom-123",
      status: "CANDIDATE",
      title: "Custom Cache Expiration Policy",
    });

    render(<PromoteToDecisionModal {...mockProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: /promote to decision/i }),
    );

    const titleInput = screen.getByLabelText(/decision title/i);
    fireEvent.change(titleInput, {
      target: { value: "Custom Cache Expiration Policy" },
    });

    const severitySelect = screen.getByLabelText(/constraint severity/i);
    fireEvent.change(severitySelect, { target: { value: "CRITICAL" } });

    fireEvent.click(
      screen.getByRole("button", { name: /save as draft decision/i }),
    );

    await waitFor(() => {
      expect(adrSyncApi.promoteClaimToDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Custom Cache Expiration Policy",
          severity: "CRITICAL",
        }),
      );
    });
  });
});
