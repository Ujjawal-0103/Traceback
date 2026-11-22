"use client";

import React, { useMemo, useState, useRef, useCallback } from "react";
import {
  ProvenanceNodeDto,
  ProvenanceEdgeDto,
  ProvenanceNodeType,
} from "../../lib/provenance-api";
import {
  computeGraphLayout,
  traceTransitiveCausalPath,
  LAYOUT_CONSTANTS,
  DisplayNode,
} from "./provenance-graph-layout";
import styles from "./provenance.module.css";

export interface ProvenanceGraphCanvasProps {
  nodes: ProvenanceNodeDto[];
  edges: ProvenanceEdgeDto[];
  selectedNodeId: string | null;
  onSelectNode: (node: ProvenanceNodeDto | null) => void;
  viewMode: "causal" | "timeline";
  activeFilters: Record<ProvenanceNodeType, boolean>;
  insufficientHistory: boolean;
  abstentionReason?: string;
  onClearFilters?: () => void;
  isLoading?: boolean;
}

interface StageDefinition {
  order: number;
  id: string;
  name: string;
  description: string;
  accentColor: string;
}

const STAGES: StageDefinition[] = [
  {
    order: 1,
    id: "origin",
    name: "1. Origin",
    description: "Issues & Problem Motivation",
    accentColor: "#F59E0B", // amber
  },
  {
    order: 2,
    id: "implementation",
    name: "2. Implementation",
    description: "PRs & Code Introductions",
    accentColor: "#8B5CF6", // purple
  },
  {
    order: 3,
    id: "decisions",
    name: "3. Decision Memory",
    description: "Architecture Records & Rationale",
    accentColor: "#10B981", // emerald
  },
  {
    order: 4,
    id: "evolution",
    name: "4. Evolution",
    description: "Commits, Refactors & Updates",
    accentColor: "#3B82F6", // blue
  },
];

const NODE_THEME: Record<
  ProvenanceNodeType,
  { label: string; badgeBg: string; badgeText: string; borderAccent: string }
> = {
  ISSUE: {
    label: "Issue",
    badgeBg: "rgba(245, 158, 11, 0.12)",
    badgeText: "#D97706",
    borderAccent: "#F59E0B",
  },
  PR: {
    label: "PR",
    badgeBg: "rgba(139, 92, 246, 0.12)",
    badgeText: "#7C3AED",
    borderAccent: "#8B5CF6",
  },
  COMMIT: {
    label: "Commit",
    badgeBg: "rgba(59, 130, 246, 0.12)",
    badgeText: "#2563EB",
    borderAccent: "#3B82F6",
  },
  DECISION: {
    label: "Decision",
    badgeBg: "rgba(16, 185, 129, 0.12)",
    badgeText: "#059669",
    borderAccent: "#10B981",
  },
  REFACTOR: {
    label: "Refactor",
    badgeBg: "rgba(20, 184, 166, 0.12)",
    badgeText: "#0D9488",
    borderAccent: "#14B8A6",
  },
  SUPERSEDED_DECISION: {
    label: "Superseded",
    badgeBg: "rgba(244, 63, 94, 0.12)",
    badgeText: "#E11D48",
    borderAccent: "#F43F5E",
  },
};

function formatShortId(node: DisplayNode): string {
  if (node.type === "ISSUE") {
    const ref = node.immutableProvenance?.referenceId;
    return ref ? `#${ref}` : `#${node.id.replace("issue-", "")}`;
  }
  if (node.type === "PR") {
    const ref = node.immutableProvenance?.referenceId;
    return ref ? `PR #${ref}` : `PR #${node.id.replace("pr-", "").slice(0, 6)}`;
  }
  if (node.type === "DECISION" || node.type === "SUPERSEDED_DECISION") {
    return node.immutableProvenance?.referenceId || "ADR";
  }
  if (node.immutableProvenance?.shortHash) {
    return node.immutableProvenance.shortHash;
  }
  const rawSha = node.id.replace("commit-", "");
  return rawSha.slice(0, 7);
}

function formatShortDate(timestamp: string): string {
  if (!timestamp) return "";
  try {
    const d = new Date(timestamp);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function ProvenanceGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  viewMode,
  activeFilters,
  insufficientHistory,
  abstentionReason,
  onClearFilters,
  isLoading,
}: ProvenanceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"connected" | "all">(
    "connected",
  );
  const [expandedStages, setExpandedStages] = useState<Record<number, boolean>>(
    {},
  );

  // Viewport Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isPanning, setIsPanning] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 1. Layout computation using pure helper
  const layout = useMemo(() => {
    return computeGraphLayout(nodes, edges, {
      filterMode,
      activeFilters,
      selectedNodeId,
      expandedStages,
    });
  }, [nodes, edges, filterMode, activeFilters, selectedNodeId, expandedStages]);

  const handleCardSelect = useCallback(
    (node: DisplayNode) => {
      const {
        displayStage,
        displayTypeLabel,
        isEvolutionPromoted,
        ...originalNode
      } = node;
      onSelectNode(originalNode as ProvenanceNodeDto);
    },
    [onSelectNode],
  );

  // 2. Transitive Upstream / Downstream reachability computation
  const activeFocusId = selectedNodeId || hoveredNodeId;

  const { upstreamNodeIds, downstreamNodeIds, activeEdgeIds } = useMemo(() => {
    return traceTransitiveCausalPath(activeFocusId, layout.edges);
  }, [activeFocusId, layout.edges]);

  // Loading State
  if (isLoading) {
    return (
      <div className={styles.canvasCard}>
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>
            Traversing historical provenance graph...
          </span>
        </div>
      </div>
    );
  }

  // Abstention / Insufficient History Banner
  if (insufficientHistory || nodes.length === 0) {
    return (
      <div
        data-testid="insufficient-history-banner"
        className={styles.abstentionCard}
      >
        <div className={styles.abstentionIcon}>!</div>
        <h3 className={styles.abstentionTitle}>
          Insufficient Historical Evidence
        </h3>
        <p className={styles.abstentionReason}>
          {abstentionReason ||
            "Traceback explicitly abstains from fabricating causal links when repository commits, issues, pull requests, or decisions do not contain documented provenance for this target."}
        </p>
        {onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className={styles.smallButton}
          >
            Clear Filter
          </button>
        )}
      </div>
    );
  }

  // Viewport Control Handlers
  const handleZoomIn = () =>
    setZoom((z) => Math.min(1.8, +(z + 0.15).toFixed(2)));
  const handleZoomOut = () =>
    setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)));
  const handleFitView = () => {
    if (containerRef.current) {
      const containerW = containerRef.current.clientWidth - 40;
      const fitScale = Math.min(1.0, Math.max(0.55, containerW / layout.width));
      setZoom(+fitScale.toFixed(2));
      setPanOffset({ x: 0, y: 0 });
    } else {
      setZoom(1.0);
      setPanOffset({ x: 0, y: 0 });
    }
  };
  const handleResetSelection = () => {
    onSelectNode(null);
    setHoveredNodeId(null);
  };

  // Canvas Mouse Pan Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only pan on left click on the empty canvas/viewport background
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(`.${styles.artifactCard}`) ||
      target.closest(`.${styles.viewportControls}`) ||
      target.closest("button")
    ) {
      return;
    }
    setIsPanning(true);
    dragStartRef.current = {
      x: e.clientX - panOffset.x,
      y: e.clientY - panOffset.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    setPanOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Timeline mode nodes
  const timelineNodes = [...layout.nodes]
    .map((p) => p.node)
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

  return (
    <div
      ref={containerRef}
      className={styles.graphViewportContainer}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isPanning ? "grabbing" : "default" }}
    >
      {/* Floating Legend Strip */}
      {viewMode === "causal" && (
        <div className={styles.legendBar} aria-label="Graph Legend">
          <div className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: "#F59E0B" }}
            />
            <span>1. Origin</span>
          </div>
          <div className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: "#8B5CF6" }}
            />
            <span>2. Implementation</span>
          </div>
          <div className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: "#10B981" }}
            />
            <span>3. Decisions</span>
          </div>
          <div className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: "#3B82F6" }}
            />
            <span>4. Evolution</span>
          </div>
          <span style={{ opacity: 0.3 }}>|</span>
          <div className={styles.legendItem}>
            <span style={{ color: "#2563eb", fontWeight: 700 }}>&rarr;</span>
            <span>Cause</span>
          </div>
          <div className={styles.legendItem}>
            <span style={{ color: "#059669", fontWeight: 700 }}>&rarr;</span>
            <span>Consequence</span>
          </div>
        </div>
      )}

      {viewMode === "causal" ? (
        /* ================= DETERMINISTIC DIRECTED CAUSAL GRAPH ================= */
        <div
          className={styles.graphCanvasSurface}
          style={{
            width: `${layout.width}px`,
            height: `${layout.height}px`,
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          {/* Subtle Lane Divider Lines */}
          {STAGES.slice(0, 3).map((stage) => {
            const divX =
              LAYOUT_CONSTANTS.PADDING_X +
              stage.order * LAYOUT_CONSTANTS.COL_GAP -
              42;
            return (
              <div
                key={`divider-${stage.id}`}
                className={styles.laneDividerLine}
                style={{ left: `${divX}px`, height: `${layout.height - 90}px` }}
              />
            );
          })}

          {/* Translucent Lane Header Banners */}
          {STAGES.map((stage) => {
            const colX =
              LAYOUT_CONSTANTS.PADDING_X +
              (stage.order - 1) * LAYOUT_CONSTANTS.COL_GAP;
            const count = layout.stageNodeCounts[stage.order] || 0;
            const isExpanded = expandedStages[stage.order] || false;
            const hasMore = count > 5;

            return (
              <React.Fragment key={stage.id}>
                <div
                  data-testid={`stage-column-${stage.order}`}
                  className={styles.laneHeaderBar}
                  style={{
                    left: `${colX}px`,
                    width: `${LAYOUT_CONSTANTS.NODE_WIDTH}px`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: stage.accentColor,
                        display: "inline-block",
                      }}
                    />
                    <span style={{ fontSize: "12px", fontWeight: 700 }}>
                      {stage.name}
                    </span>
                  </div>
                  <span className={styles.stageBadge}>{count}</span>
                </div>

                {hasMore && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedStages((prev) => ({
                        ...prev,
                        [stage.order]: !isExpanded,
                      }))
                    }
                    className={styles.cappingButton}
                    style={{
                      position: "absolute",
                      left: `${colX + 10}px`,
                      top: `${
                        LAYOUT_CONSTANTS.PADDING_TOP +
                        (isExpanded ? count : 5) *
                          (LAYOUT_CONSTANTS.NODE_HEIGHT +
                            LAYOUT_CONSTANTS.ROW_GAP) +
                        6
                      }px`,
                      width: `${LAYOUT_CONSTANTS.NODE_WIDTH - 20}px`,
                      zIndex: 25,
                    }}
                  >
                    {isExpanded ? "Collapse" : `+${count - 5} more`}
                  </button>
                )}
              </React.Fragment>
            );
          })}

          {/* Guaranteed-Visible SVG Directed Edge Layer */}
          <svg
            className={styles.svgOverlay}
            width={layout.width}
            height={layout.height}
            style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="arrow-default"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 1.5 L 8 5 L 0 8.5 z"
                  fill="#94a3b8"
                  opacity="0.85"
                />
              </marker>
              <marker
                id="arrow-upstream"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#2563eb" />
              </marker>
              <marker
                id="arrow-downstream"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#059669" />
              </marker>
            </defs>

            {layout.edges.map((ep) => {
              const isUpstream =
                upstreamNodeIds.has(ep.sourceId) ||
                (selectedNodeId === ep.targetId &&
                  upstreamNodeIds.has(ep.sourceId));
              const isDownstream =
                downstreamNodeIds.has(ep.targetId) ||
                (selectedNodeId === ep.sourceId &&
                  downstreamNodeIds.has(ep.targetId));
              const isActive = activeEdgeIds.has(ep.id);
              const isDimmed = activeFocusId !== null && !isActive;

              let strokeColor = "#94a3b8";
              let markerEnd = "url(#arrow-default)";
              let strokeWidth = 1.75;

              if (isActive) {
                if (isDownstream || ep.sourceId === activeFocusId) {
                  strokeColor = "#059669";
                  markerEnd = "url(#arrow-downstream)";
                  strokeWidth = 2.75;
                } else {
                  strokeColor = "#2563eb";
                  markerEnd = "url(#arrow-upstream)";
                  strokeWidth = 2.75;
                }
              }

              return (
                <g key={ep.id}>
                  {/* Bezier Path */}
                  <path
                    d={ep.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={
                      isActive
                        ? "5 3"
                        : ep.relationship === "PRECEDED_BY" || ep.isDerived
                          ? "4 3"
                          : "none"
                    }
                    markerEnd={markerEnd}
                    opacity={isDimmed ? 0.2 : isActive ? 1.0 : 0.8}
                  />

                  {/* Floating relation pill on active/highlighted edges */}
                  {(isActive ||
                    ep.relationship === "MOTIVATED" ||
                    ep.relationship === "EVIDENCES" ||
                    ep.relationship === "GOVERNS") && (
                    <foreignObject
                      x={ep.midX - 44}
                      y={ep.midY - 11}
                      width={88}
                      height={22}
                      style={{ overflow: "visible", pointerEvents: "none" }}
                    >
                      <div style={{ width: "100%", textAlign: "center" }}>
                        <span
                          className={styles.floatingRelationPill}
                          style={{
                            borderColor: isActive ? strokeColor : undefined,
                            color: isActive ? strokeColor : undefined,
                          }}
                        >
                          {ep.relationship}
                        </span>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Elevated Interactive Graph Node Cards */}
          {layout.nodes.map(({ node, x, y, width, height }) => {
            const isSelected = selectedNodeId === node.id;
            const isUpstream = upstreamNodeIds.has(node.id);
            const isDownstream = downstreamNodeIds.has(node.id);
            const isDimmed =
              activeFocusId !== null &&
              !isSelected &&
              !isUpstream &&
              !isDownstream;
            const theme = NODE_THEME[node.type] || NODE_THEME.COMMIT;

            return (
              <div
                key={node.id}
                data-node-id={node.id}
                tabIndex={0}
                role="button"
                aria-pressed={isSelected}
                onClick={() => handleCardSelect(node)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleCardSelect(node);
                  }
                }}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                className={`${styles.artifactCard} ${
                  isSelected ? styles.artifactCardSelected : ""
                } ${isDimmed ? styles.artifactCardDimmed : ""}`}
                style={{
                  position: "absolute",
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  borderLeftColor: node.isEvolutionPromoted
                    ? "#14B8A6"
                    : theme.borderAccent,
                  boxSizing: "border-box",
                  zIndex: isSelected ? 30 : 20,
                  opacity: isDimmed ? 0.25 : 1,
                }}
              >
                {/* Port anchor visual hints */}
                <span
                  style={{
                    position: "absolute",
                    left: "-4px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: "var(--color-surface, #ffffff)",
                    border: `1.5px solid ${theme.borderAccent}`,
                    pointerEvents: "none",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    right: "-4px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: "var(--color-surface, #ffffff)",
                    border: `1.5px solid ${theme.borderAccent}`,
                    pointerEvents: "none",
                  }}
                />

                {/* Highlighting badge */}
                {isSelected && (
                  <span
                    className={styles.directionBadge}
                    style={{ backgroundColor: "#4f46e5" }}
                  >
                    SELECTED
                  </span>
                )}
                {isUpstream && (
                  <span
                    className={`${styles.directionBadge} ${styles.badgeCause}`}
                  >
                    CAUSE
                  </span>
                )}
                {isDownstream && (
                  <span
                    className={`${styles.directionBadge} ${styles.badgeConsequence}`}
                  >
                    CONSEQUENCE
                  </span>
                )}

                {/* Card Top: Type Badge + Monospace Short ID + Date */}
                <div className={styles.cardTopRow}>
                  <span
                    className={styles.typeBadge}
                    style={{
                      backgroundColor: node.isEvolutionPromoted
                        ? "rgba(20, 184, 166, 0.12)"
                        : theme.badgeBg,
                      color: node.isEvolutionPromoted
                        ? "#0D9488"
                        : theme.badgeText,
                    }}
                  >
                    {node.displayTypeLabel || theme.label}
                  </span>
                  <div className={styles.cardMetaId}>
                    <span>{formatShortId(node)}</span>
                    <span style={{ opacity: 0.4 }}>&bull;</span>
                    <span style={{ fontSize: "9px" }}>
                      {formatShortDate(node.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Card Title (2-line bold clamp) */}
                <div className={styles.cardTitle}>{node.title}</div>

                {/* Card Footer: Author + File Count */}
                <div className={styles.cardFooter}>
                  <span className={styles.cardAuthor}>
                    {node.author || "system"}
                  </span>
                  {node.filePaths && node.filePaths.length > 0 && (
                    <span className={styles.cardFileBadge}>
                      {node.filePaths.length} file
                      {node.filePaths.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ================= CHRONOLOGICAL TIMELINE MODE ================= */
        <div className={styles.timelineContainer}>
          <div className={styles.timelineSpine} />
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {timelineNodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isUpstream = upstreamNodeIds.has(node.id);
              const isDownstream = downstreamNodeIds.has(node.id);
              const isDimmed =
                activeFocusId !== null &&
                !isSelected &&
                !isUpstream &&
                !isDownstream;
              const theme = NODE_THEME[node.type] || NODE_THEME.COMMIT;
              const stage =
                STAGES.find((s) => s.order === node.displayStage) || STAGES[1];

              return (
                <div key={node.id} className={styles.timelineRow}>
                  <div
                    className={styles.timelineDot}
                    style={{ backgroundColor: stage.accentColor }}
                  />
                  <div
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSelected}
                    onClick={() => handleCardSelect(node)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleCardSelect(node);
                      }
                    }}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    className={`${styles.artifactCard} ${
                      isSelected ? styles.artifactCardSelected : ""
                    } ${isDimmed ? styles.artifactCardDimmed : ""}`}
                    style={{ borderLeftColor: theme.borderAccent }}
                  >
                    <div className={styles.cardTopRow}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          className={styles.typeBadge}
                          style={{
                            backgroundColor: theme.badgeBg,
                            color: theme.badgeText,
                          }}
                        >
                          {node.displayTypeLabel || theme.label}
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 600,
                            color: "var(--color-text-secondary, #64748B)",
                          }}
                        >
                          Stage {node.displayStage}: {stage.name}
                        </span>
                      </div>
                      <div className={styles.cardMetaId}>
                        <span>{formatShortId(node)}</span>
                        <span style={{ opacity: 0.4 }}>&bull;</span>
                        <span>{formatShortDate(node.timestamp)}</span>
                      </div>
                    </div>

                    <div className={styles.cardTitle}>{node.title}</div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: "var(--color-text-secondary, #64748B)",
                        margin: "0 0 6px 0",
                        lineHeight: 1.4,
                      }}
                    >
                      {node.summary}
                    </p>

                    <div className={styles.cardFooter}>
                      <span className={styles.cardAuthor}>
                        {node.author || "system"}
                      </span>
                      {node.filePaths && node.filePaths.length > 0 && (
                        <span className={styles.cardFileBadge}>
                          {node.filePaths.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating Interactive Viewport Controls (Bottom-Left) */}
      {viewMode === "causal" && (
        <div className={styles.viewportControls}>
          <button
            type="button"
            data-testid="zoom-out-btn"
            onClick={handleZoomOut}
            className={styles.viewportButton}
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            &minus;
          </button>
          <span data-testid="zoom-level" className={styles.zoomReadout}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            data-testid="zoom-in-btn"
            onClick={handleZoomIn}
            className={styles.viewportButton}
            title="Zoom In"
            aria-label="Zoom In"
          >
            &#43;
          </button>
          <button
            type="button"
            data-testid="fit-view-btn"
            onClick={handleFitView}
            className={styles.viewportButton}
            title="Fit to View"
          >
            Fit View
          </button>
          <button
            type="button"
            data-testid="toggle-subgraph-btn"
            onClick={() =>
              setFilterMode((m) => (m === "connected" ? "all" : "connected"))
            }
            className={styles.viewportButton}
            title="Toggle Subgraph Filtering"
          >
            {filterMode === "connected"
              ? `Connected (${layout.nodes.length})`
              : `Show All (${layout.totalCandidateNodes})`}
          </button>
          {selectedNodeId && (
            <button
              type="button"
              data-testid="reset-selection-btn"
              onClick={handleResetSelection}
              className={styles.viewportButton}
              style={{ color: "#ef4444" }}
              title="Reset Selection"
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
