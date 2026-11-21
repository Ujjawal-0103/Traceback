import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import DecisionsPage from "./page";
import { api } from "../../lib/api";

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: jest.fn().mockImplementation((param) => {
      if (param === "repoId") return "repo-1";
      if (param === "id") return "dec-101";
      return null;
    }),
  }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    activeWorkspace: { id: "ws_alpha", name: "Alpha Corp" },
    user: { id: "user_1", name: "Alex" },
  }),
}));

jest.mock("../../lib/api", () => {
  const original = jest.requireActual("../../lib/api");
  return {
    ...original,
    api: {
      ...original.api,
      getRepositories: jest.fn(),
      getDecisions: jest.fn(),
      getDecision: jest.fn(),
      getDecisionAdr: jest.fn(),
      exportDecisionAdr: jest.fn(),
      syncAdrs: jest.fn(),
    },
  };
});

describe("DecisionsPage (Feature 4 Decision Memory & ADR Sync)", () => {
  const mockRepos = [
    {
      id: "repo-1",
      workspaceId: "ws_alpha",
      fullName: "traceback/core-engine",
      defaultBranch: "main",
      isPrivate: false,
      indexedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      counts: { commits: 10, pullRequests: 2, issues: 1, sourceRecords: 13 },
    },
  ];

  const mockDecisions = [
    {
      id: "dec-101",
      workspaceId: "ws_alpha",
      repositoryId: "repo-1",
      title: "Memoize Streaming Rows",
      summary: "Derived from verified claim: Memoize rows above 500",
      decision: "Preserve established architectural constraint: Memoize streaming rows",
      rationale: "Prevents UI thread freezing during streaming updates.",
      targetFilePath: "src/Table.tsx",
      targetSymbol: "memoizedRows",
      status: "ACCEPTED",
      severity: "HIGH",
      supportingEvidence: [
        {
          id: "ev-1",
          sourceType: "COMMIT",
          referenceKey: "7a8b9c",
          title: "feat: memoize rows",
          author: "Alex",
          timestamp: "2026-10-10T10:00:00.000Z",
          url: "https://github.com/org/repo/commit/7a8b9c",
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const mockAdr = {
    decisionId: "dec-101",
    identifier: "ADR-001",
    title: "Memoize Streaming Rows",
    fileName: "ADR-001-memoize-streaming-rows.md",
    filePath: "docs/adr/ADR-001-memoize-streaming-rows.md",
    markdown: "# ADR-001: Memoize Streaming Rows\n\n## Context\nMemoize rows above 500\n",
    status: "ACCEPTED",
    date: new Date().toISOString(),
  };

  const mockSyncResult = {
    totalFilesScanned: 1,
    exportedCount: 1,
    importedCount: 0,
    syncedFiles: ["docs/adr/ADR-001-memoize-streaming-rows.md"],
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (api.getRepositories as jest.Mock).mockResolvedValue(mockRepos);
    (api.getDecisions as jest.Mock).mockResolvedValue(mockDecisions);
    (api.getDecisionAdr as jest.Mock).mockResolvedValue(mockAdr);
    (api.exportDecisionAdr as jest.Mock).mockResolvedValue(mockAdr);
    (api.syncAdrs as jest.Mock).mockResolvedValue(mockSyncResult);
  });

  it("renders decisions and allows opening View ADR modal", async () => {
    render(<DecisionsPage />);

    await waitFor(() => {
      expect(screen.getByText("Memoize Streaming Rows")).toBeInTheDocument();
    });

    const viewAdrBtn = screen.getByRole("button", { name: /view adr/i });
    expect(viewAdrBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(viewAdrBtn);
    });

    expect(api.getDecisionAdr).toHaveBeenCalledWith("repo-1", "dec-101", "ws_alpha");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: /ADR-001: Memoize Streaming Rows/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Copy Markdown/i)).toBeInTheDocument();
      expect(screen.getByText(/Save to docs\/adr\/ADR-001/i)).toBeInTheDocument();
    });
  });

  it("opens ADR Sync modal and triggers bidirectional sync", async () => {
    render(<DecisionsPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sync \/docs\/adr\//i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /sync \/docs\/adr\//i }));

    expect(screen.getByText(/ADR Git-Native Synchronization/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run synchronization/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run synchronization/i }));
    });

    expect(api.syncAdrs).toHaveBeenCalledWith(
      "repo-1",
      expect.objectContaining({ direction: "BIDIRECTIONAL" }),
      "ws_alpha",
    );

    await waitFor(() => {
      expect(screen.getByText(/ADR-001-memoize-streaming-rows.md/)).toBeInTheDocument();
    });
  });
});
