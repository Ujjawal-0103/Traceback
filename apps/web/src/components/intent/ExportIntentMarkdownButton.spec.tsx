import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExportIntentMarkdownButton } from "./ExportIntentMarkdownButton";
import * as exportLib from "../../lib/export-intent-markdown";
import { HistoricalIntentCheckSessionDto } from "@traceback/shared-types";

describe("ExportIntentMarkdownButton", () => {
  const mockSession: HistoricalIntentCheckSessionDto = {
    id: "session-test-01",
    workspaceId: "ws_test",
    repositoryId: "repo_test",
    diff: "diff --git a/test.ts b/test.ts",
    status: "COMPLETED",
    outcome: "DOCUMENTED_CONFLICT",
    summary: "Found conflicting decisions",
    conflicts: [],
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:05:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should render nothing when session is null", () => {
    const { container } = render(<ExportIntentMarkdownButton session={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("should render button when session is provided", () => {
    render(
      <ExportIntentMarkdownButton
        session={mockSession}
        repositoryName="Test Repo"
      />,
    );

    const button = screen.getByRole("button", {
      name: /Export Historical Intent Check Report as Markdown/i,
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Export Markdown");
  });

  it("should call downloadIntentCheckMarkdown and show temporary 'Exported ✓' feedback on click", () => {
    const downloadSpy = jest
      .spyOn(exportLib, "downloadIntentCheckMarkdown")
      .mockImplementation(() => {});

    render(
      <ExportIntentMarkdownButton
        session={mockSession}
        repositoryName="Test Repo"
      />,
    );

    const button = screen.getByRole("button", {
      name: /Export Historical Intent Check Report as Markdown/i,
    });
    fireEvent.click(button);

    expect(downloadSpy).toHaveBeenCalledWith(mockSession, "Test Repo");
    expect(button).toHaveTextContent("Exported ✓");

    // After timer runs, button reverts to "Export Markdown"
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(button).toHaveTextContent("Export Markdown");
    downloadSpy.mockRestore();
  });
});
