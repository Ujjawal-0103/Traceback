"use client";

import React, { useState } from "react";
import {
  ProvenanceNodeType,
  ProvenanceSyncResponse,
} from "../../lib/provenance-api";
import styles from "./provenance.module.css";

export interface ProvenanceControlsProps {
  repositories: Array<{ id: string; fullName: string; name?: string }>;
  selectedRepoId: string;
  onSelectRepo: (repoId: string) => void;
  files: Array<{ path: string; eventCount: number }>;
  decisions: Array<{
    id: string;
    title: string;
    status: string;
    targetFilePath?: string;
  }>;
  selectedFilePath: string;
  onSelectFilePath: (filePath: string) => void;
  selectedDecisionId: string;
  onSelectDecisionId: (decisionId: string) => void;
  activeFilters: Record<ProvenanceNodeType, boolean>;
  onToggleFilter: (type: ProvenanceNodeType) => void;
  viewMode: "causal" | "timeline";
  onChangeViewMode: (mode: "causal" | "timeline") => void;
  dataSource: "neo4j" | "postgres_fallback" | null;
  neo4jConnected: boolean;
  onSync: () => Promise<void>;
  isSyncing: boolean;
  syncResult: {
    success: boolean;
    message: string;
    telemetry?: ProvenanceSyncResponse;
  } | null;
  onDismissSyncResult?: () => void;
  onResetQuery: () => void;
  countsByType?: Record<string, number>;
}

const FILTER_ITEMS: Array<{
  type: ProvenanceNodeType;
  label: string;
  countKey: string;
}> = [
  { type: "ISSUE", label: "Issues", countKey: "ISSUE" },
  { type: "PR", label: "PRs", countKey: "PR" },
  { type: "COMMIT", label: "Commits", countKey: "COMMIT" },
  { type: "DECISION", label: "Decisions", countKey: "DECISION" },
  { type: "REFACTOR", label: "Refactors", countKey: "REFACTOR" },
  {
    type: "SUPERSEDED_DECISION",
    label: "Superseded",
    countKey: "SUPERSEDED_DECISION",
  },
];

export function ProvenanceControls({
  repositories,
  selectedRepoId,
  onSelectRepo,
  files,
  decisions,
  selectedFilePath,
  onSelectFilePath,
  selectedDecisionId,
  onSelectDecisionId,
  activeFilters,
  onToggleFilter,
  viewMode,
  onChangeViewMode,
  dataSource: _dataSource,
  neo4jConnected,
  onSync,
  isSyncing,
  syncResult,
  onDismissSyncResult,
  onResetQuery,
  countsByType = {},
}: ProvenanceControlsProps) {
  const [scopeMode, setScopeMode] = useState<"all" | "file" | "decision">(
    selectedFilePath ? "file" : selectedDecisionId ? "decision" : "all",
  );
  const [customPath, setCustomPath] = useState("");

  const handleScopeChange = (mode: "all" | "file" | "decision") => {
    setScopeMode(mode);
    if (mode === "all") {
      onResetQuery();
    }
  };

  const handleCustomPathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customPath.trim()) {
      onSelectFilePath(customPath.trim());
      onSelectDecisionId("");
      setCustomPath("");
    }
  };

  const isFiltered = Boolean(selectedFilePath || selectedDecisionId);

  return (
    <div className={styles.controlsCard}>
      {/* COMPACT TOP HEADER BAR */}
      <div className={styles.topHeaderRow}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Why This Code Exists</h1>
            <span className={styles.titlePill}>Causal Provenance</span>
          </div>
          <p className={styles.subtitle}>
            Trace unbroken historical causality from GitHub issues to PRs,
            engineering decisions, and subsequent refactors.
          </p>
        </div>

        {/* TOP-RIGHT: Live Engine Pill & Sync Button */}
        <div className={styles.headerRight}>
          {/* Engine Status Pill */}
          <div
            title={
              neo4jConnected
                ? "Neo4j AuraDB graph active. Executing native multi-hop Cypher queries."
                : "Operating in PostgreSQL read-only fallback mode. Reconstructing causal timeline from repository artifacts."
            }
            className={`${styles.engineBadge} ${
              neo4jConnected
                ? styles.engineBadgeLive
                : styles.engineBadgeOffline
            }`}
          >
            <span
              className={`${styles.engineDot} ${
                neo4jConnected ? styles.engineDotLive : styles.engineDotOffline
              }`}
            />
            <span>{neo4jConnected ? "Neo4j Live" : "PostgreSQL Fallback"}</span>
          </div>

          {/* Sync Button */}
          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing || !selectedRepoId}
            className={styles.syncButton}
          >
            {isSyncing ? (
              <>
                <svg
                  width={14}
                  height={14}
                  className={`${styles.spinner} ${styles.iconLockedSmall}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    strokeDasharray="32"
                    strokeDashoffset="12"
                  />
                </svg>
                <span>Projecting Graph...</span>
              </>
            ) : (
              <>
                <svg
                  width={14}
                  height={14}
                  className={styles.iconLockedSmall}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>Sync Graph</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* SYNC RESULT TOAST */}
      {syncResult && (
        <div
          role="status"
          className={`${styles.toastBanner} ${
            syncResult.success ? styles.toastSuccess : styles.toastError
          }`}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: 800 }}>
              {syncResult.success ? "✓" : "!"}
            </span>
            <span>{syncResult.message}</span>
          </div>
          {onDismissSyncResult && (
            <button
              type="button"
              onClick={onDismissSyncResult}
              className={styles.toastDismiss}
              aria-label="Dismiss message"
            >
              &times;
            </button>
          )}
        </div>
      )}

      {/* SINGLE DENSE TOOLBAR CARD */}
      <div className={styles.controlBarCard}>
        {/* ROW 1: Repository Dropdown | Scope Segmented Control | View Mode Toggle */}
        <div className={styles.controlTopRow}>
          {/* Repository Select */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label
              htmlFor="provenance-repo-select"
              className={styles.filterLabel}
            >
              Repo:
            </label>
            <select
              id="provenance-repo-select"
              value={selectedRepoId}
              onChange={(e) => onSelectRepo(e.target.value)}
              className={styles.selectInput}
              style={{ minWidth: "180px", maxWidth: "260px" }}
            >
              {repositories.length === 0 ? (
                <option value="">No repositories available</option>
              ) : (
                repositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.fullName || repo.name || repo.id}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Scope Selector: All Highlights / By File / By Decision */}
          <div
            role="group"
            aria-label="Scope Selector"
            className={styles.segmentedGroup}
          >
            <button
              type="button"
              onClick={() => handleScopeChange("all")}
              className={`${styles.segmentedButton} ${
                scopeMode === "all" ? styles.segmentedButtonActive : ""
              }`}
            >
              All Highlights
            </button>
            <button
              type="button"
              onClick={() => handleScopeChange("file")}
              className={`${styles.segmentedButton} ${
                scopeMode === "file" ? styles.segmentedButtonActive : ""
              }`}
            >
              By File
            </button>
            <button
              type="button"
              onClick={() => handleScopeChange("decision")}
              className={`${styles.segmentedButton} ${
                scopeMode === "decision" ? styles.segmentedButtonActive : ""
              }`}
            >
              By Decision
            </button>
          </div>

          {/* If Scope is File: Dropdown or Input */}
          {scopeMode === "file" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <select
                id="provenance-file-select"
                value={selectedFilePath}
                onChange={(e) => {
                  onSelectFilePath(e.target.value);
                  if (e.target.value) onSelectDecisionId("");
                }}
                className={styles.selectInput}
                style={{ maxWidth: "220px" }}
              >
                <option value="">Select target file ({files.length})...</option>
                {files.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path} ({f.eventCount})
                  </option>
                ))}
              </select>
              <form
                onSubmit={handleCustomPathSubmit}
                className={styles.pathForm}
              >
                <input
                  type="text"
                  placeholder="or exact path..."
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  className={styles.textInput}
                />
                <button type="submit" className={styles.smallButton}>
                  Go
                </button>
              </form>
            </div>
          )}

          {/* If Scope is Decision: Dropdown */}
          {scopeMode === "decision" && (
            <select
              id="provenance-decision-select"
              value={selectedDecisionId}
              onChange={(e) => {
                onSelectDecisionId(e.target.value);
                if (e.target.value) onSelectFilePath("");
              }}
              className={styles.selectInput}
              style={{ maxWidth: "240px" }}
            >
              <option value="">Select decision ({decisions.length})...</option>
              {decisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({d.status})
                </option>
              ))}
            </select>
          )}

          {/* Clear target button if active */}
          {isFiltered && (
            <button
              type="button"
              onClick={onResetQuery}
              className={styles.smallButton}
              style={{
                backgroundColor: "transparent",
                color: "var(--color-text-secondary, #64748B)",
                border: "1px solid var(--color-border, #E2E8F0)",
              }}
              title="Clear file or decision filter"
            >
              Reset &times;
            </button>
          )}

          {/* View Mode Toggle: Causal Graph vs Chronological Timeline */}
          <div
            role="group"
            aria-label="View Mode Switcher"
            className={`${styles.segmentedGroup} ${styles.viewModePushRight}`}
          >
            <button
              type="button"
              onClick={() => onChangeViewMode("causal")}
              className={`${styles.segmentedButton} ${
                viewMode === "causal" ? styles.segmentedButtonActive : ""
              }`}
            >
              <svg
                width={14}
                height={14}
                className={styles.iconLockedSmall}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ marginRight: "4px" }}
                aria-hidden="true"
              >
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <line x1="8.7" y1="10.7" x2="15.3" y2="7.3" />
                <line x1="8.7" y1="13.3" x2="15.3" y2="16.7" />
              </svg>
              <span>Causal Graph</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode("timeline")}
              className={`${styles.segmentedButton} ${
                viewMode === "timeline" ? styles.segmentedButtonActive : ""
              }`}
            >
              <svg
                width={14}
                height={14}
                className={styles.iconLockedSmall}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ marginRight: "4px" }}
                aria-hidden="true"
              >
                <line x1="12" y1="3" x2="12" y2="21" />
                <circle cx="12" cy="7" r="2" />
                <circle cx="12" cy="17" r="2" />
              </svg>
              <span>Timeline</span>
            </button>
          </div>
        </div>

        {/* ROW 2: Artifact Filter Chips */}
        <div className={styles.controlBottomRow}>
          <span className={styles.filterLabel}>Filter:</span>
          {FILTER_ITEMS.map(({ type, label, countKey }) => {
            const active = activeFilters[type] !== false;
            const count = countsByType[countKey] ?? countsByType[type] ?? null;

            return (
              <button
                key={type}
                type="button"
                onClick={() => onToggleFilter(type)}
                aria-pressed={active}
                className={`${styles.filterPill} ${
                  active ? styles.filterPillActive : ""
                }`}
              >
                <span
                  className={styles.filterDot}
                  style={{
                    backgroundColor:
                      type === "ISSUE"
                        ? "#F59E0B"
                        : type === "PR"
                          ? "#8B5CF6"
                          : type === "COMMIT"
                            ? "#3B82F6"
                            : type === "DECISION"
                              ? "#10B981"
                              : type === "REFACTOR"
                                ? "#14B8A6"
                                : "#F43F5E",
                  }}
                />
                <span>{label}</span>
                {count !== null && (
                  <span className={styles.filterCount}>({count})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
