"use client";

import React, { useState } from "react";
import {
  ProvenanceNodeDto,
  ProvenanceEdgeDto,
  ProvenanceNodeType,
  ProvenanceSummaryDto,
} from "../../lib/provenance-api";
import styles from "./provenance.module.css";

export interface ProvenanceInspectorDrawerProps {
  node: ProvenanceNodeDto | null;
  onClose: () => void;
  onSelectTargetFile: (filePath: string) => void;
  allNodes: ProvenanceNodeDto[];
  edges: ProvenanceEdgeDto[];
  onSelectNode: (node: ProvenanceNodeDto) => void;
  repositoryId: string;
  summary?: ProvenanceSummaryDto;
}

const STAGE_NAMES: Record<number, string> = {
  1: "Stage 1: Origin",
  2: "Stage 2: Implementation",
  3: "Stage 3: Decision Memory",
  4: "Stage 4: Evolution",
};

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

function formatShortId(node: ProvenanceNodeDto): string {
  if (node.type === "ISSUE") {
    return node.immutableProvenance.referenceId.startsWith("#")
      ? node.immutableProvenance.referenceId
      : `#${node.immutableProvenance.referenceId}`;
  }
  if (node.type === "PR") {
    return node.immutableProvenance.referenceId.startsWith("#")
      ? `PR ${node.immutableProvenance.referenceId}`
      : `PR #${node.immutableProvenance.referenceId}`;
  }
  if (node.type === "COMMIT") {
    return (
      node.immutableProvenance.shortHash ||
      node.immutableProvenance.referenceId.slice(0, 7)
    );
  }
  if (node.type === "DECISION" || node.type === "SUPERSEDED_DECISION") {
    const raw = node.immutableProvenance.referenceId;
    return raw.length > 8 ? `DEC-${raw.slice(0, 6)}` : raw;
  }
  return (
    node.immutableProvenance.shortHash ||
    node.immutableProvenance.referenceId.slice(0, 7)
  );
}

function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function ProvenanceInspectorDrawer({
  node,
  onClose,
  onSelectTargetFile,
  allNodes,
  edges,
  onSelectNode,
  repositoryId: _repositoryId,
  summary,
}: ProvenanceInspectorDrawerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!node) return;
    const ref =
      node.immutableProvenance.shortHash ||
      node.immutableProvenance.referenceId;
    navigator.clipboard.writeText(ref);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If NO node is selected: Render docked Graph Overview summary
  if (!node) {
    return (
      <aside className={styles.inspectorCard} aria-label="Graph Inspector">
        <div className={styles.inspectorHeader}>
          <div className={styles.inspectorHeaderTitle}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "var(--color-primary, #2563EB)",
                display: "inline-block",
              }}
            />
            <span>Graph Inspector</span>
          </div>
          <span
            style={{
              fontSize: "11px",
              fontFamily: "monospace",
              color: "var(--color-text-muted, #94A3B8)",
            }}
          >
            {allNodes.length} artifacts
          </span>
        </div>

        {/* Empty state prompt */}
        <div className={styles.inspectorEmptyBox}>
          <div className={styles.inspectorEmptyIcon}>🔍</div>
          <div className={styles.inspectorEmptyTitle}>No Artifact Selected</div>
          <p className={styles.inspectorEmptyDesc}>
            Click any card in the causal graph to inspect its immutable commit
            SHA, original PR/issue rationale, and bidirectional causal links.
          </p>
        </div>

        {/* Active Graph Metrics */}
        {summary && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className={styles.sectionTitle}>Active Graph Metrics</div>
            <div className={styles.metricsGrid}>
              <div className={styles.metricTile}>
                <div className={styles.metricTileLabel}>Total Artifacts</div>
                <div className={styles.metricTileValue}>
                  {summary.totalNodes}
                </div>
              </div>
              <div className={styles.metricTile}>
                <div className={styles.metricTileLabel}>Causal Edges</div>
                <div className={styles.metricTileValue}>{edges.length}</div>
              </div>
            </div>

            {/* Artifact Breakdown */}
            {summary.countsByType && (
              <div className={styles.breakdownRow}>
                {Object.entries(summary.countsByType).map(([type, count]) => (
                  <span key={type} className={styles.breakdownChip}>
                    {type}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    );
  }

  // Active Selected Node View
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const upstreamEdges = edges.filter((e) => e.target === node.id);
  const downstreamEdges = edges.filter((e) => e.source === node.id);
  const theme = NODE_THEME[node.type] || NODE_THEME.COMMIT;

  return (
    <aside className={styles.inspectorCard} aria-label="Graph Inspector">
      {/* HEADER: Stage Pill & Close */}
      <div className={styles.inspectorHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            className={styles.typeBadge}
            style={{
              backgroundColor: theme.badgeBg,
              color: theme.badgeText,
            }}
          >
            {theme.label}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text-secondary, #64748B)",
            }}
          >
            {STAGE_NAMES[node.stageOrder] || `Stage ${node.stageOrder}`}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close Inspector Drawer"
          className={styles.inspectorCloseBtn}
        >
          &times;
        </button>
      </div>

      {/* TITLE & META */}
      <div>
        <h3 className={styles.selectedTitle}>{node.title}</h3>
        <div className={styles.selectedMeta}>
          <span>
            {new Date(node.timestamp).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          {node.author && (
            <>
              <span style={{ opacity: 0.4 }}>&bull;</span>
              <span>{node.author}</span>
            </>
          )}
          {node.status && (
            <span
              style={{
                fontSize: "9px",
                textTransform: "uppercase",
                fontWeight: 700,
                padding: "2px 5px",
                borderRadius: "4px",
                backgroundColor: "var(--color-card-muted, #F1F5F9)",
                border: "1px solid var(--color-border, #E2E8F0)",
              }}
            >
              {node.status}
            </span>
          )}
        </div>
      </div>

      {/* IMMUTABLE PROVENANCE VERIFICATION BOX */}
      <div className={styles.immutableBox}>
        <div className={styles.immutableBoxTitle}>Immutable Provenance</div>

        <div className={styles.immutableRow}>
          <span style={{ color: "var(--color-text-secondary, #64748B)" }}>
            {node.immutableProvenance.sourceType}:
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontWeight: 700,
                maxWidth: "140px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={node.immutableProvenance.referenceId}
            >
              {node.immutableProvenance.shortHash ||
                node.immutableProvenance.referenceId}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className={styles.copyBtn}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {isSafeUrl(node.immutableProvenance.url) && (
          <a
            href={node.immutableProvenance.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.externalLink}
          >
            <span>View Original Artifact on GitHub</span>
            <span>&rarr;</span>
          </a>
        )}
      </div>

      {/* PLAIN-TEXT RATIONALE / SUMMARY */}
      <div>
        <div className={styles.sectionTitle}>Historical Rationale</div>
        <div className={styles.rationaleBlock}>{node.summary}</div>
      </div>

      {/* LINKED FILES */}
      {node.filePaths && node.filePaths.length > 0 && (
        <div>
          <div className={styles.sectionTitle}>
            Touched Files ({node.filePaths.length})
          </div>
          <div style={{ maxHeight: "140px", overflowY: "auto" }}>
            {node.filePaths.map((fp) => (
              <div key={fp} className={styles.fileItem}>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "210px",
                  }}
                  title={fp}
                >
                  {fp}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectTargetFile(fp)}
                  className={styles.traceLink}
                >
                  Trace &rarr;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CAUSAL CHAIN NAVIGATOR: UPSTREAM CAUSES */}
      {upstreamEdges.length > 0 && (
        <div>
          <div
            className={styles.sectionTitle}
            style={{ color: "var(--color-primary, #2563EB)" }}
          >
            Caused / Evidenced By ({upstreamEdges.length})
          </div>
          <div style={{ maxHeight: "150px", overflowY: "auto" }}>
            {upstreamEdges.map((e) => {
              const causeNode = nodeMap.get(e.source);
              if (!causeNode) return null;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelectNode(causeNode)}
                  className={styles.causalLinkCard}
                >
                  <div className={styles.causalLinkHeader}>
                    <span>{e.relation}</span>
                    <span>{formatShortId(causeNode)}</span>
                  </div>
                  <div className={styles.causalLinkTitle}>
                    {causeNode.title}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CAUSAL CHAIN NAVIGATOR: DOWNSTREAM CONSEQUENCES */}
      {downstreamEdges.length > 0 && (
        <div>
          <div
            className={styles.sectionTitle}
            style={{ color: "var(--color-success, #15803D)" }}
          >
            Led To / Governs ({downstreamEdges.length})
          </div>
          <div style={{ maxHeight: "150px", overflowY: "auto" }}>
            {downstreamEdges.map((e) => {
              const targetNode = nodeMap.get(e.target);
              if (!targetNode) return null;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelectNode(targetNode)}
                  className={styles.causalLinkCard}
                  style={{
                    borderColor: "rgba(16, 185, 129, 0.25)",
                    backgroundColor: "rgba(16, 185, 129, 0.04)",
                  }}
                >
                  <div
                    className={styles.causalLinkHeader}
                    style={{ color: "#059669" }}
                  >
                    <span>{e.relation}</span>
                    <span>{formatShortId(targetNode)}</span>
                  </div>
                  <div className={styles.causalLinkTitle}>
                    {targetNode.title}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
