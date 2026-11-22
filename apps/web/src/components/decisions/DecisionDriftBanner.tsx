"use client";

import React, { useState } from "react";
import { EngineeringDecisionDto } from "@traceback/shared-types";
import styles from "./decision-drift.module.css";

interface DecisionDriftBannerProps {
  decision: EngineeringDecisionDto;
  onConfirmValid?: (decisionId: string) => Promise<void>;
  onSupersede?: (decision: EngineeringDecisionDto) => void;
  isConfirming?: boolean;
}

export function DecisionDriftBanner({
  decision,
  onConfirmValid,
  onSupersede,
  isConfirming = false,
}: DecisionDriftBannerProps) {
  const [localConfirming, setLocalConfirming] = useState(false);

  const isDrifted =
    decision.isPotentiallyStale === true ||
    decision.driftStatus === "NEEDS_REVIEW";

  const handleConfirm = async () => {
    if (!onConfirmValid) return;
    try {
      setLocalConfirming(true);
      await onConfirmValid(decision.id);
    } finally {
      setLocalConfirming(false);
    }
  };

  if (!isDrifted && !decision.supersedesId && !decision.supersededById) {
    return null;
  }

  return (
    <div
      className={styles.bannerContainer}
      role="region"
      aria-label="Decision drift and lineage status"
    >
      {isDrifted && (
        <>
          <div className={styles.bannerHeader}>
            <div className={styles.titleArea}>
              <span className={styles.warningIcon} aria-hidden="true">
                ⚠️
              </span>
              <span className={styles.titleText}>
                Decision Drift Detected — Code Changed Since Recorded
              </span>
            </div>
            <span className={styles.badge}>Needs Review</span>
          </div>

          <p className={styles.description}>
            Newer commits modified the files governed by this architectural
            constraint after it was established. Verify that this constraint
            remains valid or record a superseding decision.
          </p>

          <div className={styles.metaGrid}>
            <div>
              <strong>Newer Commits: </strong>
              <span>{decision.newerCommitCount ?? 1}</span>
            </div>
            {decision.latestDriftingCommitSha && (
              <div>
                <strong>Latest Drift Commit: </strong>
                <code>{decision.latestDriftingCommitSha.slice(0, 8)}</code>
              </div>
            )}
            {decision.driftedFiles && decision.driftedFiles.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <strong>Drifted Files: </strong>
                <span>{decision.driftedFiles.join(", ")}</span>
              </div>
            )}
          </div>

          <div className={styles.actionsArea}>
            {onConfirmValid && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirming || localConfirming}
                className={styles.confirmBtn}
              >
                {isConfirming || localConfirming
                  ? "Confirming..."
                  : "✓ Confirm Still Valid"}
              </button>
            )}

            {onSupersede && (
              <button
                type="button"
                onClick={() => onSupersede(decision)}
                className={styles.supersedeBtn}
              >
                🔄 Propose Superseding Decision
              </button>
            )}
          </div>
        </>
      )}

      {(decision.supersedesId || decision.supersededById) && (
        <div className={styles.lineageRow}>
          {decision.supersedesId && (
            <span>
              ↳ Supersedes previous decision:{" "}
              <span className={styles.lineageTag}>
                DEC-{decision.supersedesId.slice(0, 8)}
              </span>
            </span>
          )}
          {decision.supersededById && (
            <span>
              ⤤ Superseded by decision:{" "}
              <span className={styles.lineageTag}>
                DEC-{decision.supersededById.slice(0, 8)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
