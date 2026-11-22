"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { api, ApiError } from "../lib/api";
import {
  CalibrationScorecardDto,
  ContextBlindSpotItem,
} from "@traceback/shared-types";

interface CalibrationScorecardProps {
  workspaceId?: string;
}

export function CalibrationScorecard({
  workspaceId,
}: CalibrationScorecardProps) {
  const [data, setData] = useState<CalibrationScorecardDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchScorecard = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setIsLoading(true);
      setError(null);
      const scorecard = await api.getCalibrationScorecard(workspaceId);
      setData(scorecard);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load calibration telemetry";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchScorecard();
  }, [fetchScorecard]);

  // Derived simulation metrics if ADR coverage simulation is active
  const simulationMetrics = useMemo(() => {
    if (!data || data.totalClaims === 0) return null;
    const { totalClaims, verdictBreakdown, blindSpots } = data;

    // Potential fixed abstentions if all missing-decision blind spots were covered
    const missingDecisionSpots = (blindSpots || []).filter(
      (b) => !b.hasAcceptedDecision,
    );
    const potentialFixedAbstentions = Math.min(
      verdictBreakdown.insufficientEvidence.count,
      missingDecisionSpots.reduce(
        (acc, b) => acc + b.insufficientEvidenceCount,
        0,
      ) || Math.ceil(verdictBreakdown.insufficientEvidence.count * 0.75),
    );

    const projectedSupported =
      verdictBreakdown.supported.count + potentialFixedAbstentions;
    const projectedAbstained = Math.max(
      0,
      verdictBreakdown.insufficientEvidence.count - potentialFixedAbstentions,
    );

    const projectedGroundedRate =
      Math.round((projectedSupported / totalClaims) * 1000) / 10;
    const projectedAbstentionRate =
      Math.round((projectedAbstained / totalClaims) * 1000) / 10;

    let projectedScore =
      (projectedSupported * 100 +
        verdictBreakdown.mixed.count * 50 +
        projectedAbstained * 35) /
        totalClaims -
      (verdictBreakdown.contradicted.count / totalClaims) * 50;

    projectedScore = Math.min(
      100,
      Math.max(0, Math.round(projectedScore * 10) / 10),
    );

    return {
      potentialFixedAbstentions,
      projectedSupported,
      projectedAbstained,
      projectedGroundedRate,
      projectedAbstentionRate,
      projectedScore,
      lift: Math.round((projectedScore - data.effectiveTrustScore) * 10) / 10,
    };
  }, [data]);

  const copyAuditSnapshot = () => {
    if (!data) return;
    const grade = getCalibrationGrade(data.effectiveTrustScore).grade;
    const text = `# Traceback AI Calibration & Trust Audit Snapshot
- **Headline Calibration & Trust Score**: ${data.effectiveTrustScore}% (Grade ${grade})
- **Effective Grounded Rate**: ${data.effectiveGroundedRate}%
- **Abstention Rate**: ${data.abstentionRate}%
- **Contradicted Rate**: ${data.contradictedRate}%
- **Total Verifications**: ${data.totalVerifications} sessions (${data.totalClaims} claims evaluated)
- **4-Quadrant Honesty Matrix**:
  - Verified Grounded: ${data.calibrationQuadrants?.verifiedGrounded ?? 0}
  - Silent Hallucinations: ${data.calibrationQuadrants?.silentHallucinations ?? 0}
  - Caught Contradictions: ${data.calibrationQuadrants?.caughtContradictions ?? 0}
  - Safe Abstentions: ${data.calibrationQuadrants?.safeAbstentions ?? 0}
- **Active Context Blind Spots**: ${(data.blindSpots || []).filter((b) => !b.hasAcceptedDecision).length} files lacking ADR documentation
- **Audit Timestamp**: ${data.summaryTimestamp}`;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <section
        data-testid="calibration-scorecard-loading"
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
          padding: "1.5rem",
          boxShadow: "var(--shadow-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              height: "24px",
              width: "280px",
              backgroundColor: "var(--color-card-muted)",
              borderRadius: "4px",
            }}
          />
          <div
            style={{
              height: "20px",
              width: "120px",
              backgroundColor: "var(--color-card-muted)",
              borderRadius: "4px",
            }}
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1rem",
          }}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: "90px",
                backgroundColor: "var(--color-card-muted)",
                borderRadius: "8px",
              }}
            />
          ))}
        </div>
        <div
          style={{
            height: "40px",
            backgroundColor: "var(--color-card-muted)",
            borderRadius: "6px",
          }}
        />
      </section>
    );
  }

  if (error) {
    return (
      <section
        data-testid="calibration-scorecard-error"
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
          padding: "1.5rem",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div>
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "var(--color-error)",
                marginBottom: "0.25rem",
              }}
            >
              Telemetry Unavailable
            </h3>
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--color-text-secondary)",
                margin: 0,
              }}
            >
              {error}
            </p>
          </div>
          <button
            onClick={fetchScorecard}
            style={{
              padding: "0.45rem 0.9rem",
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              color: "var(--color-text)",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry Telemetry
          </button>
        </div>
      </section>
    );
  }

  if (!data || data.totalVerifications === 0) {
    return (
      <section
        data-testid="calibration-scorecard-empty"
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
          padding: "1.75rem",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.25rem" }}>🛡️</span>
            <h2
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                color: "var(--color-text)",
                margin: 0,
              }}
            >
              AI Hallucination & Calibration Scorecard
            </h2>
          </div>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "0.2rem 0.6rem",
              borderRadius: "12px",
              backgroundColor: "var(--color-card-muted)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            }}
          >
            Awaiting First Verification
          </span>
        </div>

        <div
          style={{
            border: "1px dashed var(--color-border)",
            borderRadius: "8px",
            padding: "2rem 1.5rem",
            textAlign: "center",
            backgroundColor: "var(--color-card-muted)",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📊</div>
          <h3
            style={{
              fontSize: "0.95rem",
              fontWeight: 700,
              color: "var(--color-text)",
              marginBottom: "0.4rem",
            }}
          >
            No Verification Sessions Recorded Yet
          </h3>
          <p
            style={{
              fontSize: "0.85rem",
              color: "var(--color-text-secondary)",
              maxWidth: "600px",
              margin: "0 auto 1.25rem",
              lineHeight: 1.5,
            }}
          >
            Verify AI-generated code explanations against repository history to
            calibrate model reliability, track hallucination rates, and identify
            unestablished engineering blind spots.
          </p>
          <Link
            href="/verify"
            style={{
              padding: "0.55rem 1.25rem",
              backgroundColor: "var(--color-primary)",
              color: "#FFFFFF",
              borderRadius: "6px",
              fontSize: "0.85rem",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span>🔍 Run First Verification</span>
          </Link>
        </div>
      </section>
    );
  }

  const {
    totalVerifications,
    totalClaims,
    effectiveTrustScore,
    aiGroundedRate,
    effectiveGroundedRate,
    groundedRate,
    abstentionRate,
    contradictedRate,
    verdictBreakdown,
    aiVerdictBreakdown,
    blindSpots = [],
    sessionTrend = [],
    calibrationQuadrants = {
      verifiedGrounded: 0,
      silentHallucinations: 0,
      caughtContradictions: 0,
      safeAbstentions: 0,
    },
    recentDisagreements = [],
  } = data;

  const activeTrustScore =
    isSimulating && simulationMetrics
      ? simulationMetrics.projectedScore
      : effectiveTrustScore;
  const activeGroundedRate =
    isSimulating && simulationMetrics
      ? simulationMetrics.projectedGroundedRate
      : (effectiveGroundedRate ?? groundedRate);
  const activeAbstentionRate =
    isSimulating && simulationMetrics
      ? simulationMetrics.projectedAbstentionRate
      : abstentionRate;

  // Compute grounded delta between human-adjudicated effective rate and raw AI preliminary rate
  const groundedDelta =
    Math.round((activeGroundedRate - aiGroundedRate) * 10) / 10;
  const rawContradictedCount = aiVerdictBreakdown?.contradicted?.count ?? 0;
  const effectiveContradictedCount = verdictBreakdown.contradicted.count;
  const contradictionDelta = effectiveContradictedCount - rawContradictedCount;

  const gradeInfo = getCalibrationGrade(activeTrustScore);

  // Sparkline coordinates from session trend
  const sparklineData = sessionTrend.map((item, idx) => {
    const x =
      sessionTrend.length <= 1
        ? 80
        : Math.round((idx / (sessionTrend.length - 1)) * 140 + 10);
    const y = Math.round(38 - (item.trustScore / 100) * 28);
    return { x, y, score: item.trustScore, label: item.label };
  });

  const sparklinePoints = sparklineData.map((p) => `${p.x},${p.y}`).join(" ");

  // Segments for effective horizontal stacked bar
  const segments = [
    {
      id: "supported",
      label: "Supported",
      count:
        isSimulating && simulationMetrics
          ? simulationMetrics.projectedSupported
          : verdictBreakdown.supported.count,
      pct: activeGroundedRate,
      aiCount: aiVerdictBreakdown?.supported?.count,
      color: "var(--color-success)",
      textColor: "#FFFFFF",
    },
    {
      id: "contradicted",
      label: "Contradicted",
      count: verdictBreakdown.contradicted.count,
      pct: verdictBreakdown.contradicted.percentage,
      aiCount: aiVerdictBreakdown?.contradicted?.count,
      color: "var(--color-error)",
      textColor: "#FFFFFF",
    },
    {
      id: "mixed",
      label: "Mixed",
      count: verdictBreakdown.mixed.count,
      pct: verdictBreakdown.mixed.percentage,
      aiCount: aiVerdictBreakdown?.mixed?.count,
      color: "var(--color-warning)",
      textColor: "#FFFFFF",
    },
    {
      id: "insufficientEvidence",
      label: "Insufficient Evidence",
      count:
        isSimulating && simulationMetrics
          ? simulationMetrics.projectedAbstained
          : verdictBreakdown.insufficientEvidence.count,
      pct: activeAbstentionRate,
      aiCount: aiVerdictBreakdown?.insufficientEvidence?.count,
      color: "var(--color-text-muted)",
      textColor: "#FFFFFF",
    },
  ];

  return (
    <section
      data-testid="calibration-scorecard"
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "10px",
        padding: "1.75rem",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      {/* Header with Title and Quick Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.3rem" }}>🛡️</span>
            <h2
              style={{
                fontSize: "1.2rem",
                fontWeight: 700,
                color: "var(--color-text)",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              AI Hallucination & Calibration Scorecard
            </h2>
          </div>
          <p
            style={{
              fontSize: "0.85rem",
              color: "var(--color-text-secondary)",
              margin: "0.25rem 0 0 0",
              lineHeight: 1.4,
            }}
          >
            Epistemological trust metrics measuring AI claim grounding, explicit
            abstentions, and human review override fidelity.
          </p>
        </div>

        {/* Action Controls: Simulate ADR Coverage & Copy Audit Snapshot */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          {/* Simulate ADR Coverage Toggle */}
          <button
            onClick={() => setIsSimulating(!isSimulating)}
            data-testid="simulate-adr-toggle"
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: "6px",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              transition: "all 0.15s ease",
              backgroundColor: isSimulating
                ? "var(--color-primary)"
                : "var(--color-card-muted)",
              color: isSimulating ? "#FFFFFF" : "var(--color-text)",
              border: "1px solid var(--color-border)",
            }}
          >
            <span>
              {isSimulating ? "🧪 Exit Simulation" : "🔮 Simulate ADR Coverage"}
            </span>
          </button>

          {/* Copy Audit Snapshot Button */}
          <button
            onClick={copyAuditSnapshot}
            data-testid="copy-audit-btn"
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: "6px",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              backgroundColor: "var(--color-surface)",
              color: copied ? "var(--color-success)" : "var(--color-text)",
              border: "1px solid var(--color-border)",
              transition: "all 0.15s ease",
            }}
          >
            <span>{copied ? "✓ Copied!" : "📋 Copy Audit Snapshot"}</span>
          </button>

          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              marginLeft: "0.25rem",
            }}
          >
            {totalClaims} claims evaluated
          </span>
        </div>
      </div>

      {/* Hero Trust Banner: Grade Badge + Score + Inline Trajectory Sparkline */}
      <div
        data-testid="kpi-trust-score"
        style={{
          padding: "1.25rem",
          backgroundColor: isSimulating
            ? "rgba(37, 99, 235, 0.05)"
            : "var(--color-card-muted)",
          border: isSimulating
            ? "1px solid var(--color-primary)"
            : "1px solid var(--color-border)",
          borderRadius: "8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1.25rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.25rem",
            flexWrap: "wrap",
          }}
        >
          {/* Dynamic Calibration Grade Badge */}
          <div
            data-testid="calibration-grade-badge"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: "60px",
              height: "60px",
              borderRadius: "10px",
              backgroundColor: "var(--color-surface)",
              border: `2px solid ${gradeInfo.color}`,
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <span
              style={{
                fontSize: "1.6rem",
                fontWeight: 900,
                color: gradeInfo.color,
                lineHeight: 1,
              }}
            >
              {gradeInfo.grade}
            </span>
            <span
              style={{
                fontSize: "0.6rem",
                fontWeight: 700,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
              }}
            >
              Grade
            </span>
          </div>

          <div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--color-text-secondary)",
                }}
              >
                Headline Calibration & Trust Score
              </span>
              {isSimulating && (
                <span
                  data-testid="simulated-preview-pill"
                  style={{
                    fontSize: "0.675rem",
                    fontWeight: 700,
                    padding: "0.15rem 0.45rem",
                    borderRadius: "4px",
                    backgroundColor: "var(--color-primary)",
                    color: "#FFFFFF",
                  }}
                >
                  Simulated Preview
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: "2.1rem",
                fontWeight: 800,
                color: gradeInfo.color,
                lineHeight: 1.1,
                display: "flex",
                alignItems: "baseline",
                gap: "0.5rem",
              }}
            >
              <span>{activeTrustScore}%</span>
              {isSimulating &&
                simulationMetrics &&
                simulationMetrics.lift > 0 && (
                  <span
                    style={{
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      color: "var(--color-success)",
                    }}
                  >
                    (+{simulationMetrics.lift}% projected lift)
                  </span>
                )}
            </div>

            <div
              style={{
                fontSize: "0.775rem",
                color: "var(--color-text-muted)",
                marginTop: "0.25rem",
              }}
            >
              Rewards verified grounded claims; actively penalizes incorrect
              solutions (<code>CONTRADICTED</code>) and human reviewer
              disagreements.
            </div>
          </div>
        </div>

        {/* Right Section: Inline SVG Trust Trajectory Sparkline + Mode Badge */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.5rem",
          }}
        >
          {sessionTrend.length > 0 && (
            <div
              data-testid="trust-trajectory-sparkline"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  fontSize: "0.675rem",
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  marginBottom: "0.2rem",
                }}
              >
                Trust Trajectory ({sessionTrend.length} runs)
              </div>
              <svg
                width="160"
                height="44"
                viewBox="0 0 160 44"
                style={{ overflow: "visible" }}
                aria-label="Trust Trajectory Sparkline"
              >
                <defs>
                  <linearGradient
                    id="sparklineGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--color-primary)"
                      stopOpacity="0.25"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-primary)"
                      stopOpacity="0.0"
                    />
                  </linearGradient>
                </defs>
                {sparklineData.length > 1 && (
                  <polygon
                    points={`10,40 ${sparklinePoints} ${sparklineData[sparklineData.length - 1].x},40`}
                    fill="url(#sparklineGrad)"
                  />
                )}
                <polyline
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={sparklinePoints}
                />
                {sparklineData.map((pt, i) => (
                  <circle
                    key={i}
                    cx={pt.x}
                    cy={pt.y}
                    r={i === sparklineData.length - 1 ? "3.5" : "2"}
                    fill={
                      i === sparklineData.length - 1
                        ? gradeInfo.color
                        : "var(--color-primary)"
                    }
                  >
                    <title>{`${pt.label}: ${pt.score}%`}</title>
                  </circle>
                ))}
              </svg>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "0.2rem 0.55rem",
                borderRadius: "6px",
                backgroundColor: "var(--color-primary-light)",
                color: "var(--color-primary)",
                border: "1px solid var(--color-border)",
              }}
            >
              ● Human-Supervised Calibration
            </span>
          </div>
        </div>
      </div>

      {/* 3 Executive KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "1rem",
        }}
      >
        {/* KPI 1: Total Verifications */}
        <div
          data-testid="kpi-total-verifications"
          style={{
            padding: "1rem",
            backgroundColor: "var(--color-card-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}
          >
            Total Verifications
          </div>
          <div style={{ margin: "0.5rem 0" }}>
            <div
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                color: "var(--color-text)",
                lineHeight: 1,
              }}
            >
              {totalVerifications}
            </div>
          </div>
          <div
            style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}
          >
            Across {totalClaims} decomposed claims
          </div>
        </div>

        {/* KPI 2: Effective Grounded Rate */}
        <div
          data-testid="kpi-grounded-rate"
          style={{
            padding: "1rem",
            backgroundColor: "var(--color-card-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              Effective Grounded Rate
            </span>
            <span
              style={{
                fontSize: "0.7rem",
                padding: "0.15rem 0.45rem",
                backgroundColor: "var(--color-success-light)",
                color: "var(--color-success)",
                fontWeight: 600,
                borderRadius: "4px",
              }}
            >
              SUPPORTED
            </span>
          </div>
          <div
            style={{
              margin: "0.5rem 0",
              display: "flex",
              alignItems: "baseline",
              gap: "0.5rem",
            }}
          >
            <div
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                color: "var(--color-success)",
                lineHeight: 1,
              }}
            >
              {activeGroundedRate}%
            </div>
            {groundedDelta !== 0 && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color:
                    groundedDelta > 0
                      ? "var(--color-success)"
                      : "var(--color-warning)",
                }}
              >
                {groundedDelta > 0 ? `+${groundedDelta}%` : `${groundedDelta}%`}{" "}
                vs AI
              </span>
            )}
          </div>
          <div
            style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}
          >
            {isSimulating && simulationMetrics
              ? `${simulationMetrics.projectedSupported} claims grounded (Simulated)`
              : `${verdictBreakdown.supported.count} claims proven (AI guess: ${aiGroundedRate}%)`}
          </div>
        </div>

        {/* KPI 3: Explicit Abstention Rate */}
        <div
          data-testid="kpi-abstention-rate"
          style={{
            padding: "1rem",
            backgroundColor: "var(--color-card-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              Abstention Rate
            </span>
            <span
              style={{
                fontSize: "0.7rem",
                padding: "0.15rem 0.45rem",
                backgroundColor: "var(--color-card-muted)",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
                borderRadius: "4px",
                border: "1px solid var(--color-border)",
              }}
            >
              ABSTAINED
            </span>
          </div>
          <div
            style={{
              margin: "0.5rem 0",
              display: "flex",
              alignItems: "baseline",
              gap: "0.5rem",
            }}
          >
            <div
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                color: "var(--color-text)",
                lineHeight: 1,
              }}
            >
              {activeAbstentionRate}%
            </div>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color:
                  contradictedRate > 0
                    ? "var(--color-error)"
                    : "var(--color-text-muted)",
              }}
            >
              {contradictedRate}% Contradicted
            </span>
          </div>
          <div
            style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}
          >
            {isSimulating && simulationMetrics
              ? `${simulationMetrics.projectedAbstained} abstentions (Simulated)`
              : `${verdictBreakdown.insufficientEvidence.count} abstentions, ${effectiveContradictedCount} contradicted`}
            {contradictionDelta > 0 &&
              ` (+${contradictionDelta} by human review)`}
          </div>
        </div>
      </div>

      {/* AI Verdict Breakdown Visual: Segmented Stacked Bar with Delta Comparison */}
      <div
        data-testid="verdict-breakdown-visual"
        style={{
          padding: "1.25rem",
          backgroundColor: "var(--color-card-muted)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <span
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--color-text)",
            }}
          >
            Effective Verdict Distribution (Human-Supervised)
          </span>
          <span
            style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}
          >
            Human reviewer dispositions actively override AI preliminary
            assessments
          </span>
        </div>

        {/* Primary Horizontal Stacked Bar (Effective Verdicts) */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "24px",
            borderRadius: "6px",
            overflow: "hidden",
            backgroundColor: "var(--color-border)",
          }}
          role="progressbar"
          aria-label="Effective Verdict Breakdown"
        >
          {segments.map((s) => {
            if (s.pct <= 0) return null;
            return (
              <div
                key={s.id}
                title={`${s.label}: ${s.count} (${s.pct}%)`}
                style={{
                  width: `${s.pct}%`,
                  backgroundColor: s.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: s.textColor,
                  transition: "width 0.3s ease",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  padding: "0 4px",
                }}
              >
                {s.pct >= 10 ? `${s.pct}%` : ""}
              </div>
            );
          })}
        </div>

        {/* Comparison Context with AI Preliminary Guess */}
        {aiVerdictBreakdown && (
          <div
            style={{
              marginTop: "0.6rem",
              fontSize: "0.75rem",
              color: "var(--color-text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
              AI Preliminary Guess:
            </span>
            <span>
              {aiGroundedRate}% Supported ({aiVerdictBreakdown.supported.count})
            </span>
            <span>•</span>
            <span>
              {aiVerdictBreakdown.contradicted.percentage}% Contradicted (
              {aiVerdictBreakdown.contradicted.count})
            </span>
            <span>•</span>
            <span>
              {aiVerdictBreakdown.insufficientEvidence.percentage}% Insufficient
              ({aiVerdictBreakdown.insufficientEvidence.count})
            </span>
          </div>
        )}

        {/* Legend Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "0.75rem",
            marginTop: "1rem",
          }}
        >
          {segments.map((s) => {
            const deltaCount =
              s.aiCount !== undefined ? s.count - s.aiCount : 0;
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.8rem",
                }}
              >
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: s.color,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "var(--color-text-secondary)" }}>
                  {s.label}:
                </span>
                <strong
                  style={{ color: "var(--color-text)", marginLeft: "auto" }}
                >
                  {s.count} ({s.pct}%)
                  {deltaCount !== 0 && (
                    <span
                      style={{
                        marginLeft: "0.3rem",
                        fontSize: "0.725rem",
                        fontWeight: 600,
                        color:
                          deltaCount > 0
                            ? "var(--color-primary)"
                            : "var(--color-text-muted)",
                      }}
                    >
                      ({deltaCount > 0 ? `+${deltaCount}` : `${deltaCount}`} vs
                      AI)
                    </span>
                  )}
                </strong>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4-Quadrant Honesty Matrix */}
      <div
        data-testid="honesty-quadrants-matrix"
        style={{
          padding: "1.25rem",
          backgroundColor: "var(--color-card-muted)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              <span style={{ fontSize: "1rem" }}>🧭</span>
              <h3
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  color: "var(--color-text)",
                  margin: 0,
                }}
              >
                4-Quadrant Honesty Matrix
              </h3>
            </div>
            <p
              style={{
                fontSize: "0.775rem",
                color: "var(--color-text-secondary)",
                margin: "0.2rem 0 0 0",
              }}
            >
              Audits AI epistemic confidence against ground-truth human
              adjudication.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {/* Q1: Verified Grounded */}
          <div
            style={{
              padding: "0.85rem",
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderLeft: "4px solid var(--color-success)",
              borderRadius: "6px",
            }}
          >
            <div
              style={{
                fontSize: "0.725rem",
                fontWeight: 700,
                color: "var(--color-success)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              Verified Grounded
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--color-text)",
                margin: "0.2rem 0",
              }}
            >
              {calibrationQuadrants.verifiedGrounded}
            </div>
            <div
              style={{ fontSize: "0.725rem", color: "var(--color-text-muted)" }}
            >
              Proven by code and Git provenance
            </div>
          </div>

          {/* Q2: Silent Hallucinations */}
          <div
            style={{
              padding: "0.85rem",
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderLeft: "4px solid var(--color-error)",
              borderRadius: "6px",
            }}
          >
            <div
              style={{
                fontSize: "0.725rem",
                fontWeight: 700,
                color: "var(--color-error)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              Silent Hallucinations
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--color-error)",
                margin: "0.2rem 0",
              }}
            >
              {calibrationQuadrants.silentHallucinations}
            </div>
            <div
              style={{ fontSize: "0.725rem", color: "var(--color-text-muted)" }}
            >
              High-confidence AI claim caught false by human review
            </div>
          </div>

          {/* Q3: Caught Contradictions */}
          <div
            style={{
              padding: "0.85rem",
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderLeft: "4px solid var(--color-warning)",
              borderRadius: "6px",
            }}
          >
            <div
              style={{
                fontSize: "0.725rem",
                fontWeight: 700,
                color: "var(--color-warning)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              Caught Contradictions
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--color-text)",
                margin: "0.2rem 0",
              }}
            >
              {calibrationQuadrants.caughtContradictions}
            </div>
            <div
              style={{ fontSize: "0.725rem", color: "var(--color-text-muted)" }}
            >
              Model correctly identified or flagged false claim
            </div>
          </div>

          {/* Q4: Safe Abstentions */}
          <div
            style={{
              padding: "0.85rem",
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderLeft: "4px solid var(--color-text-muted)",
              borderRadius: "6px",
            }}
          >
            <div
              style={{
                fontSize: "0.725rem",
                fontWeight: 700,
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              Safe Abstentions
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--color-text)",
                margin: "0.2rem 0",
              }}
            >
              {calibrationQuadrants.safeAbstentions}
            </div>
            <div
              style={{ fontSize: "0.725rem", color: "var(--color-text-muted)" }}
            >
              Model explicitly demurred due to missing context
            </div>
          </div>
        </div>

        {/* Compact Recent Disagreements & Contradictions Feed */}
        <div
          style={{
            marginTop: "1rem",
            borderTop: "1px solid var(--color-border)",
            paddingTop: "0.85rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              color: "var(--color-text-secondary)",
              marginBottom: "0.5rem",
            }}
          >
            Recent Human Review Disagreements & Contradictions
          </div>

          {recentDisagreements.length === 0 ? (
            <div
              data-testid="no-disagreements-message"
              style={{
                fontSize: "0.775rem",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
                padding: "0.5rem 0",
              }}
            >
              No human overrides or contradicted claims recorded yet.
            </div>
          ) : (
            <div
              data-testid="recent-disagreements-feed"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              {recentDisagreements.map((item) => (
                <div
                  key={item.claimId}
                  style={{
                    padding: "0.5rem 0.75rem",
                    backgroundColor: "var(--color-surface)",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    fontSize: "0.775rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.15rem",
                      maxWidth: "70%",
                    }}
                  >
                    <span
                      style={{ color: "var(--color-text)", fontWeight: 500 }}
                    >
                      &ldquo;{item.claimText}&rdquo;
                    </span>
                    <code
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {item.filePath}
                    </code>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    <span
                      style={{
                        padding: "0.15rem 0.4rem",
                        borderRadius: "4px",
                        fontSize: "0.675rem",
                        fontWeight: 600,
                        backgroundColor: "var(--color-card-muted)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      AI: {item.machineVerdict}
                    </span>
                    <span>→</span>
                    <span
                      style={{
                        padding: "0.15rem 0.4rem",
                        borderRadius: "4px",
                        fontSize: "0.675rem",
                        fontWeight: 700,
                        backgroundColor:
                          item.humanVerdict === "CONTRADICTED"
                            ? "var(--color-error-light, rgba(220, 38, 38, 0.1))"
                            : "var(--color-primary-light)",
                        color:
                          item.humanVerdict === "CONTRADICTED"
                            ? "var(--color-error)"
                            : "var(--color-primary)",
                      }}
                    >
                      Human: {item.humanVerdict}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upgraded Context Blind-Spot Radar */}
      <div
        data-testid="context-blind-spot-map"
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1rem 1.25rem",
            backgroundColor: "var(--color-card-muted)",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              <span style={{ fontSize: "1rem" }}>🗺️</span>
              <h3
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  color: "var(--color-text)",
                  margin: 0,
                }}
              >
                Context Blind-Spot Radar
              </h3>
            </div>
            <p
              style={{
                fontSize: "0.775rem",
                color: "var(--color-text-secondary)",
                margin: "0.2rem 0 0 0",
              }}
            >
              Frequently queried and high-churn file paths that repeatedly
              trigger <code>INSUFFICIENT_EVIDENCE</code> or human-contradicted
              claims lacking documented Engineering Decisions.
            </p>
          </div>

          <Link
            href="/decisions"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-primary)",
            }}
          >
            Open Decision Memory →
          </Link>
        </div>

        {blindSpots.length === 0 ? (
          <div
            style={{
              padding: "1.75rem",
              textAlign: "center",
              color: "var(--color-text-secondary)",
              fontSize: "0.85rem",
            }}
          >
            No blind-spots detected. Verified files have sufficient git
            provenance and documented engineering decisions.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.8rem",
                textAlign: "left",
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: "var(--color-card-muted)",
                    borderBottom: "1px solid var(--color-border)",
                    color: "var(--color-text-muted)",
                    fontSize: "0.725rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  <th style={{ padding: "0.6rem 1rem", width: "50px" }}>
                    Rank
                  </th>
                  <th style={{ padding: "0.6rem 1rem" }}>Target File Path</th>
                  <th style={{ padding: "0.6rem 1rem" }}>Severity & Risk</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "center" }}>
                    Abstentions & Flags
                  </th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "center" }}>
                    Commit Churn
                  </th>
                  <th style={{ padding: "0.6rem 1rem" }}>Decision Status</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {blindSpots.map((spot, idx) => {
                  const severity = getSpotSeverity(spot);
                  const riskWidth = Math.min(
                    100,
                    Math.max(
                      15,
                      spot.commitChurnCount * 6 +
                        spot.insufficientEvidenceCount * 12,
                    ),
                  );

                  return (
                    <tr
                      key={spot.filePath}
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        transition: "background-color 0.15s ease",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          color: "var(--color-text-muted)",
                          fontWeight: 600,
                        }}
                      >
                        #{idx + 1}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <code
                          style={{
                            fontSize: "0.775rem",
                            fontFamily: "monospace",
                            color: "var(--color-text)",
                            backgroundColor: "var(--color-card-muted)",
                            padding: "0.15rem 0.35rem",
                            borderRadius: "4px",
                            border: "1px solid var(--color-border)",
                          }}
                        >
                          {spot.filePath}
                        </code>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "var(--color-text-muted)",
                            marginTop: "0.2rem",
                          }}
                        >
                          {spot.repositoryName || "Repository"}
                        </div>
                      </td>
                      <td
                        style={{ padding: "0.75rem 1rem", minWidth: "140px" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            marginBottom: "0.25rem",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.65rem",
                              fontWeight: 700,
                              padding: "0.1rem 0.4rem",
                              borderRadius: "4px",
                              backgroundColor: severity.bg,
                              color: severity.color,
                            }}
                          >
                            {severity.label}
                          </span>
                        </div>
                        {/* Visual Risk Bar */}
                        <div
                          style={{
                            height: "4px",
                            width: "100%",
                            maxWidth: "110px",
                            backgroundColor: "var(--color-border)",
                            borderRadius: "2px",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${riskWidth}%`,
                              backgroundColor: severity.color,
                              borderRadius: "2px",
                            }}
                          />
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            color:
                              spot.insufficientEvidenceCount > 0
                                ? "var(--color-warning)"
                                : "var(--color-text-muted)",
                          }}
                        >
                          {spot.insufficientEvidenceCount}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "0.75rem 1rem",
                          textAlign: "center",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {spot.commitChurnCount > 0
                          ? `${spot.commitChurnCount} commits`
                          : "—"}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {spot.hasAcceptedDecision ? (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              padding: "0.15rem 0.5rem",
                              borderRadius: "10px",
                              backgroundColor: "var(--color-success-light)",
                              color: "var(--color-success)",
                              fontWeight: 600,
                            }}
                          >
                            ✓ Decision Accepted ({spot.decisionsCount})
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              padding: "0.15rem 0.5rem",
                              borderRadius: "10px",
                              backgroundColor: "var(--color-warning-light)",
                              color: "var(--color-warning)",
                              fontWeight: 600,
                            }}
                          >
                            ⚠️ Missing Decision
                          </span>
                        )}
                      </td>
                      <td
                        style={{ padding: "0.75rem 1rem", textAlign: "right" }}
                      >
                        {spot.suggestedAction === "DOCUMENT_DECISION" ? (
                          <Link
                            href={`/decisions?repoId=${spot.repositoryId}&targetFilePath=${encodeURIComponent(spot.filePath)}`}
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: "var(--color-primary)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.2rem",
                            }}
                          >
                            Document Fix →
                          </Link>
                        ) : (
                          <Link
                            href={`/verify?repoId=${spot.repositoryId}&targetFilePath=${encodeURIComponent(spot.filePath)}`}
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: "var(--color-text-secondary)",
                            }}
                          >
                            Verify Again →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function getCalibrationGrade(score: number): {
  grade: "A" | "B" | "C" | "D" | "F";
  label: string;
  color: string;
} {
  if (score >= 90) {
    return {
      grade: "A",
      label: "Optimal Grounding",
      color: "var(--color-success)",
    };
  }
  if (score >= 80) {
    return {
      grade: "B",
      label: "High Grounding",
      color: "var(--color-primary)",
    };
  }
  if (score >= 70) {
    return {
      grade: "C",
      label: "Calibrated (Minor Drift)",
      color: "var(--color-warning)",
    };
  }
  if (score >= 60) {
    return { grade: "D", label: "Degraded Grounding", color: "#EA580C" };
  }
  return {
    grade: "F",
    label: "Severe Hallucination Risk",
    color: "var(--color-error)",
  };
}

function getSpotSeverity(spot: ContextBlindSpotItem): {
  label: "CRITICAL" | "HIGH" | "MODERATE";
  color: string;
  bg: string;
} {
  if (spot.hasAcceptedDecision) {
    return {
      label: "MODERATE",
      color: "var(--color-success)",
      bg: "rgba(22, 163, 74, 0.1)",
    };
  }
  if (spot.commitChurnCount >= 10 || spot.insufficientEvidenceCount >= 4) {
    return {
      label: "CRITICAL",
      color: "var(--color-error)",
      bg: "rgba(220, 38, 38, 0.1)",
    };
  }
  return {
    label: "HIGH",
    color: "var(--color-warning)",
    bg: "rgba(217, 119, 6, 0.1)",
  };
}
