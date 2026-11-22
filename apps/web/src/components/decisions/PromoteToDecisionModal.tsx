"use client";

import React, { useState } from "react";
import Link from "next/link";
import { adrSyncApi } from "../../lib/adr-sync-api";
import { DecisionSeverity } from "@traceback/shared-types";

export interface PromoteToDecisionModalProps {
  claimId: string;
  sessionId?: string;
  repositoryId: string;
  claimText: string;
  targetSymbol?: string | null;
  targetFilePath?: string | null;
  explanation?: string;
  evidence?: Array<{
    sourceType: string;
    referenceKey: string;
    title: string;
    snippet?: string | null;
    url?: string;
    filePath?: string | null;
  }>;
}

export function PromoteToDecisionModal({
  claimId,
  sessionId,
  repositoryId,
  claimText,
  targetSymbol,
  targetFilePath,
  explanation,
  evidence = [],
}: PromoteToDecisionModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Pre-populate title
  const defaultTitle = targetSymbol
    ? `Architectural Constraint for ${targetSymbol}`
    : claimText.length > 80
      ? `${claimText.slice(0, 77)}...`
      : claimText;
  const [title, setTitle] = useState(defaultTitle);

  // Pre-populate rationale
  const evidenceSummary = evidence
    .map(
      (ev) =>
        `- [${ev.sourceType}] ${ev.referenceKey}: ${ev.title}${
          ev.snippet ? `\n  > "${ev.snippet.trim().slice(0, 160)}"` : ""
        }`,
    )
    .join("\n");
  const defaultRationale = `Verified Explanation:\n${explanation || "No explanation provided."}\n\nSupporting Provenance:\n${
    evidenceSummary || "No direct citations linked."
  }`;
  const [rationale, setRationale] = useState(defaultRationale);
  const [severity, setSeverity] = useState<DecisionSeverity>("MEDIUM");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdDecision, setCreatedDecision] = useState<{
    id: string;
    status: string;
  } | null>(null);

  const handleOpen = () => {
    setTitle(defaultTitle);
    setRationale(defaultRationale);
    setError(null);
    setCreatedDecision(null);
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repositoryId || !claimId) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const res = await adrSyncApi.promoteClaimToDecision({
        claimId,
        verificationSessionId: sessionId,
        repositoryId,
        title: title.trim(),
        rationale: rationale.trim(),
        severity,
        targetFilePath: targetFilePath || undefined,
        targetSymbol: targetSymbol || undefined,
      });

      setCreatedDecision({
        id: res.decisionId || res.id,
        status: res.status,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to promote claim to decision: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        id={`btn-promote-modal-trigger-${claimId}`}
        onClick={handleOpen}
        title="Promote this verified claim into an unapproved draft in Engineering Decision Memory"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.45rem 0.9rem",
          borderRadius: "6px",
          border: "1px solid var(--color-primary, #2563EB)",
          backgroundColor:
            "var(--color-primary-light, rgba(37, 99, 235, 0.08))",
          color: "var(--color-primary, #2563EB)",
          fontSize: "0.825rem",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        🏛️ Promote to Decision
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="promote-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--color-surface, #FFFFFF)",
              border: "1px solid var(--color-border, #E2E8F0)",
              borderRadius: "12px",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
              maxWidth: "680px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "1.75rem",
              color: "var(--color-text, #0F172A)",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "1rem",
              }}
            >
              <div>
                <h2
                  id="promote-modal-title"
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span>🏛️</span> Promote to Engineering Decision Memory
                </h2>
                <p
                  style={{
                    fontSize: "0.825rem",
                    color: "var(--color-text-secondary, #64748B)",
                    margin: "0.25rem 0 0 0",
                  }}
                >
                  Transform this verified claim and provenance trail into an
                  architectural decision record.
                </p>
              </div>

              <button
                type="button"
                onClick={handleClose}
                aria-label="Close modal"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.25rem",
                  cursor: "pointer",
                  color: "var(--color-text-secondary, #64748B)",
                  padding: "0.25rem",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {/* Explicit Notice Badge */}
            <div
              id="promote-modal-draft-badge"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.6rem 0.85rem",
                borderRadius: "8px",
                backgroundColor: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.35)",
                color: "#B45309",
                fontSize: "0.825rem",
                fontWeight: 600,
                marginBottom: "1.25rem",
              }}
            >
              <span>⚠️</span>
              <span>
                <strong>Draft — Requires Human Approval:</strong> This decision
                will be created in candidate status and will never be
                auto-approved without manual team consensus.
              </span>
            </div>

            {error && (
              <div
                style={{
                  padding: "0.75rem",
                  borderRadius: "6px",
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid #EF4444",
                  color: "#B91C1C",
                  fontSize: "0.825rem",
                  marginBottom: "1rem",
                }}
              >
                {error}
              </div>
            )}

            {createdDecision ? (
              /* Success confirmation state */
              <div
                style={{
                  padding: "1.25rem",
                  borderRadius: "8px",
                  backgroundColor: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid #10B981",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
                  ✅
                </div>
                <h3
                  style={{
                    fontSize: "1rem",
                    fontWeight: 700,
                    color: "#065F46",
                    margin: "0 0 0.5rem 0",
                  }}
                >
                  Decision Draft Created Successfully!
                </h3>
                <p
                  style={{
                    fontSize: "0.825rem",
                    color: "#047857",
                    marginBottom: "1.25rem",
                  }}
                >
                  Persisted strictly in{" "}
                  <strong>{createdDecision.status}</strong> status with linked
                  commit and PR provenance.
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    justifyContent: "center",
                  }}
                >
                  <Link
                    href={`/decisions?id=${createdDecision.id}`}
                    id="link-view-created-decision"
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "6px",
                      backgroundColor: "#10B981",
                      color: "#FFFFFF",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    View in Decision Memory Studio →
                  </Link>
                  <button
                    type="button"
                    onClick={handleClose}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border, #E2E8F0)",
                      backgroundColor: "var(--color-surface, #FFFFFF)",
                      color: "var(--color-text, #0F172A)",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Promotion Form */
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: "1rem" }}>
                  <label
                    htmlFor="promote-decision-title"
                    style={{
                      display: "block",
                      fontSize: "0.825rem",
                      fontWeight: 600,
                      marginBottom: "0.35rem",
                    }}
                  >
                    Decision Title
                  </label>
                  <input
                    id="promote-decision-title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.55rem 0.75rem",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border, #CBD5E1)",
                      backgroundColor: "var(--color-background, #F8FAFC)",
                      color: "var(--color-text, #0F172A)",
                      fontSize: "0.875rem",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "1rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <label
                      htmlFor="promote-decision-severity"
                      style={{
                        display: "block",
                        fontSize: "0.825rem",
                        fontWeight: 600,
                        marginBottom: "0.35rem",
                      }}
                    >
                      Constraint Severity
                    </label>
                    <select
                      id="promote-decision-severity"
                      value={severity}
                      onChange={(e) =>
                        setSeverity(e.target.value as DecisionSeverity)
                      }
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border, #CBD5E1)",
                        backgroundColor: "var(--color-background, #F8FAFC)",
                        color: "var(--color-text, #0F172A)",
                        fontSize: "0.875rem",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="CRITICAL">Critical (Breaks System)</option>
                      <option value="HIGH">High (Important Rule)</option>
                      <option value="MEDIUM">Medium (Recommended)</option>
                      <option value="LOW">Low (Minor Style/Guidance)</option>
                      <option value="ADVISORY">Advisory (Informational)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.825rem",
                        fontWeight: 600,
                        marginBottom: "0.35rem",
                      }}
                    >
                      Target Scope
                    </label>
                    <div
                      style={{
                        padding: "0.55rem 0.75rem",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border, #E2E8F0)",
                        backgroundColor: "var(--color-background, #F1F5F9)",
                        fontSize: "0.825rem",
                        color: "var(--color-text-secondary, #475569)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={`${targetFilePath || "Global"} ${targetSymbol ? `(${targetSymbol})` : ""}`}
                    >
                      {targetFilePath || "Global Repository Scope"}{" "}
                      {targetSymbol && `• ${targetSymbol}`}
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: "1rem" }}>
                  <label
                    htmlFor="promote-decision-rationale"
                    style={{
                      display: "block",
                      fontSize: "0.825rem",
                      fontWeight: 600,
                      marginBottom: "0.35rem",
                    }}
                  >
                    Rationale & Provenance Excerpts
                  </label>
                  <textarea
                    id="promote-decision-rationale"
                    rows={6}
                    required
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.55rem 0.75rem",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border, #CBD5E1)",
                      backgroundColor: "var(--color-background, #F8FAFC)",
                      color: "var(--color-text, #0F172A)",
                      fontSize: "0.8rem",
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {evidence.length > 0 && (
                  <div
                    style={{
                      padding: "0.75rem",
                      borderRadius: "6px",
                      backgroundColor: "var(--color-background, #F8FAFC)",
                      border: "1px solid var(--color-border, #E2E8F0)",
                      marginBottom: "1.25rem",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "var(--color-text-secondary, #64748B)",
                        textTransform: "uppercase",
                        marginBottom: "0.4rem",
                      }}
                    >
                      Linked Provenance References ({evidence.length})
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.4rem",
                      }}
                    >
                      {evidence.map((ev, idx) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: "0.75rem",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            backgroundColor: "var(--color-surface, #FFFFFF)",
                            border: "1px solid var(--color-border, #CBD5E1)",
                            color: "var(--color-primary, #2563EB)",
                            fontFamily: "monospace",
                          }}
                        >
                          {ev.sourceType}: {ev.referenceKey}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Form Buttons */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "0.75rem",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isSubmitting}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border, #CBD5E1)",
                      backgroundColor: "var(--color-surface, #FFFFFF)",
                      color: "var(--color-text, #0F172A)",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    id="btn-submit-promote-decision"
                    disabled={isSubmitting}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: "6px",
                      border: "none",
                      backgroundColor: "var(--color-primary, #2563EB)",
                      color: "#FFFFFF",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                      opacity: isSubmitting ? 0.7 : 1,
                    }}
                  >
                    {isSubmitting ? "Promoting..." : "Save as Draft Decision"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
