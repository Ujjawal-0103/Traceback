import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdrSyncPanel } from "./AdrSyncPanel";
import { adrSyncApi } from "../../lib/adr-sync-api";

jest.mock("../../lib/adr-sync-api", () => ({
  adrSyncApi: {
    getAdrFiles: jest.fn(),
    importAdrs: jest.fn(),
    exportDecisionToAdr: jest.fn(),
  },
}));

describe("AdrSyncPanel Component", () => {
  const mockDecisions = [
    {
      id: "dec-1",
      workspaceId: "ws_alpha",
      repositoryId: "repo-1",
      title: "Adoption of Turborepo Monorepo Structure",
      summary: "Summary text",
      decision: "Decision text",
      rationale: "Rationale text",
      status: "ACCEPTED" as const,
      severity: "HIGH" as const,
      supportingEvidence: [],
      createdAt: "2026-10-09T08:00:00Z",
      updatedAt: "2026-10-10T12:00:00Z",
    },
  ];

  const mockFiles = [
    {
      fileName: "ADR-001-repository-structure.md",
      filePath: "docs/architecture/ADRs/ADR-001-repository-structure.md",
      title: "Adoption of Turborepo Monorepo Structure",
      identifier: "ADR-001",
      status: "ACCEPTED",
      date: "2026-10-09",
      existsInDatabase: true,
      matchedDecisionId: "dec-1",
      matchedDecisionStatus: "ACCEPTED" as const,
    },
    {
      fileName: "ADR-007-github-access.md",
      filePath: "docs/architecture/ADRs/ADR-007-github-access.md",
      title: "GitHub App Read-Only Access",
      identifier: "ADR-007",
      status: "ACCEPTED",
      date: "2026-10-09",
      existsInDatabase: false,
      matchedDecisionId: null,
      matchedDecisionStatus: null,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (adrSyncApi.getAdrFiles as jest.Mock).mockResolvedValue(mockFiles);
  });

  it("renders collapsed panel initially and expands on click", async () => {
    render(<AdrSyncPanel repositoryId="repo-1" decisions={mockDecisions} />);

    expect(screen.getByText("ADR Bidirectional Sync")).toBeInTheDocument();
    expect(screen.getByText("/docs/adr/*.md")).toBeInTheDocument();

    // Not yet expanded
    expect(
      screen.queryByText(/import from \/docs\/adr\/\*\.md/i),
    ).not.toBeInTheDocument();

    // Click toggle button
    const toggleBtn = screen.getByRole("button", { name: /expand panel/i });
    fireEvent.click(toggleBtn);

    // Assert files are loaded and rendered
    await waitFor(() => {
      expect(adrSyncApi.getAdrFiles).toHaveBeenCalledWith({
        repositoryId: "repo-1",
      });
      expect(
        screen.getByText("ADR-001-repository-structure.md"),
      ).toBeInTheDocument();
      expect(screen.getByText("ADR-007-github-access.md")).toBeInTheDocument();
      expect(screen.getByText("✓ Synced to DB")).toBeInTheDocument();
      expect(screen.getByText("Filesystem Only")).toBeInTheDocument();
    });
  });

  it("triggers import when 'Import from /docs/adr/*.md' is clicked", async () => {
    const onSyncSuccess = jest.fn();
    (adrSyncApi.importAdrs as jest.Mock).mockResolvedValue({
      workspaceId: "ws_alpha",
      repositoryId: "repo-1",
      totalFilesScanned: 2,
      importedCount: 1,
      updatedCount: 0,
      skippedCount: 1,
      decisions: [],
      files: [],
    });

    render(
      <AdrSyncPanel
        repositoryId="repo-1"
        decisions={mockDecisions}
        onSyncSuccess={onSyncSuccess}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /expand panel/i }));

    await waitFor(() => {
      expect(
        screen.getByText("ADR-001-repository-structure.md"),
      ).toBeInTheDocument();
    });

    const importBtn = screen.getByRole("button", {
      name: /import from \/docs\/adr\/\*\.md/i,
    });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(adrSyncApi.importAdrs).toHaveBeenCalledWith({
        repositoryId: "repo-1",
        overwriteExisting: false,
      });
      expect(onSyncSuccess).toHaveBeenCalled();
      expect(
        screen.getByText(/import complete: 1 new decisions added/i),
      ).toBeInTheDocument();
    });
  });

  it("triggers export when 'Export to /docs/adr/*.md' is clicked", async () => {
    (adrSyncApi.exportDecisionToAdr as jest.Mock).mockResolvedValue({
      decisionId: "dec-1",
      fileName: "ADR-001-adoption-of-turborepo.md",
      filePath: "docs/adr/ADR-001-adoption-of-turborepo.md",
      status: "ACCEPTED",
      title: "Adoption of Turborepo Monorepo Structure",
      writtenBytes: 840,
      content: "# ADR-001",
    });

    render(<AdrSyncPanel repositoryId="repo-1" decisions={mockDecisions} />);

    fireEvent.click(screen.getByRole("button", { name: /expand panel/i }));

    await waitFor(() => {
      expect(
        screen.getByText("ADR-001-repository-structure.md"),
      ).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole("button", {
      name: /export to \/docs\/adr\/\*\.md/i,
    });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(adrSyncApi.exportDecisionToAdr).toHaveBeenCalledWith("dec-1", {
        repositoryId: "repo-1",
      });
      expect(
        screen.getByText(
          /exported successfully to "docs\/adr\/ADR-001-adoption-of-turborepo\.md"/i,
        ),
      ).toBeInTheDocument();
    });
  });
});
