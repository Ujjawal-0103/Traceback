import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CalibrationQuadrants,
  CalibrationRecentDisagreementItem,
  CalibrationScorecardDto,
  CalibrationSessionTrendItem,
  ContextBlindSpotItem,
  HumanOverrideBreakdown,
  VerdictBreakdown,
  VerdictBreakdownItem,
} from "@traceback/shared-types";
import { fromPrismaConfidence } from "../verification/verification.types";
import { AIAssessmentConfidence, HumanVerdict } from "@prisma/client";

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computes AI Hallucination & Calibration Scorecard with Context Blind-Spot Map
   * for a given workspace.
   * Reflects human reviewer dispositions (agreements and overrides) dynamically in
   * the effective verdict distribution and headline trust score.
   * Scoped strictly to multi-tenant workspaceId boundary.
   */
  async getCalibrationScorecard(
    workspaceId: string,
  ): Promise<CalibrationScorecardDto> {
    const timestamp = new Date().toISOString();

    // 1. Fetch all verification sessions in this workspace with claims, repositories, and evidence
    const sessions = await this.prisma.verificationSession.findMany({
      where: { workspaceId },
      include: {
        repository: {
          select: {
            id: true,
            fullName: true,
          },
        },
        claims: {
          select: {
            id: true,
            text: true,
            preliminaryConfidence: true,
            humanVerdict: true,
            evidence: {
              select: {
                filePath: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalVerifications = sessions.length;

    const emptyBreakdown: VerdictBreakdown = {
      supported: { count: 0, percentage: 0 },
      contradicted: { count: 0, percentage: 0 },
      mixed: { count: 0, percentage: 0 },
      insufficientEvidence: { count: 0, percentage: 0 },
    };

    const emptyQuadrants: CalibrationQuadrants = {
      verifiedGrounded: 0,
      silentHallucinations: 0,
      caughtContradictions: 0,
      safeAbstentions: 0,
    };

    // Zero-data early return if workspace has no verification sessions
    if (totalVerifications === 0) {
      return {
        workspaceId,
        totalVerifications: 0,
        totalClaims: 0,
        effectiveTrustScore: 0,
        aiGroundedRate: 0,
        effectiveGroundedRate: 0,
        groundedRate: 0,
        abstentionRate: 0,
        contradictedRate: 0,
        mixedRate: 0,
        overrideRate: null,
        verdictBreakdown: emptyBreakdown,
        effectiveVerdictBreakdown: emptyBreakdown,
        aiVerdictBreakdown: emptyBreakdown,
        humanOverride: {
          totalReviewed: 0,
          agreedCount: 0,
          overrideCount: 0,
          overrideRate: null,
          hasHumanReviews: false,
        },
        blindSpots: [],
        sessionTrend: [],
        calibrationQuadrants: emptyQuadrants,
        recentDisagreements: [],
        summaryTimestamp: timestamp,
      };
    }

    // 2. Aggregate Raw AI Verdicts and Human-Supervised Effective Verdicts
    let rawSupportedCount = 0;
    let rawContradictedCount = 0;
    let rawMixedCount = 0;
    let rawInsufficientCount = 0;

    let effSupportedCount = 0;
    let effContradictedCount = 0;
    let effMixedCount = 0;
    let effInsufficientCount = 0;

    let totalReviewed = 0;
    let agreedCount = 0;
    let overrideCount = 0;
    let aiSupportedOverriddenToContradictedCount = 0;

    let quadrantVerifiedGrounded = 0;
    let quadrantSilentHallucinations = 0;
    let quadrantCaughtContradictions = 0;
    let quadrantSafeAbstentions = 0;

    const recentDisagreements: CalibrationRecentDisagreementItem[] = [];

    // Track file metrics for Context Blind-Spot map
    const fileMetricsMap = new Map<
      string,
      {
        repositoryId: string;
        repositoryName: string;
        insufficientEvidenceCount: number;
        contradictedCount: number;
        totalQueries: number;
        lastQueriedAt: Date;
      }
    >();

    const recordFileStat = (
      filePath: string | null | undefined,
      repoId: string,
      repoName: string,
      isInsufficientOrContradicted: boolean,
      isContradicted: boolean,
      queriedAt: Date,
    ) => {
      if (!filePath) return;
      const cleanPath = filePath.replace(/\\/g, "/").trim();
      if (!cleanPath) return;

      const existing = fileMetricsMap.get(cleanPath);
      if (existing) {
        existing.totalQueries += 1;
        if (isInsufficientOrContradicted) {
          existing.insufficientEvidenceCount += 1;
        }
        if (isContradicted) {
          existing.contradictedCount += 1;
        }
        if (queriedAt > existing.lastQueriedAt) {
          existing.lastQueriedAt = queriedAt;
        }
      } else {
        fileMetricsMap.set(cleanPath, {
          repositoryId: repoId,
          repositoryName: repoName,
          insufficientEvidenceCount: isInsufficientOrContradicted ? 1 : 0,
          contradictedCount: isContradicted ? 1 : 0,
          totalQueries: 1,
          lastQueriedAt: queriedAt,
        });
      }
    };

    for (const session of sessions) {
      const repoId = session.repository.id;
      const repoName = session.repository.fullName;
      const sessionDate = session.createdAt;

      for (const claim of session.claims) {
        // Raw AI status
        const rawAiStatus = fromPrismaConfidence(claim.preliminaryConfidence);
        switch (rawAiStatus) {
          case "SUPPORTED":
            rawSupportedCount++;
            break;
          case "CONTRADICTED":
            rawContradictedCount++;
            break;
          case "MIXED":
            rawMixedCount++;
            break;
          case "INSUFFICIENT_EVIDENCE":
          default:
            rawInsufficientCount++;
            break;
        }

        // Effective Status (Human disposition overrides AI preliminary assessment)
        let effectiveStatus:
          "SUPPORTED" | "CONTRADICTED" | "MIXED" | "INSUFFICIENT_EVIDENCE";
        if (claim.humanVerdict === HumanVerdict.SUPPORTED) {
          effectiveStatus = "SUPPORTED";
        } else if (claim.humanVerdict === HumanVerdict.CONTRADICTED) {
          effectiveStatus = "CONTRADICTED";
        } else if (claim.humanVerdict === HumanVerdict.UNVERIFIED) {
          effectiveStatus = "INSUFFICIENT_EVIDENCE";
        } else {
          effectiveStatus = rawAiStatus;
        }

        switch (effectiveStatus) {
          case "SUPPORTED":
            effSupportedCount++;
            break;
          case "CONTRADICTED":
            effContradictedCount++;
            break;
          case "MIXED":
            effMixedCount++;
            break;
          case "INSUFFICIENT_EVIDENCE":
          default:
            effInsufficientCount++;
            break;
        }

        // 4-Quadrant Honesty Matrix categorization
        if (effectiveStatus === "SUPPORTED") {
          quadrantVerifiedGrounded++;
        } else if (effectiveStatus === "CONTRADICTED") {
          if (
            rawAiStatus === "SUPPORTED" ||
            claim.preliminaryConfidence === AIAssessmentConfidence.HIGH_SUPPORT
          ) {
            quadrantSilentHallucinations++;
          } else {
            quadrantCaughtContradictions++;
          }
        } else if (effectiveStatus === "INSUFFICIENT_EVIDENCE") {
          quadrantSafeAbstentions++;
        }

        // Audit human review adjudication
        if (claim.humanVerdict !== null) {
          totalReviewed++;
          const isAgreement = this.checkAgreement(
            claim.preliminaryConfidence,
            claim.humanVerdict,
          );
          if (isAgreement) {
            agreedCount++;
          } else {
            overrideCount++;
            if (
              claim.preliminaryConfidence ===
                AIAssessmentConfidence.HIGH_SUPPORT &&
              claim.humanVerdict === HumanVerdict.CONTRADICTED
            ) {
              aiSupportedOverriddenToContradictedCount++;
            }
          }

          if (
            !isAgreement ||
            claim.humanVerdict === HumanVerdict.CONTRADICTED
          ) {
            if (recentDisagreements.length < 5) {
              const claimFilePath =
                session.targetFilePath ||
                claim.evidence?.find((e) => e.filePath)?.filePath ||
                "Repository Source";
              recentDisagreements.push({
                claimId: claim.id,
                sessionId: session.id,
                claimText: claim.text,
                filePath: claimFilePath.replace(/\\/g, "/"),
                machineVerdict: rawAiStatus,
                humanVerdict: claim.humanVerdict,
              });
            }
          }
        }

        const isProblematic =
          effectiveStatus === "INSUFFICIENT_EVIDENCE" ||
          effectiveStatus === "CONTRADICTED";
        const isContradicted = effectiveStatus === "CONTRADICTED";

        // Collect file statistics from claim evidence if present
        if (claim.evidence && claim.evidence.length > 0) {
          for (const ev of claim.evidence) {
            if (ev.filePath) {
              recordFileStat(
                ev.filePath,
                repoId,
                repoName,
                isProblematic,
                isContradicted,
                sessionDate,
              );
            }
          }
        }
      }

      // Also record session targetFilePath
      if (session.targetFilePath) {
        const sessionHadIssues = session.claims.some((c) => {
          if (
            c.humanVerdict === HumanVerdict.CONTRADICTED ||
            c.humanVerdict === HumanVerdict.UNVERIFIED
          ) {
            return true;
          }
          if (
            c.humanVerdict === null &&
            c.preliminaryConfidence === AIAssessmentConfidence.SPARSE_EVIDENCE
          ) {
            return true;
          }
          return false;
        });
        const sessionHadContradiction = session.claims.some(
          (c) =>
            c.humanVerdict === HumanVerdict.CONTRADICTED ||
            (c.humanVerdict === null &&
              c.preliminaryConfidence === AIAssessmentConfidence.CONTRADICTED),
        );
        recordFileStat(
          session.targetFilePath,
          repoId,
          repoName,
          sessionHadIssues,
          sessionHadContradiction,
          sessionDate,
        );
      }
    }

    const totalClaims =
      rawSupportedCount +
      rawContradictedCount +
      rawMixedCount +
      rawInsufficientCount;

    // Rates calculation with rounding to 1 decimal place
    const calcPct = (count: number, total: number): number => {
      if (total === 0) return 0;
      return Math.round((count / total) * 1000) / 10;
    };

    const aiGroundedRate = calcPct(rawSupportedCount, totalClaims);
    const effectiveGroundedRate = calcPct(effSupportedCount, totalClaims);
    const abstentionRate = calcPct(effInsufficientCount, totalClaims);
    const contradictedRate = calcPct(effContradictedCount, totalClaims);
    const mixedRate = calcPct(effMixedCount, totalClaims);

    // Effective Breakdown (Primary)
    const effectiveVerdictBreakdown: VerdictBreakdown = {
      supported: {
        count: effSupportedCount,
        percentage: effectiveGroundedRate,
      },
      contradicted: {
        count: effContradictedCount,
        percentage: contradictedRate,
      },
      mixed: { count: effMixedCount, percentage: mixedRate },
      insufficientEvidence: {
        count: effInsufficientCount,
        percentage: abstentionRate,
      },
    };

    // Raw AI Preliminary Breakdown
    const aiVerdictBreakdown: VerdictBreakdown = {
      supported: { count: rawSupportedCount, percentage: aiGroundedRate },
      contradicted: {
        count: rawContradictedCount,
        percentage: calcPct(rawContradictedCount, totalClaims),
      },
      mixed: {
        count: rawMixedCount,
        percentage: calcPct(rawMixedCount, totalClaims),
      },
      insufficientEvidence: {
        count: rawInsufficientCount,
        percentage: calcPct(rawInsufficientCount, totalClaims),
      },
    };

    // Human override calculation
    const humanOverride: HumanOverrideBreakdown = {
      totalReviewed,
      agreedCount,
      overrideCount,
      overrideRate:
        totalReviewed > 0 ? calcPct(overrideCount, totalReviewed) : null,
      hasHumanReviews: totalReviewed > 0,
    };

    // Compute Effective Trust / Calibration Score (0–100%)
    // Base: rewards effective SUPPORTED (100%), MIXED (50%), and cautious abstentions (35%)
    let trustScoreCalc =
      (effSupportedCount * 100 +
        effMixedCount * 50 +
        effInsufficientCount * 35) /
      totalClaims;

    // Penalty for CONTRADICTED claims (whether flagged by AI or overridden by human engineer)
    const contradictionPenalty = (effContradictedCount / totalClaims) * 50;
    trustScoreCalc -= contradictionPenalty;

    // Penalty for human review disagreements / overrides against AI claims
    if (totalReviewed > 0) {
      const overrideRatio = overrideCount / totalReviewed;
      const reviewCoverage = totalReviewed / totalClaims;
      trustScoreCalc -= overrideRatio * 20 * Math.min(1, reviewCoverage * 1.5);

      // Dedicated penalty for high-confidence AI claims that humans caught as CONTRADICTED
      trustScoreCalc -= aiSupportedOverriddenToContradictedCount * 5;
    }

    const effectiveTrustScore = Math.max(
      0,
      Math.min(100, Math.round(trustScoreCalc * 10) / 10),
    );

    // 3. Compute Context Blind-Spot Map
    const candidatePaths = Array.from(fileMetricsMap.keys());

    // Query commit churn counts for these file paths from CommitDiff
    const churnMap = new Map<string, number>();
    if (candidatePaths.length > 0) {
      try {
        const commitDiffs = await this.prisma.commitDiff.findMany({
          where: {
            commit: {
              repository: {
                workspaceId,
              },
            },
            filePath: { in: candidatePaths },
          },
          select: {
            filePath: true,
          },
        });

        for (const diff of commitDiffs) {
          const clean = diff.filePath.replace(/\\/g, "/").trim();
          churnMap.set(clean, (churnMap.get(clean) || 0) + 1);
        }
      } catch (err) {
        this.logger.warn(
          `Unable to retrieve commit churn for blind-spot map: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Query existing Engineering Decisions in this workspace
    const decisionsMap = new Map<
      string,
      { count: number; hasAccepted: boolean }
    >();
    try {
      const decisions = await this.prisma.engineeringDecision.findMany({
        where: {
          workspaceId,
          targetFilePath: { not: null },
        },
        select: {
          targetFilePath: true,
          status: true,
        },
      });

      for (const d of decisions) {
        if (!d.targetFilePath) continue;
        const clean = d.targetFilePath.replace(/\\/g, "/").trim();
        const current = decisionsMap.get(clean) || {
          count: 0,
          hasAccepted: false,
        };
        current.count += 1;
        if (d.status === "ACCEPTED") {
          current.hasAccepted = true;
        }
        decisionsMap.set(clean, current);
      }
    } catch (err) {
      this.logger.warn(
        `Unable to retrieve engineering decisions for blind-spot map: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Assemble blind spot items
    const blindSpots: ContextBlindSpotItem[] = [];

    for (const [filePath, stats] of fileMetricsMap.entries()) {
      // Find matching decision info (exact or suffix/prefix match)
      let decInfo = decisionsMap.get(filePath);
      if (!decInfo) {
        for (const [dPath, dData] of decisionsMap.entries()) {
          if (
            filePath === dPath ||
            filePath.endsWith(`/${dPath}`) ||
            dPath.endsWith(`/${filePath}`)
          ) {
            decInfo = dData;
            break;
          }
        }
      }

      const churnCount = churnMap.get(filePath) || 0;
      const hasAccepted = decInfo ? decInfo.hasAccepted : false;
      const decisionsCount = decInfo ? decInfo.count : 0;

      blindSpots.push({
        filePath,
        repositoryId: stats.repositoryId,
        repositoryName: stats.repositoryName,
        insufficientEvidenceCount: stats.insufficientEvidenceCount,
        totalQueries: stats.totalQueries,
        commitChurnCount: churnCount,
        hasAcceptedDecision: hasAccepted,
        decisionsCount,
        suggestedAction: hasAccepted ? "COVERED" : "DOCUMENT_DECISION",
        lastQueriedAt: stats.lastQueriedAt.toISOString(),
      });
    }

    // Rank blind spots:
    // 1. Files lacking accepted decisions first (!hasAcceptedDecision)
    // 2. High insufficient/contradicted count
    // 3. High commit churn
    // 4. Query frequency
    blindSpots.sort((a, b) => {
      if (a.hasAcceptedDecision !== b.hasAcceptedDecision) {
        return a.hasAcceptedDecision ? 1 : -1;
      }
      if (b.insufficientEvidenceCount !== a.insufficientEvidenceCount) {
        return b.insufficientEvidenceCount - a.insufficientEvidenceCount;
      }
      if (b.commitChurnCount !== a.commitChurnCount) {
        return b.commitChurnCount - a.commitChurnCount;
      }
      return b.totalQueries - a.totalQueries;
    });

    // Chronological trajectory of up to 10 recent sessions
    const sessionTrend: CalibrationSessionTrendItem[] = sessions
      .slice(0, 10)
      .reverse()
      .map((sess, idx) => {
        let supp = 0;
        let contra = 0;
        let mixed = 0;
        let abst = 0;

        for (const c of sess.claims) {
          let eff:
            "SUPPORTED" | "CONTRADICTED" | "MIXED" | "INSUFFICIENT_EVIDENCE";
          if (c.humanVerdict === HumanVerdict.SUPPORTED) {
            eff = "SUPPORTED";
          } else if (c.humanVerdict === HumanVerdict.CONTRADICTED) {
            eff = "CONTRADICTED";
          } else if (c.humanVerdict === HumanVerdict.UNVERIFIED) {
            eff = "INSUFFICIENT_EVIDENCE";
          } else {
            eff = fromPrismaConfidence(c.preliminaryConfidence);
          }

          if (eff === "SUPPORTED") supp++;
          else if (eff === "CONTRADICTED") contra++;
          else if (eff === "MIXED") mixed++;
          else abst++;
        }

        const totalSessClaims = supp + contra + mixed + abst;
        let sessTrust =
          totalSessClaims > 0
            ? (supp * 100 + mixed * 50 + abst * 35) / totalSessClaims -
              (contra / totalSessClaims) * 50
            : 100;
        sessTrust = Math.max(0, Math.min(100, Math.round(sessTrust * 10) / 10));

        const baseLabel = sess.targetFilePath
          ? sess.targetFilePath.split(/[/\\]/).pop() || `Run #${idx + 1}`
          : `Run #${idx + 1}`;

        return {
          sessionId: sess.id,
          label: baseLabel,
          trustScore: sessTrust,
          supportedCount: supp,
          contradictedCount: contra,
          abstainedCount: abst,
        };
      });

    return {
      workspaceId,
      totalVerifications,
      totalClaims,
      effectiveTrustScore,
      aiGroundedRate,
      effectiveGroundedRate,
      groundedRate: effectiveGroundedRate,
      abstentionRate,
      contradictedRate,
      mixedRate,
      overrideRate: humanOverride.overrideRate,
      verdictBreakdown: effectiveVerdictBreakdown,
      effectiveVerdictBreakdown,
      aiVerdictBreakdown,
      humanOverride,
      blindSpots: blindSpots.slice(0, 15),
      sessionTrend,
      calibrationQuadrants: {
        verifiedGrounded: quadrantVerifiedGrounded,
        silentHallucinations: quadrantSilentHallucinations,
        caughtContradictions: quadrantCaughtContradictions,
        safeAbstentions: quadrantSafeAbstentions,
      },
      recentDisagreements,
      summaryTimestamp: timestamp,
    };
  }

  /**
   * Helper to check whether human verdict agrees with AI preliminary confidence assessment
   */
  private checkAgreement(
    preliminary: AIAssessmentConfidence,
    humanVerdict: HumanVerdict,
  ): boolean {
    switch (preliminary) {
      case AIAssessmentConfidence.HIGH_SUPPORT:
        return humanVerdict === HumanVerdict.SUPPORTED;
      case AIAssessmentConfidence.CONTRADICTED:
        return humanVerdict === HumanVerdict.CONTRADICTED;
      case AIAssessmentConfidence.SPARSE_EVIDENCE:
        return humanVerdict === HumanVerdict.UNVERIFIED;
      case AIAssessmentConfidence.PARTIAL_SUPPORT:
        return false;
      default:
        return false;
    }
  }
}
