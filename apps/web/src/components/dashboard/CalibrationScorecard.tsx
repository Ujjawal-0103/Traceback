"use client";

import React from "react";
import Link from "next/link";
import { WorkspaceCalibrationDto } from "@traceback/shared-types";
import styles from "./calibration.module.css";

interface CalibrationScorecardProps {
  calibration: WorkspaceCalibrationDto | null;
  isLoading?: boolean;
  workspaceId?: string;
}

export function CalibrationScorecard({
  calibration,
  isLoading = false,
}: CalibrationScorecardProps) {
  if (isLoading) {
    return (
      <section
        className={styles.container}
        aria-label="Loading workspace calibration"
      >
        <div
          style={{
            textAlign: "center",
            padding: "1.5rem",
            color: "var(--color-text-secondary)",
          }}
        >
          Loading calibration telemetry...
        </div>
      </section>
    );
  }

  if (!calibration) {
    return null;
  }

  const {
    verdictDistribution,
    humanOversight,
    decisionHealth,
    contextBlindSpots,
  } = calibration;

  return (
    <section
      className={styles.container}
      aria-label="Workspace Calibration and Context Blind-Spot Telemetry"
    >
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>
            <span>📊</span>
            <span>Workspace Calibration & Context Blind-Spot Telemetry</span>
          </h2>
          <p className={styles.subtitle}>
            Empirical accuracy distribution, human oversight override rate, and
            repository context blind spots
          </p>
        </div>
        <span className={styles.tag}>Live Advisory Telemetry</span>
      </div>

      <div className={styles.metricsGrid}>
        {/* Card 1: Verdict Distribution */}
        <div className={styles.card}>
          <div>
            <div className={styles.cardTitle}>
              <span>⚖️</span>
              <span>Epistemological Verdicts</span>
            </div>
            <div className={styles.bigStat}>{verdictDistribution.total}</div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-secondary)",
              }}
            >
              Total Verified Technical Claims
            </div>

            {/* Segmented Progress Bar */}
            <div
              className={styles.barTrack}
              aria-label="Verdict distribution breakdown"
            >
              <div
                className={`${styles.barSegment} ${styles.barSupported}`}
                style={{ width: `${verdictDistribution.supportedPct}%` }}
                title={`Supported: ${verdictDistribution.supportedPct}% (${verdictDistribution.supported})`}
              />
              <div
                className={`${styles.barSegment} ${styles.barContradicted}`}
                style={{ width: `${verdictDistribution.contradictedPct}%` }}
                title={`Contradicted: ${verdictDistribution.contradictedPct}% (${verdictDistribution.contradicted})`}
              />
              <div
                className={`${styles.barSegment} ${styles.barMixed}`}
                style={{ width: `${verdictDistribution.mixedPct}%` }}
                title={`Mixed: ${verdictDistribution.mixedPct}% (${verdictDistribution.mixed})`}
              />
              <div
                className={`${styles.barSegment} ${styles.barInsufficient}`}
                style={{
                  width: `${verdictDistribution.insufficientEvidencePct}%`,
                }}
                title={`Insufficient Evidence: ${verdictDistribution.insufficientEvidencePct}% (${verdictDistribution.insufficientEvidence})`}
              />
            </div>

            <div className={styles.legendGrid}>
              <div className={styles.legendItem}>
                <span
                  className={styles.dot}
                  style={{ backgroundColor: "#10B981" }}
                />
                <span>
                  Supported:{" "}
                  <strong>{verdictDistribution.supportedPct}%</strong>
                </span>
              </div>
              <div className={styles.legendItem}>
                <span
                  className={styles.dot}
                  style={{ backgroundColor: "#EF4444" }}
                />
                <span>
                  Contradicted:{" "}
                  <strong>{verdictDistribution.contradictedPct}%</strong>
                </span>
              </div>
              <div className={styles.legendItem}>
                <span
                  className={styles.dot}
                  style={{ backgroundColor: "#F59E0B" }}
                />
                <span>
                  Mixed: <strong>{verdictDistribution.mixedPct}%</strong>
                </span>
              </div>
              <div className={styles.legendItem}>
                <span
                  className={styles.dot}
                  style={{ backgroundColor: "#94A3B8" }}
                />
                <span>
                  Sparse:{" "}
                  <strong>
                    {verdictDistribution.insufficientEvidencePct}%
                  </strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Human Oversight */}
        <div className={styles.card}>
          <div>
            <div className={styles.cardTitle}>
              <span>🧑‍💻</span>
              <span>Human Oversight & Overrides</span>
            </div>
            <div className={styles.bigStat}>{humanOversight.overrideRate}%</div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-secondary)",
              }}
            >
              Human Override Rate on Evaluated Claims
            </div>
          </div>

          <div style={{ marginTop: "0.75rem" }}>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Human Review Rate:</span>
              <span className={styles.statValue}>
                {humanOversight.humanReviewRate}% (
                {humanOversight.humanReviewedCount}/
                {humanOversight.totalEvaluated})
              </span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Reviewer Agreement:</span>
              <span className={styles.statValue}>
                {humanOversight.agreementCount} claims
              </span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Human Overrides:</span>
              <span
                className={styles.statValue}
                style={{
                  color:
                    humanOversight.overrideCount > 0 ? "#DC2626" : "inherit",
                }}
              >
                {humanOversight.overrideCount} claims
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Decision Freshness & Drift */}
        <div className={styles.card}>
          <div>
            <div className={styles.cardTitle}>
              <span>🏛️</span>
              <span>Decision Freshness & Drift</span>
            </div>
            <div className={styles.bigStat}>{decisionHealth.accepted}</div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-secondary)",
              }}
            >
              Current & Fresh Engineering Decisions
            </div>
          </div>

          <div style={{ marginTop: "0.75rem" }}>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Needs Review (Drifted):</span>
              <span
                className={styles.statValue}
                style={{
                  color: decisionHealth.needsReview > 0 ? "#D97706" : "inherit",
                }}
              >
                {decisionHealth.needsReview > 0
                  ? `⚠️ ${decisionHealth.needsReview}`
                  : 0}
              </span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Candidates Under Review:</span>
              <span className={styles.statValue}>
                {decisionHealth.candidate}
              </span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Superseded Decisions:</span>
              <span className={styles.statValue}>
                {decisionHealth.superseded}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Context Blind Spots Section */}
      <div className={styles.blindSpotsSection}>
        <div className={styles.blindSpotsHeader}>
          <h3 className={styles.blindSpotsTitle}>
            <span>🔭</span>
            <span>
              Repository Context Blind Spots (Unprotected High-Churn Files)
            </span>
          </h3>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--color-text-secondary)",
            }}
          >
            High commit frequency or sparse evidence without accepted decisions
          </span>
        </div>

        {contextBlindSpots.length === 0 ? (
          <div className={styles.emptyBlindSpots}>
            No unanchored high-churn context blind spots detected in this
            workspace.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className={styles.blindSpotsTable}>
              <thead>
                <tr>
                  <th>Target File Path</th>
                  <th>Repository</th>
                  <th>Commits</th>
                  <th>Sparse Hits</th>
                  <th>Protection Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {contextBlindSpots.map((spot, idx) => (
                  <tr key={`${spot.repositoryId}-${spot.filePath}-${idx}`}>
                    <td>
                      <code>{spot.filePath}</code>
                    </td>
                    <td>{spot.repositoryName}</td>
                    <td>{spot.commitCount}</td>
                    <td>{spot.insufficientEvidenceHits}</td>
                    <td>
                      {spot.hasAcceptedDecision ? (
                        <span className={styles.protectedBadge}>
                          Decision Recorded
                        </span>
                      ) : (
                        <span className={styles.blindSpotBadge}>
                          Blind Spot (No Decision)
                        </span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/verify?repoId=${encodeURIComponent(
                          spot.repositoryId,
                        )}&filePath=${encodeURIComponent(spot.filePath)}`}
                        className={styles.actionLink}
                      >
                        Explain & Verify →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
