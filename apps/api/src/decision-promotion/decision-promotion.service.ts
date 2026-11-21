import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PromoteClaimToDecisionDto } from "./decision-promotion.dto";
import {
  DecisionStatus,
  DecisionSeverity,
  EvidenceReference,
  PromoteClaimToDecisionResponse,
} from "@traceback/shared-types";
import { AuthenticatedUser } from "../auth/auth.types";

@Injectable()
export class DecisionPromotionService {
  private readonly logger = new Logger(DecisionPromotionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Promotes a verified claim or verification session into a draft Engineering Decision.
   * Scoped strictly by workspaceId and repositoryId to enforce tenant isolation.
   * Persisted strictly in CANDIDATE (Draft / Pending Human Approval) status.
   */
  async promoteToDecision(
    workspaceId: string,
    dto: PromoteClaimToDecisionDto,
    _user?: AuthenticatedUser,
  ): Promise<PromoteClaimToDecisionResponse> {
    if (!dto.claimId && !dto.verificationSessionId) {
      throw new BadRequestException(
        "Either claimId or verificationSessionId must be provided to promote a decision.",
      );
    }

    // 1. Verify repository exists and belongs to the workspace
    const repository = await this.prisma.repository.findFirst({
      where: { id: dto.repositoryId, workspaceId },
    });

    if (!repository) {
      throw new NotFoundException(
        `Repository ${dto.repositoryId} not found in workspace ${workspaceId}.`,
      );
    }

    // 2. Fetch the claim with its verification session and linked evidence/source records
    let claim: any = null;

    if (dto.claimId) {
      claim = await this.prisma.claim.findFirst({
        where: {
          id: dto.claimId,
          session: {
            workspaceId,
            repositoryId: dto.repositoryId,
            ...(dto.verificationSessionId
              ? { id: dto.verificationSessionId }
              : {}),
          },
        },
        include: {
          session: true,
          evidence: {
            include: {
              sourceRecord: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!claim) {
        throw new NotFoundException(
          `Claim ${dto.claimId} not found in repository ${dto.repositoryId} for workspace ${workspaceId}.`,
        );
      }
    } else if (dto.verificationSessionId) {
      const session = await this.prisma.verificationSession.findFirst({
        where: {
          id: dto.verificationSessionId,
          workspaceId,
          repositoryId: dto.repositoryId,
        },
        include: {
          claims: {
            include: {
              evidence: {
                include: {
                  sourceRecord: true,
                },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!session) {
        throw new NotFoundException(
          `Verification session ${dto.verificationSessionId} not found in workspace ${workspaceId}.`,
        );
      }

      if (!session.claims || session.claims.length === 0) {
        throw new NotFoundException(
          `No claims found in verification session ${dto.verificationSessionId}.`,
        );
      }

      // Prioritize claim with human verdict CONFIRMED, otherwise take the first claim
      claim =
        session.claims.find((c: any) => c.humanVerdict === "CONFIRMED") ||
        session.claims[0];
      claim.session = session;
    }

    // 3. Assemble canonical provenance references and evidence items
    const rawEvidence: any[] = claim.evidence || [];
    const evidenceItems: EvidenceReference[] = rawEvidence.map((ev: any) => {
      const sr = ev.sourceRecord;
      return {
        id: ev.id,
        sourceType: ev.sourceType,
        referenceKey: ev.referenceKey || sr?.referenceKey || "",
        title: ev.title || sr?.title || "",
        author: ev.author || sr?.author || "Unknown",
        timestamp: (ev.timestamp || sr?.recordedAt || new Date()).toISOString(),
        url: ev.url || sr?.url || "",
        snippet: ev.snippet || sr?.snippet || undefined,
        filePath: ev.filePath || sr?.filePath || undefined,
        lineRange:
          ev.lineStart && ev.lineEnd
            ? { start: ev.lineStart, end: ev.lineEnd }
            : sr?.lineStart && sr?.lineEnd
              ? { start: sr.lineStart, end: sr.lineEnd }
              : undefined,
      };
    });

    // Extract primary commit SHA from evidence or canonical source records
    const commitEvidence = evidenceItems.find(
      (e) =>
        e.sourceType === "COMMIT" || /^[0-9a-f]{7,40}$/i.test(e.referenceKey),
    );
    const relatedCommitSha = commitEvidence
      ? commitEvidence.referenceKey
      : null;

    // Extract primary PR number
    const prEvidence = evidenceItems.find(
      (e) => e.sourceType === "PULL_REQUEST" || /^#?\d+$/.test(e.referenceKey),
    );
    const prNumRaw = prEvidence
      ? parseInt(prEvidence.referenceKey.replace(/[^0-9]/g, ""), 10)
      : null;
    const relatedPrNumber = prNumRaw && !isNaN(prNumRaw) ? prNumRaw : null;

    // 4. Pre-populate title, summary, decision, and rationale from verified claims & evidence
    const defaultTitle = claim.targetSymbol
      ? `Architectural Constraint for ${claim.targetSymbol}`
      : claim.text.length > 80
        ? `${claim.text.slice(0, 77)}...`
        : claim.text;
    const title = dto.title?.trim() || defaultTitle;

    const summary =
      dto.summary?.trim() || `Derived from verified claim: "${claim.text}"`;

    const decision =
      dto.decision?.trim() ||
      `Preserve established architectural requirement: ${claim.text}`;

    const evidenceExcerpts = evidenceItems
      .map((ev) => {
        const loc = ev.filePath
          ? ` (${ev.filePath}${ev.lineRange ? `:${ev.lineRange.start}-${ev.lineRange.end}` : ""})`
          : "";
        const snip = ev.snippet
          ? `\n  > "${ev.snippet.trim().slice(0, 200)}"`
          : "";
        return `- [${ev.sourceType}] ${ev.referenceKey}: ${ev.title}${loc}${snip}`;
      })
      .join("\n");

    const sessionExplanation = claim.session?.explanation || "";
    const defaultRationale = `Verified Explanation:\n${sessionExplanation}\n\nSupporting Historical Evidence:\n${
      evidenceExcerpts || "No direct evidence records linked."
    }`;
    const rationale = dto.rationale?.trim() || defaultRationale;

    const targetFilePath =
      dto.targetFilePath?.trim() ||
      claim.session?.targetFilePath ||
      evidenceItems.find((e) => e.filePath)?.filePath ||
      null;

    const targetSymbol = dto.targetSymbol?.trim() || claim.targetSymbol || null;

    // 5. Persist the Engineering Decision strictly in CANDIDATE (Draft / Pending Approval) status
    // NEVER auto-approve: status is strictly CANDIDATE and reviewer fields remain null.
    const decisionRecord = await this.prisma.engineeringDecision.create({
      data: {
        workspaceId,
        repositoryId: dto.repositoryId,
        title,
        summary,
        decision,
        rationale,
        targetFilePath,
        targetSymbol,
        status: "CANDIDATE", // Strictly Draft / Pending Human Review
        severity: (dto.severity as any) || "MEDIUM",
        supportingEvidence: (evidenceItems as any) || [],
        relatedCommitSha,
        relatedPrNumber,
        createdFromClaimId: claim.id,
        reviewerId: null,
        reviewerName: null,
        reviewNotes: null,
        reviewedAt: null,
      },
    });

    this.logger.log(
      `Promoted verified claim ${claim.id} to draft decision ${decisionRecord.id} (status: ${decisionRecord.status}) for repo ${dto.repositoryId}`,
    );

    return {
      decisionId: decisionRecord.id,
      id: decisionRecord.id,
      workspaceId: decisionRecord.workspaceId,
      repositoryId: decisionRecord.repositoryId,
      title: decisionRecord.title,
      summary: decisionRecord.summary,
      decision: decisionRecord.decision,
      rationale: decisionRecord.rationale,
      targetFilePath: decisionRecord.targetFilePath,
      targetSymbol: decisionRecord.targetSymbol,
      status: decisionRecord.status as DecisionStatus,
      severity: decisionRecord.severity as DecisionSeverity,
      supportingEvidence:
        (decisionRecord.supportingEvidence as unknown as EvidenceReference[]) ||
        [],
      relatedCommitSha: decisionRecord.relatedCommitSha,
      relatedPrNumber: decisionRecord.relatedPrNumber,
      createdFromClaimId: decisionRecord.createdFromClaimId,
      createdAt: decisionRecord.createdAt.toISOString(),
      updatedAt: decisionRecord.updatedAt.toISOString(),
    };
  }
}
