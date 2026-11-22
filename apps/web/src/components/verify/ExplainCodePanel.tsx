"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  codeExplainerApi,
  ExplainCodeTargetItem,
  ExplainCodeResponse,
  CodeExplainerApiError,
} from "../../lib/code-explainer-api";
import styles from "./explain-code.module.css";

export interface ExplainCodePanelProps {
  workspaceId: string;
  repositoryId: string;
  repositories?: Array<{
    id: string;
    fullName: string;
    name?: string;
    workspaceId?: string;
  }>;
  onSelectRepository?: (repoId: string) => void;
  onSessionGenerated: (session: any) => void;
}

export function ExplainCodePanel({
  workspaceId,
  repositoryId,
  repositories = [],
  onSelectRepository,
  onSessionGenerated,
}: ExplainCodePanelProps) {
  // Input states
  const [filePath, setFilePath] = useState("");
  const [symbol, setSymbol] = useState("");
  const [question, setQuestion] = useState("");
  const [codeSnippet, setCodeSnippet] = useState("");

  // Targets from backend
  const [targets, setTargets] = useState<ExplainCodeTargetItem[]>([]);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);

  // Execution states
  const [isExplaining, setIsExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExplainCodeResponse | null>(
    null,
  );

  const effectiveWorkspaceId =
    repositories.find((r) => r.id === repositoryId)?.workspaceId ||
    workspaceId ||
    "ws_alpha";

  // Load indexed target file paths when repositoryId changes
  const loadTargets = useCallback(async () => {
    if (!effectiveWorkspaceId || !repositoryId) {
      setTargets([]);
      return;
    }
    setIsLoadingTargets(true);
    try {
      const res: any = await codeExplainerApi.getTargets(
        effectiveWorkspaceId,
        repositoryId,
      );
      const list = res?.targets || res?.data?.targets || [];
      setTargets(Array.isArray(list) ? list : []);
      // If user hasn't typed a path and we have targets, default empty or keep user's input
    } catch (err) {
      // Targets failing shouldn't block typing manual paths
      console.warn("Could not load targets for repository:", err);
      setTargets([]);
    } finally {
      setIsLoadingTargets(false);
    }
  }, [effectiveWorkspaceId, repositoryId]);

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repositoryId) {
      setError("Please select a target repository first.");
      return;
    }

    if (
      !filePath.trim() &&
      !symbol.trim() &&
      !question.trim() &&
      !codeSnippet.trim()
    ) {
      setError(
        "Please provide at least a Target File Path, Symbol, or Question.",
      );
      return;
    }

    setError(null);
    setIsExplaining(true);

    try {
      const response = await codeExplainerApi.explainCode(
        effectiveWorkspaceId,
        repositoryId,
        {
          filePath: filePath.trim() || undefined,
          symbol: symbol.trim() || undefined,
          question: question.trim() || undefined,
          codeSnippet: codeSnippet.trim() || undefined,
        },
      );

      setLastResult(response);

      if (response.verificationSession) {
        onSessionGenerated(response.verificationSession);
      }
    } catch (err) {
      const rawMessage =
        err instanceof CodeExplainerApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "An unexpected error occurred while generating the explanation.";
      const message =
        typeof rawMessage === "string"
          ? rawMessage
          : JSON.stringify(rawMessage);
      setError(message);
    } finally {
      setIsExplaining(false);
    }
  };

  const topChips = targets.slice(0, 5);

  return (
    <div className={styles.panelContainer} data-testid="explain-code-panel">
      {/* Informative Intro Banner */}
      <div className={styles.introBanner}>
        <span className={styles.introIcon} aria-hidden="true">
          💡
        </span>
        <div className={styles.introContent}>
          <div className={styles.introTitle}>
            Native Rationale Generator — Evidence-First Engineering Rationale
          </div>
          <div className={styles.introDesc}>
            Generate an evidence-grounded explanation directly from indexed Git
            commits, PR discussions, and architectural decisions. Every atomic
            claim is automatically verified and checked for historical
            abstention.
          </div>
        </div>
      </div>

      {/* Target & Query Form */}
      <div className={styles.formCard}>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {/* Target Repository (if switcher provided) */}
          {repositories.length > 0 && onSelectRepository && (
            <div className={styles.fieldGroup}>
              <label
                htmlFor="explain-repo-select"
                className={styles.fieldLabel}
              >
                Target Repository
              </label>
              <select
                id="explain-repo-select"
                className={styles.selectInput}
                value={repositoryId}
                onChange={(e) => onSelectRepository(e.target.value)}
                disabled={isExplaining}
              >
                <option value="">Select a repository...</option>
                {repositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.fullName || repo.name || repo.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Target File Path & Quick-Pick Chips */}
          <div className={styles.fieldGroup}>
            <label htmlFor="explain-file-path" className={styles.fieldLabel}>
              <span>Target File Path</span>
              {isLoadingTargets && (
                <span className={styles.fieldHint}>
                  Loading indexed paths...
                </span>
              )}
            </label>
            <input
              id="explain-file-path"
              type="text"
              className={styles.textInput}
              placeholder="e.g. apps/web/src/components/Table.tsx"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              disabled={isExplaining}
              list="indexed-targets-list"
            />
            {targets.length > 0 && (
              <datalist id="indexed-targets-list">
                {targets.map((t) => (
                  <option key={t.filePath} value={t.filePath}>
                    {t.filePath} ({t.activityCount} events)
                  </option>
                ))}
              </datalist>
            )}

            {/* Quick Pick Chips */}
            {topChips.length > 0 && (
              <div className={styles.quickPicksRow}>
                <span className={styles.quickPicksLabel}>Quick Pick:</span>
                {topChips.map((chip) => (
                  <button
                    key={chip.filePath}
                    type="button"
                    className={`${styles.chipButton} ${
                      filePath === chip.filePath ? styles.chipButtonActive : ""
                    }`}
                    onClick={() => setFilePath(chip.filePath)}
                    disabled={isExplaining}
                    title={`${chip.activityCount} historical events`}
                  >
                    {chip.filePath.split("/").pop()}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Symbol & Question Row */}
          <div className={styles.rowTwoColumns}>
            <div className={styles.fieldGroup}>
              <label htmlFor="explain-symbol" className={styles.fieldLabel}>
                Symbol or Function Name{" "}
                <span className={styles.fieldHint}>(Optional)</span>
              </label>
              <input
                id="explain-symbol"
                type="text"
                className={styles.textInput}
                placeholder="e.g. verifyToken or MemoizedRow"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                disabled={isExplaining}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="explain-question" className={styles.fieldLabel}>
                Specific Technical Question{" "}
                <span className={styles.fieldHint}>(Optional)</span>
              </label>
              <input
                id="explain-question"
                type="text"
                className={styles.textInput}
                placeholder="e.g. Why does this memoize when row count > 500?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={isExplaining}
              />
            </div>
          </div>

          {/* Optional Code Snippet */}
          <div className={styles.fieldGroup}>
            <label htmlFor="explain-code-snippet" className={styles.fieldLabel}>
              Relevant Code Snippet{" "}
              <span className={styles.fieldHint}>(Optional)</span>
            </label>
            <textarea
              id="explain-code-snippet"
              rows={3}
              className={styles.textareaInput}
              placeholder="Paste relevant code lines to anchor the explanation..."
              value={codeSnippet}
              onChange={(e) => setCodeSnippet(e.target.value)}
              disabled={isExplaining}
            />
          </div>

          {error && <div className={styles.errorBanner}>{error}</div>}

          {/* Submit Action */}
          <div className={styles.buttonRow}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={isExplaining || !repositoryId}
              id="explain-and-verify-button"
            >
              {isExplaining ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  Analyzing Repository History...
                </>
              ) : (
                <>
                  <span aria-hidden="true">🔍</span> Explain &amp; Verify from
                  History
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Generated Result Presentation */}
      {lastResult && (
        <div className={styles.resultCard} data-testid="explain-result-card">
          <div className={styles.resultHeader}>
            <div className={styles.resultTitleRow}>
              <span className={styles.resultTitle}>
                Section 1: Engineering Rationale (&ldquo;Why This Code
                Exists&rdquo;)
              </span>
              <span
                className={`${styles.modePill} ${
                  lastResult.synthesisMode === "ai_grounded"
                    ? styles.modePillAi
                    : lastResult.synthesisMode === "abstained"
                      ? styles.modePillAbstained
                      : styles.modePillDeterministic
                }`}
              >
                {lastResult.synthesisMode === "ai_grounded"
                  ? "🤖 AI Grounded in Repo History"
                  : lastResult.synthesisMode === "abstained"
                    ? "⚠️ Abstained — Insufficient History"
                    : "⚡ Deterministic Evidence Synthesis"}
              </span>
            </div>

            <div className={styles.sourceBadgesRow}>
              <span className={styles.sourceBadge}>
                {lastResult.evidenceSummary.commits} Commits
              </span>
              <span className={styles.sourceBadge}>
                {lastResult.evidenceSummary.pullRequests} PRs
              </span>
              <span className={styles.sourceBadge}>
                {lastResult.evidenceSummary.issues} Issues
              </span>
              <span className={styles.sourceBadge}>
                {lastResult.evidenceSummary.decisions} Decisions
              </span>
            </div>
          </div>

          {/* Insufficient Evidence Explicit Abstention Banner */}
          {lastResult.insufficientHistory ? (
            <div className={styles.abstentionBanner}>
              <div className={styles.abstentionHeader}>
                <span aria-hidden="true">🛡️</span> Insufficient Historical
                Evidence — Refused to Guess
              </div>
              <div className={styles.abstentionBody}>
                {lastResult.abstentionReason || lastResult.generatedExplanation}
              </div>
              <div className={styles.abstentionActions}>
                <Link href="/repositories" className={styles.abstentionLink}>
                  Sync Repository History &rarr;
                </Link>
                <Link href="/decisions" className={styles.abstentionLink}>
                  Record Engineering Decision &rarr;
                </Link>
              </div>
            </div>
          ) : lastResult.explanationBreakdown ? (
            <div
              className={styles.breakdownContainer}
              data-testid="explanation-breakdown"
            >
              {/* Highlighted plain-English Summary callout box */}
              <div className={styles.summaryCallout}>
                <div className={styles.summaryCalloutHeader}>
                  <span>💡</span> Plain-English Summary
                </div>
                <div className={styles.summaryCalloutText}>
                  {lastResult.explanationBreakdown.summary}
                </div>
              </div>

              {/* Two Column Grid: Origin & Problem Solved + Technical Approach */}
              <div className={styles.breakdownGrid}>
                <div className={styles.breakdownBlock}>
                  <div className={styles.breakdownBlockTitle}>
                    <span>🎯</span> Origin &amp; Problem Solved
                  </div>
                  <div className={styles.breakdownBlockBody}>
                    {lastResult.explanationBreakdown.whyItWasBuilt}
                  </div>
                </div>

                <div className={styles.breakdownBlock}>
                  <div className={styles.breakdownBlockTitle}>
                    <span>🛠️</span> Technical Approach
                  </div>
                  <div className={styles.breakdownBlockBody}>
                    {lastResult.explanationBreakdown.howItWasImplemented}
                  </div>
                </div>
              </div>

              {/* Code Mechanics (if snippet was analyzed) */}
              {lastResult.explanationBreakdown.whatCodeDoes && (
                <div className={styles.codeMechanicsBlock}>
                  <div className={styles.codeMechanicsHeader}>
                    <div className={styles.codeMechanicsTitle}>
                      <span>🔍</span> Code Mechanics
                    </div>
                    <span className={styles.codeMechanicsBadge}>
                      From Code Snippet — Not Historical Proof
                    </span>
                  </div>
                  <div className={styles.breakdownBlockBody}>
                    {lastResult.explanationBreakdown.whatCodeDoes}
                  </div>
                </div>
              )}

              {/* Constraints & Invariants */}
              {lastResult.explanationBreakdown.governingConstraints &&
                lastResult.explanationBreakdown.governingConstraints.length >
                  0 && (
                  <div className={styles.constraintsBlock}>
                    <div className={styles.constraintsTitle}>
                      <span>🔒</span> Governing Constraints &amp; Invariants
                    </div>
                    <ul className={styles.constraintsList}>
                      {lastResult.explanationBreakdown.governingConstraints.map(
                        (constraint, idx) => (
                          <li key={idx} className={styles.constraintItem}>
                            {constraint}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}

              {/* Caution Before Editing */}
              {lastResult.explanationBreakdown.cautionBeforeEditing && (
                <div className={styles.cautionBlock}>
                  <div className={styles.cautionTitle}>
                    <span>⚠️</span> Caution Before Editing
                  </div>
                  <div className={styles.cautionBody}>
                    {lastResult.explanationBreakdown.cautionBeforeEditing}
                  </div>
                </div>
              )}

              {/* Evolution Summary */}
              {lastResult.explanationBreakdown.evolutionSummary && (
                <div className={styles.evolutionBlock}>
                  <div className={styles.evolutionTitle}>
                    <span>📜</span> How It Evolved
                  </div>
                  <div className={styles.breakdownBlockBody}>
                    {lastResult.explanationBreakdown.evolutionSummary}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.explanationText}>
              {lastResult.generatedExplanation}
            </div>
          )}

          {/* Section 2 Divider & Header */}
          {!lastResult.insufficientHistory && (
            <div
              className={styles.sectionTwoDivider}
              data-testid="section-2-divider"
            >
              <div className={styles.sectionTwoHeaderRow}>
                <div className={styles.sectionTwoTitle}>
                  <span>🛡️</span> Section 2: Verified Claims &amp; Supporting
                  Proof (Immutable Audit Trail)
                </div>
                {lastResult.verificationSession?.claimsCount ? (
                  <span className={styles.sectionTwoBadge}>
                    {lastResult.verificationSession.claimsCount} Claims
                    Extracted &amp; Verified
                  </span>
                ) : null}
              </div>
              <p className={styles.sectionTwoDescription}>
                Every atomic claim below was decomposed from the engineering
                rationale above and cross-checked against immutable repository
                artifacts (Git commits, PR reviews, issues, and recorded
                decisions).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
