"use client";

import React, { useState, useEffect, useCallback } from "react";
import { adrSyncApi } from "../../lib/adr-sync-api";
import {
  AdrFileSummary,
  EngineeringDecisionDto,
} from "@traceback/shared-types";

export interface AdrSyncPanelProps {
  repositoryId?: string;
  decisions?: EngineeringDecisionDto[];
  onSyncSuccess?: () => void;
}

export function AdrSyncPanel({
  repositoryId,
  decisions = [],
  onSyncSuccess,
}: AdrSyncPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [files, setFiles] = useState<AdrFileSummary[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedDecisionIdForExport, setSelectedDecisionIdForExport] =
    useState<string>(decisions[0]?.id || "");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Update selected decision when decisions list changes
  useEffect(() => {
    if (decisions.length > 0 && !selectedDecisionIdForExport) {
      setSelectedDecisionIdForExport(decisions[0].id);
    }
  }, [decisions, selectedDecisionIdForExport]);

  const loadFiles = useCallback(async () => {
    try {
      setIsLoadingFiles(true);
      const data = await adrSyncApi.getAdrFiles({ repositoryId });
      setFiles(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        type: "error",
        text: `Failed to list local ADR files: ${msg}`,
      });
    } finally {
      setIsLoadingFiles(false);
    }
  }, [repositoryId]);

  useEffect(() => {
    if (isExpanded) {
      loadFiles();
    }
  }, [isExpanded, loadFiles]);

  const handleImport = async () => {
    try {
      setIsImporting(true);
      setStatusMessage({
        type: "info",
        text: "Scanning /docs/adr/ and importing architecture records...",
      });

      const res = await adrSyncApi.importAdrs({
        repositoryId,
        overwriteExisting,
      });

      setStatusMessage({
        type: "success",
        text: `Import complete: ${res.importedCount} new decisions added, ${res.updatedCount} updated, ${res.skippedCount} skipped from ${res.totalFilesScanned} local ADR files.`,
      });

      await loadFiles();
      if (onSyncSuccess) {
        onSyncSuccess();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        type: "error",
        text: `ADR import failed: ${msg}`,
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async (decisionId?: string) => {
    const targetId = decisionId || selectedDecisionIdForExport;
    if (!targetId) {
      setStatusMessage({
        type: "error",
        text: "Please select an engineering decision to export.",
      });
      return;
    }

    try {
      setIsExporting(true);
      setStatusMessage({
        type: "info",
        text: `Serializing decision ${targetId} into ADR Markdown...`,
      });

      const res = await adrSyncApi.exportDecisionToAdr(targetId, {
        repositoryId,
      });

      setStatusMessage({
        type: "success",
        text: `Exported successfully to "${res.filePath}" (${res.writtenBytes} bytes written).`,
      });

      await loadFiles();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        type: "error",
        text: `ADR export failed: ${msg}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      id="adr-sync-panel-card"
      style={{
        backgroundColor: "var(--color-surface, #FFFFFF)",
        border: "1px solid var(--color-border, #E2E8F0)",
        borderRadius: "8px",
        marginBottom: "1.5rem",
        boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
        overflow: "hidden",
        color: "var(--color-text, #0F172A)",
      }}
    >
      {/* Collapsible Panel Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.85rem 1.25rem",
          backgroundColor: isExpanded
            ? "var(--color-background, #F8FAFC)"
            : "transparent",
          borderBottom: isExpanded
            ? "1px solid var(--color-border, #E2E8F0)"
            : "none",
          cursor: "pointer",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ fontSize: "1.1rem" }}>📄</span>
          <div>
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "var(--color-text, #0F172A)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span>ADR Bidirectional Sync</span>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontFamily: "monospace",
                  padding: "1px 6px",
                  borderRadius: "4px",
                  backgroundColor:
                    "var(--color-primary-light, rgba(37, 99, 235, 0.1))",
                  color: "var(--color-primary, #2563EB)",
                }}
              >
                /docs/adr/*.md
              </span>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-secondary, #64748B)",
              }}
            >
              Sync local architecture decision records with workspace PostgreSQL
              storage (ADR-007 read-only compliant).
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            id="btn-toggle-adr-panel"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            style={{
              padding: "0.3rem 0.65rem",
              borderRadius: "4px",
              border: "1px solid var(--color-border, #CBD5E1)",
              backgroundColor: "var(--color-surface, #FFFFFF)",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--color-text, #0F172A)",
            }}
          >
            {isExpanded ? "▲ Collapse" : "▼ Expand Panel"}
          </button>
        </div>
      </div>

      {/* Expanded Content Area */}
      {isExpanded && (
        <div style={{ padding: "1.25rem" }}>
          {/* Action Row */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              paddingBottom: "1rem",
              borderBottom: "1px solid var(--color-border, #E2E8F0)",
              marginBottom: "1rem",
            }}
          >
            {/* Import Actions */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                id="btn-import-adrs"
                disabled={isImporting}
                onClick={handleImport}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.45rem 0.9rem",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "var(--color-primary, #2563EB)",
                  color: "#FFFFFF",
                  fontSize: "0.825rem",
                  fontWeight: 600,
                  cursor: isImporting ? "not-allowed" : "pointer",
                  opacity: isImporting ? 0.7 : 1,
                  boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)",
                }}
              >
                {isImporting ? "Importing..." : "📥 Import from /docs/adr/*.md"}
              </button>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.775rem",
                  color: "var(--color-text-secondary, #64748B)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  id="chk-overwrite-existing"
                  checked={overwriteExisting}
                  onChange={(e) => setOverwriteExisting(e.target.checked)}
                />
                Overwrite existing records
              </label>

              <button
                type="button"
                id="btn-refresh-adr-files"
                onClick={loadFiles}
                disabled={isLoadingFiles}
                style={{
                  padding: "0.45rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border, #CBD5E1)",
                  backgroundColor: "var(--color-surface, #FFFFFF)",
                  color: "var(--color-text, #0F172A)",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {isLoadingFiles ? "Refreshing..." : "🔄 Refresh"}
              </button>
            </div>

            {/* Export Actions */}
            {decisions.length > 0 && (
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <select
                  id="select-decision-to-export"
                  value={selectedDecisionIdForExport}
                  onChange={(e) =>
                    setSelectedDecisionIdForExport(e.target.value)
                  }
                  style={{
                    maxWidth: "240px",
                    padding: "0.45rem 0.6rem",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border, #CBD5E1)",
                    backgroundColor: "var(--color-surface, #FFFFFF)",
                    color: "var(--color-text, #0F172A)",
                    fontSize: "0.8rem",
                  }}
                >
                  {decisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title.length > 32
                        ? `${d.title.slice(0, 30)}...`
                        : d.title}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  id="btn-export-adr"
                  disabled={isExporting}
                  onClick={() => handleExport()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.45rem 0.85rem",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border, #CBD5E1)",
                    backgroundColor: "var(--color-surface, #FFFFFF)",
                    color: "var(--color-text, #0F172A)",
                    fontSize: "0.825rem",
                    fontWeight: 600,
                    cursor: isExporting ? "not-allowed" : "pointer",
                  }}
                >
                  {isExporting ? "Writing..." : "📤 Export to /docs/adr/*.md"}
                </button>
              </div>
            )}
          </div>

          {/* Status Feedback Notification */}
          {statusMessage && (
            <div
              id="adr-sync-status-banner"
              style={{
                padding: "0.65rem 0.9rem",
                borderRadius: "6px",
                fontSize: "0.825rem",
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor:
                  statusMessage.type === "success"
                    ? "rgba(16, 185, 129, 0.1)"
                    : statusMessage.type === "error"
                      ? "rgba(239, 68, 68, 0.1)"
                      : "rgba(59, 130, 246, 0.1)",
                border:
                  statusMessage.type === "success"
                    ? "1px solid #10B981"
                    : statusMessage.type === "error"
                      ? "1px solid #EF4444"
                      : "1px solid #3B82F6",
                color:
                  statusMessage.type === "success"
                    ? "#065F46"
                    : statusMessage.type === "error"
                      ? "#991B1B"
                      : "#1E40AF",
              }}
            >
              <span>{statusMessage.text}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  color: "inherit",
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Files Grid / List */}
          <div>
            <div
              style={{
                fontSize: "0.775rem",
                fontWeight: 700,
                color: "var(--color-text-secondary, #64748B)",
                textTransform: "uppercase",
                marginBottom: "0.5rem",
              }}
            >
              Discovered Local ADR Files ({files.length})
            </div>

            {isLoadingFiles ? (
              <div
                style={{
                  fontSize: "0.825rem",
                  color: "var(--color-text-secondary, #64748B)",
                  padding: "1rem 0",
                }}
              >
                Scanning repository ADR directories...
              </div>
            ) : files.length === 0 ? (
              <div
                style={{
                  fontSize: "0.825rem",
                  color: "var(--color-text-secondary, #64748B)",
                  padding: "1rem",
                  borderRadius: "6px",
                  backgroundColor: "var(--color-background, #F8FAFC)",
                  textAlign: "center",
                }}
              >
                No Markdown ADR files found in <code>/docs/adr/</code> or{" "}
                <code>/docs/architecture/ADRs/</code>.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.45rem",
                }}
              >
                {files.map((file) => (
                  <div
                    key={file.fileName}
                    id={`adr-file-row-${file.fileName}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.55rem 0.85rem",
                      borderRadius: "6px",
                      backgroundColor: "var(--color-background, #F8FAFC)",
                      border: "1px solid var(--color-border, #E2E8F0)",
                      fontSize: "0.825rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        overflow: "hidden",
                      }}
                    >
                      <span style={{ fontSize: "0.9rem" }}>📄</span>
                      <strong style={{ fontFamily: "monospace" }}>
                        {file.fileName}
                      </strong>
                      <span
                        style={{
                          color: "var(--color-text-secondary, #64748B)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {file.title}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor:
                            file.status === "ACCEPTED"
                              ? "rgba(16, 185, 129, 0.15)"
                              : "rgba(245, 158, 11, 0.15)",
                          color:
                            file.status === "ACCEPTED" ? "#047857" : "#B45309",
                        }}
                      >
                        {file.status}
                      </span>

                      {file.existsInDatabase ? (
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: "rgba(59, 130, 246, 0.1)",
                            color: "#1D4ED8",
                          }}
                        >
                          ✓ Synced to DB
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: "rgba(107, 114, 128, 0.1)",
                            color: "#4B5563",
                          }}
                        >
                          Filesystem Only
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
