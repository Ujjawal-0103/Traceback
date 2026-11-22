import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProvenanceGraphCanvas } from "../ProvenanceGraphCanvas";
import { ProvenanceInspectorDrawer } from "../ProvenanceInspectorDrawer";
import { ProvenanceControls } from "../ProvenanceControls";
import {
  ProvenanceNodeDto,
  ProvenanceEdgeDto,
} from "../../../lib/provenance-api";

describe("Provenance Graph Components", () => {
  const mockNodes: ProvenanceNodeDto[] = [
    {
      id: "node_issue_1",
      type: "ISSUE",
      stageOrder: 1,
      timestamp: "2024-01-01T10:00:00Z",
      title: "Add JWT Auth Strategy",
      summary: "Users need secure token-based authentication.",
      author: "alice",
      status: "CLOSED",
      filePaths: ["src/auth/jwt.strategy.ts"],
      immutableProvenance: {
        sourceType: "github_issue",
        referenceId: "42",
        url: "https://github.com/org/repo/issues/42",
      },
    },
    {
      id: "node_pr_1",
      type: "PR",
      stageOrder: 2,
      timestamp: "2024-01-02T12:00:00Z",
      title: "Implement JWT Guard & Strategy",
      summary: "Introduce passport-jwt integration with 15m expiration.",
      author: "bob",
      status: "MERGED",
      filePaths: ["src/auth/jwt.strategy.ts", "src/auth/jwt.guard.ts"],
      immutableProvenance: {
        sourceType: "github_pr",
        referenceId: "101",
        url: "https://github.com/org/repo/pull/101",
      },
    },
    {
      id: "node_dec_1",
      type: "DECISION",
      stageOrder: 3,
      timestamp: "2024-01-03T14:00:00Z",
      title: "Standardize on Stateless JWT Access Tokens",
      summary:
        "Decided against server-side session cookies for distributed scaling.",
      status: "ACTIVE",
      filePaths: ["src/auth/jwt.strategy.ts"],
      immutableProvenance: {
        sourceType: "decision_record",
        referenceId: "DEC-2024-001",
      },
    },
    {
      id: "node_commit_1",
      type: "COMMIT",
      stageOrder: 4,
      timestamp: "2024-01-04T16:00:00Z",
      title: "refactor(auth): tighten token rotation grace period",
      summary: "Shorten grace window to 30 seconds to prevent replay attacks.",
      author: "bob",
      filePaths: ["src/auth/jwt.strategy.ts"],
      immutableProvenance: {
        sourceType: "git_commit",
        referenceId: "a1b2c3d4e5f67890123456789abcdef012345678",
        shortHash: "a1b2c3d",
        url: "https://github.com/org/repo/commit/a1b2c3d",
      },
    },
  ];

  const mockEdges: ProvenanceEdgeDto[] = [
    {
      id: "edge_1",
      source: "node_issue_1",
      target: "node_pr_1",
      relation: "MOTIVATED",
      label: "Motivated by Issue #42",
    },
    {
      id: "edge_2",
      source: "node_pr_1",
      target: "node_dec_1",
      relation: "EVIDENCES",
      label: "Codified in decision",
    },
    {
      id: "edge_3",
      source: "node_dec_1",
      target: "node_commit_1",
      relation: "GOVERNS",
      label: "Governs refactor commit",
    },
  ];

  const defaultFilters = {
    ISSUE: true,
    PR: true,
    COMMIT: true,
    DECISION: true,
    REFACTOR: true,
    SUPERSEDED_DECISION: true,
  };

  describe("ProvenanceGraphCanvas", () => {
    it("should render all 4 stage columns in causal mode with short IDs", () => {
      render(
        <ProvenanceGraphCanvas
          nodes={mockNodes}
          edges={mockEdges}
          selectedNodeId={null}
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      expect(screen.getByTestId("stage-column-1")).toBeInTheDocument();
      expect(screen.getByTestId("stage-column-2")).toBeInTheDocument();
      expect(screen.getByTestId("stage-column-3")).toBeInTheDocument();
      expect(screen.getByTestId("stage-column-4")).toBeInTheDocument();

      expect(screen.getByText("Add JWT Auth Strategy")).toBeInTheDocument();
      expect(
        screen.getByText("Implement JWT Guard & Strategy"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Standardize on Stateless JWT Access Tokens"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("refactor(auth): tighten token rotation grace period"),
      ).toBeInTheDocument();

      // Check formatted short IDs
      expect(screen.getByText("#42")).toBeInTheDocument();
      expect(screen.getByText("PR #101")).toBeInTheDocument();
      expect(screen.getByText("a1b2c3d")).toBeInTheDocument();
    });

    it("should handle stage capping with +N more and Collapse toggles", () => {
      // Create 7 commit nodes for stage 4 (exceeding DEFAULT_STAGE_CAP of 5)
      const manyNodes: ProvenanceNodeDto[] = Array.from(
        { length: 7 },
        (_, i) => ({
          id: `commit_${i}`,
          type: "COMMIT",
          stageOrder: 4,
          timestamp: `2024-01-0${i + 1}T12:00:00Z`,
          title: `Commit message number ${i + 1}`,
          summary: `Commit summary ${i + 1}`,
          author: "alice",
          filePaths: ["src/index.ts"],
          immutableProvenance: {
            sourceType: "git_commit",
            referenceId: `commit_sha_${i}`,
            shortHash: `sha_${i}`,
          },
        }),
      );

      render(
        <ProvenanceGraphCanvas
          nodes={manyNodes}
          edges={[]}
          selectedNodeId={null}
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      // By default, only 5 cards should be visible, and button "+2 more" displayed
      expect(screen.getByText("+2 more")).toBeInTheDocument();
      expect(screen.getByText("Commit message number 1")).toBeInTheDocument();
      expect(screen.getByText("Commit message number 5")).toBeInTheDocument();
      expect(
        screen.queryByText("Commit message number 6"),
      ).not.toBeInTheDocument();

      // Click expand
      fireEvent.click(screen.getByText("+2 more"));
      expect(screen.getByText("Collapse")).toBeInTheDocument();
      expect(screen.getByText("Commit message number 6")).toBeInTheDocument();
      expect(screen.getByText("Commit message number 7")).toBeInTheDocument();

      // Click collapse
      fireEvent.click(screen.getByText("Collapse"));
      expect(screen.getByText("+2 more")).toBeInTheDocument();
      expect(
        screen.queryByText("Commit message number 6"),
      ).not.toBeInTheDocument();
    });

    it("should render chronological timeline stream in timeline mode", () => {
      render(
        <ProvenanceGraphCanvas
          nodes={mockNodes}
          edges={mockEdges}
          selectedNodeId={null}
          onSelectNode={jest.fn()}
          viewMode="timeline"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      expect(screen.getByText("Add JWT Auth Strategy")).toBeInTheDocument();
      expect(screen.getByText("Stage 1: 1. Origin")).toBeInTheDocument();
    });

    it("should display honest insufficient historical evidence banner when insufficientHistory is true", () => {
      render(
        <ProvenanceGraphCanvas
          nodes={[]}
          edges={[]}
          selectedNodeId={null}
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={true}
          abstentionReason="No historical git commits or PRs link to this target symbol."
        />,
      );

      expect(
        screen.getByTestId("insufficient-history-banner"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Insufficient Historical Evidence"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "No historical git commits or PRs link to this target symbol.",
        ),
      ).toBeInTheDocument();
    });

    it("should trigger onSelectNode callback when a node card is clicked", () => {
      const handleSelectNode = jest.fn();
      render(
        <ProvenanceGraphCanvas
          nodes={mockNodes}
          edges={mockEdges}
          selectedNodeId={null}
          onSelectNode={handleSelectNode}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      const nodeCard = screen.getByText("Add JWT Auth Strategy");
      fireEvent.click(nodeCard);

      expect(handleSelectNode).toHaveBeenCalledWith(mockNodes[0]);
    });

    it("should render SVG directed causal edge paths with arrowheads", () => {
      const { container } = render(
        <ProvenanceGraphCanvas
          nodes={mockNodes}
          edges={mockEdges}
          selectedNodeId={null}
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      // Verify SVG element and rendered edge paths
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();

      const paths = container.querySelectorAll("svg path");
      expect(paths.length).toBeGreaterThanOrEqual(mockEdges.length);

      // Verify floating relation label pills
      expect(screen.getByText("MOTIVATED")).toBeInTheDocument();
      expect(screen.getByText("EVIDENCES")).toBeInTheDocument();
    });

    it("should support interactive viewport zoom, fit view, and reset controls", () => {
      render(
        <ProvenanceGraphCanvas
          nodes={mockNodes}
          edges={mockEdges}
          selectedNodeId="node_pr_1"
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      expect(screen.getByTestId("zoom-level")).toHaveTextContent("100%");

      // Zoom in
      fireEvent.click(screen.getByTestId("zoom-in-btn"));
      expect(screen.getByTestId("zoom-level")).toHaveTextContent("115%");

      // Zoom out
      fireEvent.click(screen.getByTestId("zoom-out-btn"));
      expect(screen.getByTestId("zoom-level")).toHaveTextContent("100%");

      // Fit View
      fireEvent.click(screen.getByTestId("fit-view-btn"));
      expect(screen.getByTestId("zoom-level")).toBeInTheDocument();

      // Reset selection button
      expect(screen.getByTestId("reset-selection-btn")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("reset-selection-btn"));
    });

    it("should classify subsequent commits into Stage 4 Evolution when Stage 4 is empty", () => {
      const commitA: ProvenanceNodeDto = {
        id: "commit_early",
        type: "COMMIT",
        stageOrder: 2,
        timestamp: "2024-01-01T10:00:00Z",
        title: "feat(jwt): initial strategy",
        summary: "initial",
        author: "alice",
        filePaths: ["src/jwt.ts"],
        immutableProvenance: {
          sourceType: "git_commit",
          referenceId: "c_early",
        },
      };
      const commitB: ProvenanceNodeDto = {
        id: "commit_late",
        type: "COMMIT",
        stageOrder: 2,
        timestamp: "2024-02-01T10:00:00Z",
        title: "refactor(jwt): optimize token checks",
        summary: "evolution",
        author: "bob",
        filePaths: ["src/jwt.ts"],
        immutableProvenance: {
          sourceType: "git_commit",
          referenceId: "c_late",
        },
      };

      render(
        <ProvenanceGraphCanvas
          nodes={[commitA, commitB]}
          edges={[]}
          selectedNodeId={null}
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      // commitB should be promoted to Stage 4 Evolution
      expect(screen.getByText("Evolution / Refactor")).toBeInTheDocument();
      const stage4Col = screen.getByTestId("stage-column-4");
      expect(stage4Col).toBeInTheDocument();
      expect(stage4Col).toHaveTextContent("1");
    });

    it("should toggle subgraph filtering between Connected and Show All", () => {
      render(
        <ProvenanceGraphCanvas
          nodes={mockNodes}
          edges={mockEdges}
          selectedNodeId={null}
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      const toggleBtn = screen.getByTestId("toggle-subgraph-btn");
      expect(toggleBtn).toHaveTextContent(/Connected/i);

      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveTextContent(/Show All/i);

      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveTextContent(/Connected/i);
    });

    it("should highlight upstream causes and downstream consequences when a node is selected", () => {
      render(
        <ProvenanceGraphCanvas
          nodes={mockNodes}
          edges={mockEdges}
          selectedNodeId="node_pr_1"
          onSelectNode={jest.fn()}
          viewMode="causal"
          activeFilters={defaultFilters}
          insufficientHistory={false}
        />,
      );

      // node_pr_1 is selected -> node_issue_1 is upstream CAUSE -> node_dec_1 and node_commit_1 are downstream CONSEQUENCE
      expect(screen.getByText("SELECTED")).toBeInTheDocument();
      expect(screen.getByText("CAUSE")).toBeInTheDocument();
      expect(screen.getAllByText("CONSEQUENCE").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  describe("ProvenanceControls", () => {
    it("displays honest Neo4j Live badge when connected", () => {
      render(
        <ProvenanceControls
          repositories={[{ id: "repo_1", name: "r", fullName: "org/repo" }]}
          selectedRepoId="repo_1"
          onSelectRepo={jest.fn()}
          files={[{ path: "src/auth/jwt.ts", eventCount: 2 }]}
          decisions={[]}
          selectedFilePath=""
          onSelectFilePath={jest.fn()}
          selectedDecisionId=""
          onSelectDecisionId={jest.fn()}
          activeFilters={defaultFilters}
          onToggleFilter={jest.fn()}
          viewMode="causal"
          onChangeViewMode={jest.fn()}
          dataSource="neo4j"
          neo4jConnected={true}
          onSync={jest.fn()}
          isSyncing={false}
          syncResult={null}
          onResetQuery={jest.fn()}
        />,
      );

      expect(screen.getByText("Neo4j Live")).toBeInTheDocument();
    });

    it("displays honest PostgreSQL Fallback badge when Neo4j is offline", () => {
      render(
        <ProvenanceControls
          repositories={[{ id: "repo_1", name: "r", fullName: "org/repo" }]}
          selectedRepoId="repo_1"
          onSelectRepo={jest.fn()}
          files={[]}
          decisions={[]}
          selectedFilePath=""
          onSelectFilePath={jest.fn()}
          selectedDecisionId=""
          onSelectDecisionId={jest.fn()}
          activeFilters={defaultFilters}
          onToggleFilter={jest.fn()}
          viewMode="causal"
          onChangeViewMode={jest.fn()}
          dataSource="postgres_fallback"
          neo4jConnected={false}
          onSync={jest.fn()}
          isSyncing={false}
          syncResult={null}
          onResetQuery={jest.fn()}
        />,
      );

      expect(screen.getByText("PostgreSQL Fallback")).toBeInTheDocument();
    });
  });

  describe("ProvenanceInspectorDrawer", () => {
    it("renders unselected empty graph summary when node is null", () => {
      render(
        <ProvenanceInspectorDrawer
          node={null}
          onClose={jest.fn()}
          onSelectTargetFile={jest.fn()}
          allNodes={mockNodes}
          edges={mockEdges}
          onSelectNode={jest.fn()}
          repositoryId="repo_1"
          summary={{
            totalNodes: 4,
            earliestTimestamp: "2024-01-01T10:00:00Z",
            latestTimestamp: "2024-01-04T16:00:00Z",
            countsByType: { ISSUE: 1, PR: 1, DECISION: 1, COMMIT: 1 },
          }}
        />,
      );

      expect(screen.getByText("No Artifact Selected")).toBeInTheDocument();
      expect(screen.getByText("Total Artifacts")).toBeInTheDocument();
      expect(screen.getByText("Causal Edges")).toBeInTheDocument();
      expect(screen.getByText("4 artifacts")).toBeInTheDocument();
    });

    it("renders selected node details and immutable provenance verification", () => {
      const handleClose = jest.fn();
      const handleSelectTargetFile = jest.fn();

      render(
        <ProvenanceInspectorDrawer
          node={mockNodes[3]} // Commit
          onClose={handleClose}
          onSelectTargetFile={handleSelectTargetFile}
          allNodes={mockNodes}
          edges={mockEdges}
          onSelectNode={jest.fn()}
          repositoryId="repo_1"
        />,
      );

      expect(
        screen.getByText("refactor(auth): tighten token rotation grace period"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Shorten grace window to 30 seconds to prevent replay attacks.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("git_commit:")).toBeInTheDocument();
      expect(screen.getAllByText("a1b2c3d").length).toBeGreaterThan(0);
      expect(
        screen.getByRole("link", { name: /View Original Artifact on GitHub/i }),
      ).toHaveAttribute("href", "https://github.com/org/repo/commit/a1b2c3d");

      // Test Trace file button
      const traceBtn = screen.getByRole("button", { name: /Trace →/i });
      fireEvent.click(traceBtn);
      expect(handleSelectTargetFile).toHaveBeenCalledWith(
        "src/auth/jwt.strategy.ts",
      );
    });
  });
});
