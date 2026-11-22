/**
 * Pure, deterministic layout and presentation engine for Traceback's Provenance Graph.
 * Computes exact pixel coordinates, presentation-layer Evolution classification,
 * high-signal subgraph shaping, and guaranteed-visible Bezier curve paths.
 */

import {
  ProvenanceNodeDto,
  ProvenanceEdgeDto,
  ProvenanceNodeType,
} from "../../lib/provenance-api";

export interface DisplayNode extends ProvenanceNodeDto {
  displayStage: number; // 1, 2, 3, or 4
  displayTypeLabel?: string;
  isEvolutionPromoted?: boolean;
}

export interface NodePosition {
  node: DisplayNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedEdgePath {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  label: string;
  pathD: string;
  midX: number;
  midY: number;
  isSameStage: boolean;
  isDerived?: boolean;
}

export interface GraphLayoutResult {
  nodes: NodePosition[];
  nodeMap: Map<string, NodePosition>;
  edges: ComputedEdgePath[];
  width: number;
  height: number;
  stageNodeCounts: Record<number, number>;
  totalCandidateNodes: number;
  isFiltered: boolean;
}

export interface GraphLayoutOptions {
  filterMode?: "connected" | "all";
  activeFilters?: Record<ProvenanceNodeType, boolean>;
  selectedNodeId?: string | null;
  expandedStages?: Record<number, boolean>;
}

export const LAYOUT_CONSTANTS = {
  NODE_WIDTH: 236,
  NODE_HEIGHT: 108,
  COL_GAP: 320,
  ROW_GAP: 34,
  PADDING_TOP: 64,
  PADDING_X: 36,
};

/**
 * 1. Presentation-Layer Evolution Classification:
 * If nodes has 0 nodes in Stage 4 (REFACTOR / SUPERSEDED_DECISION) while multiple
 * COMMIT nodes touch the same file path(s), promote subsequent commits (after the earliest
 * introducing commit for a file, or commits dated after a governing Decision) into Stage 4
 * strictly for graph layout clarity—preserving the original node ID and metadata intact.
 */
export function classifyEvolutionNodes(
  nodes: ProvenanceNodeDto[],
): DisplayNode[] {
  const hasStage4 = nodes.some(
    (n) =>
      n.stageOrder === 4 ||
      n.type === "REFACTOR" ||
      n.type === "SUPERSEDED_DECISION",
  );

  if (hasStage4) {
    return nodes.map((n) => ({
      ...n,
      displayStage: n.stageOrder,
    }));
  }

  // Group commits by file paths to find evolutionary commits
  const fileFirstCommitMap = new Map<string, { id: string; time: number }>();
  const commits = nodes.filter((n) => n.type === "COMMIT");

  commits.forEach((c) => {
    const time = new Date(c.timestamp).getTime();
    const files = c.filePaths || [];
    files.forEach((f) => {
      const existing = fileFirstCommitMap.get(f);
      if (!existing || time < existing.time) {
        fileFirstCommitMap.set(f, { id: c.id, time });
      }
    });
  });

  return nodes.map((n) => {
    if (n.type !== "COMMIT") {
      return {
        ...n,
        displayStage: n.stageOrder,
      };
    }

    const time = new Date(n.timestamp).getTime();
    const files = n.filePaths || [];

    // If commit is not the earliest commit for ANY of its files, promote to Stage 4 Evolution
    const isSubsequent = files.some((f) => {
      const first = fileFirstCommitMap.get(f);
      return first && first.id !== n.id && time > first.time;
    });

    if (isSubsequent) {
      return {
        ...n,
        displayStage: 4,
        displayTypeLabel: "Evolution / Refactor",
        isEvolutionPromoted: true,
      };
    }

    return {
      ...n,
      displayStage: 2,
    };
  });
}

/**
 * 2. High-Signal Subgraph Shaping:
 * When filterMode === "connected" and total nodes > 20, keeps ALL Issues, ALL Decisions,
 * connected PRs, and the highest-degree introducing & evolution commits.
 */
export function shapeSubgraph(
  classifiedNodes: DisplayNode[],
  rawEdges: ProvenanceEdgeDto[],
  filterMode: "connected" | "all" = "connected",
): { shapedNodes: DisplayNode[]; validEdges: ProvenanceEdgeDto[] } {
  if (filterMode === "all" || classifiedNodes.length <= 20) {
    const validEdges = rawEdges.filter(
      (e) =>
        classifiedNodes.some((n) => n.id === e.source) &&
        classifiedNodes.some((n) => n.id === e.target),
    );
    return { shapedNodes: classifiedNodes, validEdges };
  }

  // Calculate edge degree for each node
  const degreeMap = new Map<string, number>();
  rawEdges.forEach((e) => {
    degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
  });

  const coreNodes: DisplayNode[] = [];
  const introCommits: DisplayNode[] = [];
  const evoCommits: DisplayNode[] = [];

  classifiedNodes.forEach((n) => {
    if (n.displayStage === 1 || n.displayStage === 3 || n.type === "PR") {
      coreNodes.push(n);
    } else if (n.displayStage === 4) {
      evoCommits.push(n);
    } else {
      introCommits.push(n);
    }
  });

  // Sort commits by edge degree descending, then timestamp descending
  const sortByDegreeAndTime = (a: DisplayNode, b: DisplayNode) => {
    const degA = degreeMap.get(a.id) || 0;
    const degB = degreeMap.get(b.id) || 0;
    if (degB !== degA) return degB - degA;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  };

  introCommits.sort(sortByDegreeAndTime);
  evoCommits.sort(sortByDegreeAndTime);

  // Keep top 7 introducing commits and top 7 evolution commits
  const shapedNodes = [
    ...coreNodes,
    ...introCommits.slice(0, 7),
    ...evoCommits.slice(0, 7),
  ];

  const shapedNodeIds = new Set(shapedNodes.map((n) => n.id));
  let validEdges = rawEdges.filter(
    (e) => shapedNodeIds.has(e.source) && shapedNodeIds.has(e.target),
  );

  // Derive file-match links if cross-stage edges are sparse
  if (validEdges.length < 4 && shapedNodes.length >= 2) {
    const derivedEdges = deriveFileMatchEdges(shapedNodes, validEdges);
    validEdges = [...validEdges, ...derivedEdges];
  }

  return { shapedNodes, validEdges };
}

/**
 * Derives strictly grounded cross-stage file links ONLY when two displayed nodes
 * explicitly share an identical non-empty file path in node.filePaths.
 */
export function deriveFileMatchEdges(
  nodes: DisplayNode[],
  existingEdges: ProvenanceEdgeDto[],
): ProvenanceEdgeDto[] {
  const existingKeys = new Set(
    existingEdges.map((e) => `${e.source}->${e.target}`),
  );
  const derived: ProvenanceEdgeDto[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const nA = nodes[i];
    const filesA = new Set(nA.filePaths || []);
    if (filesA.size === 0) continue;

    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const nB = nodes[j];
      const filesB = nB.filePaths || [];
      if (filesB.length === 0) continue;

      const sharesFile = filesB.some((f) => filesA.has(f));
      if (!sharesFile) continue;

      const timeA = new Date(nA.timestamp).getTime();
      const timeB = new Date(nB.timestamp).getTime();

      // Only link in chronological or forward-stage order
      if (nA.displayStage <= nB.displayStage && timeA <= timeB) {
        const key = `${nA.id}->${nB.id}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          const rel =
            nA.displayStage === nB.displayStage
              ? "PRECEDED_BY"
              : nB.displayStage === 4
                ? "REFACTORED"
                : nA.displayStage === 3
                  ? "GOVERNS"
                  : "MOTIVATED";

          derived.push({
            id: `derived-edge-${nA.id}-${nB.id}`,
            source: nA.id,
            target: nB.id,
            relation: rel,
            label: formatEdgeRelationship(rel),
          });
        }
      }
    }
  }

  return derived.slice(0, 12);
}

export function formatEdgeRelationship(rel: string): string {
  switch (rel) {
    case "MOTIVATED":
      return "Motivated";
    case "INCLUDES":
      return "Includes";
    case "INTRODUCED":
      return "Introduced";
    case "EVIDENCES":
      return "Evidences";
    case "GOVERNS":
      return "Governs";
    case "REFACTORED":
      return "Refactored";
    case "PRECEDED_BY":
      return "Preceded By";
    case "SUPERSEDES":
      return "Supersedes";
    case "SHARED_FILE":
      return "Shared File";
    default:
      return rel.replace(/_/g, " ").toLowerCase();
  }
}

/**
 * 3. Deterministic (x, y) DAG Coordinate Layout Engine:
 * Computes exact pixel coordinates across 4 horizontal lanes with barycenter vertical sorting.
 */
export function computeGraphLayout(
  nodes: ProvenanceNodeDto[],
  edges: ProvenanceEdgeDto[],
  options: GraphLayoutOptions = {},
): GraphLayoutResult {
  const { filterMode = "connected", activeFilters } = options;

  // 1. Filter out disabled node types if activeFilters provided
  let filteredNodes = nodes;
  if (activeFilters) {
    filteredNodes = nodes.filter((n) => activeFilters[n.type] !== false);
  }

  // 2. Classify evolution nodes for presentation
  const classifiedNodes = classifyEvolutionNodes(filteredNodes);

  // 3. Shape subgraph (Connected Top vs All)
  const { shapedNodes, validEdges } = shapeSubgraph(
    classifiedNodes,
    edges,
    filterMode,
  );

  // 4. Partition nodes into the 4 stages
  const stageGroups: Record<number, DisplayNode[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
  };

  shapedNodes.forEach((n) => {
    const stage = Math.min(Math.max(n.displayStage || 2, 1), 4);
    stageGroups[stage].push(n);
  });

  // Count distribution
  const stageNodeCounts: Record<number, number> = {
    1: stageGroups[1].length,
    2: stageGroups[2].length,
    3: stageGroups[3].length,
    4: stageGroups[4].length,
  };

  // 5. Barycenter Ordering within stages to minimize edge crossings
  const edgeTargetMap = new Map<string, string[]>();
  const edgeSourceMap = new Map<string, string[]>();
  validEdges.forEach((e) => {
    const targets = edgeTargetMap.get(e.source) || [];
    targets.push(e.target);
    edgeTargetMap.set(e.source, targets);

    const sources = edgeSourceMap.get(e.target) || [];
    sources.push(e.source);
    edgeSourceMap.set(e.target, sources);
  });

  // Sort Stage 1 by timestamp asc
  stageGroups[1].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Sort Stage 2, 3, 4 with barycenter of connected upstream nodes
  [2, 3, 4].forEach((s) => {
    const prevStagePositions = new Map<string, number>();
    for (let prev = 1; prev < s; prev++) {
      stageGroups[prev].forEach((n, idx) => {
        prevStagePositions.set(n.id, idx);
      });
    }

    stageGroups[s].sort((a, b) => {
      const sourcesA = edgeSourceMap.get(a.id) || [];
      const sourcesB = edgeSourceMap.get(b.id) || [];

      const avgA =
        sourcesA.length > 0
          ? sourcesA.reduce(
              (sum, id) => sum + (prevStagePositions.get(id) || 0),
              0,
            ) / sourcesA.length
          : 99;
      const avgB =
        sourcesB.length > 0
          ? sourcesB.reduce(
              (sum, id) => sum + (prevStagePositions.get(id) || 0),
              0,
            ) / sourcesB.length
          : 99;

      if (avgA !== avgB) return avgA - avgB;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
  });

  // 6. Assign exact pixel coordinates
  const nodeMap = new Map<string, NodePosition>();
  const positions: NodePosition[] = [];
  let maxNodesInCol = 0;

  [1, 2, 3, 4].forEach((stageOrder) => {
    const stageNodes = stageGroups[stageOrder];
    const isExpanded = options.expandedStages?.[stageOrder] || false;
    const displayedNodes = isExpanded ? stageNodes : stageNodes.slice(0, 5);

    if (displayedNodes.length > maxNodesInCol) {
      maxNodesInCol = displayedNodes.length;
    }

    const colX =
      LAYOUT_CONSTANTS.PADDING_X + (stageOrder - 1) * LAYOUT_CONSTANTS.COL_GAP;

    displayedNodes.forEach((node, index) => {
      const nodeY =
        LAYOUT_CONSTANTS.PADDING_TOP +
        index * (LAYOUT_CONSTANTS.NODE_HEIGHT + LAYOUT_CONSTANTS.ROW_GAP);

      const pos: NodePosition = {
        node,
        x: colX,
        y: nodeY,
        width: LAYOUT_CONSTANTS.NODE_WIDTH,
        height: LAYOUT_CONSTANTS.NODE_HEIGHT,
      };

      nodeMap.set(node.id, pos);
      positions.push(pos);
    });
  });

  // 7. Compute Bezier curves for all valid edges
  const computedEdges: ComputedEdgePath[] = [];

  validEdges.forEach((e) => {
    const sourcePos = nodeMap.get(e.source);
    const targetPos = nodeMap.get(e.target);
    if (!sourcePos || !targetPos) return;

    const rel = e.relation || (e as any).relationship || "RELATED_TO";
    const label = e.label || formatEdgeRelationship(rel);
    const isSameStage =
      sourcePos.node.displayStage === targetPos.node.displayStage;

    let pathD = "";
    let midX = 0;
    let midY = 0;

    if (!isSameStage) {
      // Cross-stage: right-center of source to left-center of target
      const sx = sourcePos.x + sourcePos.width;
      const sy = sourcePos.y + sourcePos.height / 2;
      const tx = targetPos.x;
      const ty = targetPos.y + targetPos.height / 2;

      const dx = Math.max(50, Math.abs(tx - sx) * 0.45);
      pathD = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
      midX = (sx + tx) / 2;
      midY = (sy + ty) / 2;
    } else {
      // Same-stage: smooth side-arc outside the card right boundary
      const sx = sourcePos.x + sourcePos.width;
      const sy = sourcePos.y + sourcePos.height / 2;
      const tx = targetPos.x + targetPos.width;
      const ty = targetPos.y + targetPos.height / 2;

      const arcOffset = 44;
      pathD = `M ${sx} ${sy} C ${sx + arcOffset} ${sy}, ${tx + arcOffset} ${ty}, ${tx} ${ty}`;
      midX = Math.max(sx, tx) + arcOffset;
      midY = (sy + ty) / 2;
    }

    computedEdges.push({
      id: e.id,
      sourceId: e.source,
      targetId: e.target,
      relationship: rel,
      label,
      pathD,
      midX,
      midY,
      isSameStage,
      isDerived: e.id.startsWith("derived-"),
    });
  });

  const width =
    LAYOUT_CONSTANTS.PADDING_X * 2 +
    3 * LAYOUT_CONSTANTS.COL_GAP +
    LAYOUT_CONSTANTS.NODE_WIDTH +
    60;

  const height = Math.max(
    620,
    LAYOUT_CONSTANTS.PADDING_TOP +
      Math.max(maxNodesInCol, 1) *
        (LAYOUT_CONSTANTS.NODE_HEIGHT + LAYOUT_CONSTANTS.ROW_GAP) +
      80,
  );

  return {
    nodes: positions,
    nodeMap,
    edges: computedEdges,
    width,
    height,
    stageNodeCounts,
    totalCandidateNodes: nodes.length,
    isFiltered: filterMode === "connected" && nodes.length > shapedNodes.length,
  };
}

/**
 * Computes transitive upstream causes and downstream consequences for a selected node.
 */
export function traceTransitiveCausalPath(
  selectedNodeId: string | null,
  edges: ComputedEdgePath[],
): {
  upstreamNodeIds: Set<string>;
  downstreamNodeIds: Set<string>;
  activeEdgeIds: Set<string>;
} {
  const upstreamNodeIds = new Set<string>();
  const downstreamNodeIds = new Set<string>();
  const activeEdgeIds = new Set<string>();

  if (!selectedNodeId) {
    return { upstreamNodeIds, downstreamNodeIds, activeEdgeIds };
  }

  // Reverse adjacency (Upstream)
  const revAdjacency = new Map<
    string,
    Array<{ sourceId: string; edgeId: string }>
  >();
  // Forward adjacency (Downstream)
  const fwdAdjacency = new Map<
    string,
    Array<{ targetId: string; edgeId: string }>
  >();

  edges.forEach((e) => {
    const rev = revAdjacency.get(e.targetId) || [];
    rev.push({ sourceId: e.sourceId, edgeId: e.id });
    revAdjacency.set(e.targetId, rev);

    const fwd = fwdAdjacency.get(e.sourceId) || [];
    fwd.push({ targetId: e.targetId, edgeId: e.id });
    fwdAdjacency.set(e.sourceId, fwd);
  });

  // Traverse upstream
  const upQueue = [selectedNodeId];
  while (upQueue.length > 0) {
    const curr = upQueue.shift()!;
    const preds = revAdjacency.get(curr) || [];
    preds.forEach(({ sourceId, edgeId }) => {
      activeEdgeIds.add(edgeId);
      if (!upstreamNodeIds.has(sourceId) && sourceId !== selectedNodeId) {
        upstreamNodeIds.add(sourceId);
        upQueue.push(sourceId);
      }
    });
  }

  // Traverse downstream
  const downQueue = [selectedNodeId];
  while (downQueue.length > 0) {
    const curr = downQueue.shift()!;
    const succs = fwdAdjacency.get(curr) || [];
    succs.forEach(({ targetId, edgeId }) => {
      activeEdgeIds.add(edgeId);
      if (!downstreamNodeIds.has(targetId) && targetId !== selectedNodeId) {
        downstreamNodeIds.add(targetId);
        downQueue.push(targetId);
      }
    });
  }

  return { upstreamNodeIds, downstreamNodeIds, activeEdgeIds };
}
