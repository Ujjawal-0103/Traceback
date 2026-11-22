import {
  classifyEvolutionNodes,
  shapeSubgraph,
  deriveFileMatchEdges,
  computeGraphLayout,
  traceTransitiveCausalPath,
  LAYOUT_CONSTANTS,
} from "../provenance-graph-layout";
import {
  ProvenanceNodeDto,
  ProvenanceEdgeDto,
} from "../../../lib/provenance-api";

describe("provenance-graph-layout", () => {
  const node1: ProvenanceNodeDto = {
    id: "issue-1",
    type: "ISSUE",
    stageOrder: 1,
    timestamp: "2024-01-01T10:00:00Z",
    title: "Issue 1",
    summary: "Origin",
    filePaths: ["src/auth.ts"],
    immutableProvenance: {
      sourceType: "github_issue",
      referenceId: "1",
    },
  };

  const node2: ProvenanceNodeDto = {
    id: "commit-1",
    type: "COMMIT",
    stageOrder: 2,
    timestamp: "2024-01-02T10:00:00Z",
    title: "Commit 1",
    summary: "Intro",
    filePaths: ["src/auth.ts"],
    immutableProvenance: {
      sourceType: "git_commit",
      referenceId: "c1",
    },
  };

  const node3: ProvenanceNodeDto = {
    id: "commit-2",
    type: "COMMIT",
    stageOrder: 2,
    timestamp: "2024-01-03T10:00:00Z",
    title: "Commit 2",
    summary: "Evolution",
    filePaths: ["src/auth.ts"],
    immutableProvenance: {
      sourceType: "git_commit",
      referenceId: "c2",
    },
  };

  const node4: ProvenanceNodeDto = {
    id: "dec-1",
    type: "DECISION",
    stageOrder: 3,
    timestamp: "2024-01-02T15:00:00Z",
    title: "Decision 1",
    summary: "Standardize auth",
    filePaths: ["src/auth.ts"],
    immutableProvenance: {
      sourceType: "decision_record",
      referenceId: "DEC-1",
    },
  };

  describe("classifyEvolutionNodes", () => {
    it("promotes subsequent commits touching the same file into Stage 4 when Stage 4 is empty", () => {
      const classified = classifyEvolutionNodes([node1, node2, node3, node4]);
      const evoCommit = classified.find((n) => n.id === "commit-2");
      expect(evoCommit).toBeDefined();
      expect(evoCommit?.displayStage).toBe(4);
      expect(evoCommit?.isEvolutionPromoted).toBe(true);
      expect(evoCommit?.displayTypeLabel).toBe("Evolution / Refactor");

      // Early commit remains in Stage 2
      const introCommit = classified.find((n) => n.id === "commit-1");
      expect(introCommit?.displayStage).toBe(2);
    });

    it("does not promote if a node already exists in Stage 4", () => {
      const explicitRefactor: ProvenanceNodeDto = {
        id: "refactor-1",
        type: "REFACTOR",
        stageOrder: 4,
        timestamp: "2024-01-04T10:00:00Z",
        title: "Refactor 1",
        summary: "Refactor",
        filePaths: ["src/auth.ts"],
        immutableProvenance: {
          sourceType: "git_commit",
          referenceId: "r1",
        },
      };
      const classified = classifyEvolutionNodes([
        node1,
        node2,
        node3,
        explicitRefactor,
      ]);
      const commit2 = classified.find((n) => n.id === "commit-2");
      expect(commit2?.displayStage).toBe(2);
    });
  });

  describe("deriveFileMatchEdges", () => {
    it("derives chronological file match links between nodes sharing a file", () => {
      const classified = classifyEvolutionNodes([node1, node2, node3]);
      const derived = deriveFileMatchEdges(classified, []);
      expect(derived.length).toBeGreaterThanOrEqual(1);
      const firstDerived = derived[0];
      expect(firstDerived.id).toContain("derived-edge");
      expect(firstDerived.label).toBeDefined();
    });
  });

  describe("computeGraphLayout", () => {
    it("computes exact numeric coordinates for nodes across horizontal stage lanes", () => {
      const edges: ProvenanceEdgeDto[] = [
        {
          id: "e1",
          source: "issue-1",
          target: "commit-1",
          relation: "MOTIVATED",
          label: "Motivated",
        },
      ];

      const layout = computeGraphLayout([node1, node2, node3, node4], edges);
      expect(layout.nodes.length).toBe(4);
      expect(layout.width).toBeGreaterThan(1000);
      expect(layout.height).toBeGreaterThanOrEqual(620);

      // Verify Stage 1 node X coordinate
      const n1Pos = layout.nodeMap.get("issue-1");
      expect(n1Pos).toBeDefined();
      expect(n1Pos?.x).toBe(LAYOUT_CONSTANTS.PADDING_X);

      // Verify Stage 2 node X coordinate
      const n2Pos = layout.nodeMap.get("commit-1");
      expect(n2Pos).toBeDefined();
      expect(n2Pos?.x).toBe(
        LAYOUT_CONSTANTS.PADDING_X + LAYOUT_CONSTANTS.COL_GAP,
      );

      // Verify edges computed with cubic Bezier paths
      expect(layout.edges.length).toBe(1);
      expect(layout.edges[0].pathD).toContain("M ");
      expect(layout.edges[0].pathD).toContain(" C ");
    });
  });

  describe("traceTransitiveCausalPath", () => {
    it("identifies transitive upstream causes and downstream consequences", () => {
      const computedEdges = [
        {
          id: "e1",
          sourceId: "A",
          targetId: "B",
          relationship: "MOTIVATED",
          label: "Motivated",
          pathD: "M 0 0 C 10 10 20 20 30 30",
          midX: 15,
          midY: 15,
          isSameStage: false,
        },
        {
          id: "e2",
          sourceId: "B",
          targetId: "C",
          relationship: "EVIDENCES",
          label: "Evidences",
          pathD: "M 30 30 C 40 40 50 50 60 60",
          midX: 45,
          midY: 45,
          isSameStage: false,
        },
      ];

      // Select B: A is upstream cause, C is downstream consequence
      const trace = traceTransitiveCausalPath("B", computedEdges);
      expect(trace.upstreamNodeIds.has("A")).toBe(true);
      expect(trace.downstreamNodeIds.has("C")).toBe(true);
      expect(trace.activeEdgeIds.has("e1")).toBe(true);
      expect(trace.activeEdgeIds.has("e2")).toBe(true);
    });
  });
});
