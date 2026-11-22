import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  IntentMarkdownExport,
  formatIntentSessionAsMarkdown,
} from "../IntentMarkdownExport";
import { HistoricalIntentCheckSessionDto } from "@traceback/shared-types";

describe("IntentMarkdownExport", () => {
  const mockSession: HistoricalIntentCheckSessionDto = {
    id: "intent-12345678",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    diff: "diff --git a/test.ts b/test.ts",
    filePath: "src/table.ts",
    changeDescription: "Removing render throttle",
    status: "COMPLETED",
    outcome: "DOCUMENTED_CONFLICT",
    summary: "Change alters memoization invariant.",
    conflicts: [
      {
        id: "c-1",
        title: "Table Memoization Invariant",
        severity: "HIGH",
        outcome: "DOCUMENTED_CONFLICT",
        rationale: "Historical tests enforce 500-row memoization.",
        unestablishedContext: "Perf regressions historically observed.",
        recommendedReview: "Retain memoization check.",
        supportingEvidence: [
          {
            id: "ev-1",
            sourceType: "COMMIT",
            referenceKey: "abc1234",
            title: "perf: add row count check",
            author: "Dev",
            timestamp: "2026-01-01T00:00:00.000Z",
            url: "https://github.com/example/repo/commit/abc1234",
          },
        ],
      },
    ],
    humanDisposition: "NEEDS_DISCUSSION",
    dispositionNotes: "Requires review by performance squad.",
    createdAt: "2026-11-22T06:00:00.000Z",
    updatedAt: "2026-11-22T06:05:00.000Z",
  };

  it("should format markdown correctly with advisory notice", () => {
    const md = formatIntentSessionAsMarkdown(mockSession);
    expect(md).toContain("# Traceback Historical Intent Check Audit");
    expect(md).toContain("- **Session ID:** `intent-12345678`");
    expect(md).toContain("- **Advisory Outcome:** **DOCUMENTED_CONFLICT**");
    expect(md).toContain("Table Memoization Invariant");
    expect(md).toContain("perf: add row count check");
    expect(md).toContain("Traceback Advisory Notice");
    expect(md).toContain("Traceback does not alter source code");
  });

  it("should render copy and download buttons", () => {
    render(<IntentMarkdownExport session={mockSession} />);
    expect(
      screen.getByRole("button", { name: /copy intent check audit markdown/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /download intent check audit markdown/i,
      }),
    ).toBeInTheDocument();
  });

  it("should trigger clipboard write on copy button click", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<IntentMarkdownExport session={mockSession} />);
    const copyBtn = screen.getByRole("button", {
      name: /copy intent check audit markdown/i,
    });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/copied to clipboard/i)).toBeInTheDocument();
    });
  });
});
