import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateDecisionDto,
  UpdateDecisionDto,
  ReviewDecisionDto,
  SupersedeDecisionDto,
  ProposeFromClaimDto,
  SyncAdrsDto,
  ExportAdrDto,
} from "./decisions.dto";
import {
  DecisionStatus,
  DecisionSeverity,
  EngineeringDecisionDto,
  EvidenceReference,
  AdrFileDto,
  AdrSyncResultDto,
} from "@traceback/shared-types";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  formatDecisionToAdrMarkdown,
  parseAdrMarkdownToDecision,
  generateAdrFileName,
} from "./adr-parser.util";

@Injectable()
export class DecisionsService {
  private readonly logger = new Logger(DecisionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async verifyRepository(workspaceId: string, repositoryId: string) {
    const repo = await this.prisma.repository.findFirst({
      where: { id: repositoryId, workspaceId },
    });
    if (!repo) {
      throw new NotFoundException(
        `Repository ${repositoryId} not found in workspace ${workspaceId}.`,
      );
    }
    return repo;
  }

  private async verifyReviewerRole(
    workspaceId: string,
    user?: AuthenticatedUser,
  ): Promise<void> {
    if (!user || !this.prisma?.workspaceMember?.findUnique) return;
    try {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: user.id,
          },
        },
      });
      if (membership && membership.role === "VIEWER") {
        throw new ForbiddenException(
          "Workspace viewers are not permitted to review, approve, or modify engineering decisions.",
        );
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
    }
  }

  async listDecisions(
    workspaceId: string,
    repositoryId: string,
    status?: DecisionStatus,
  ): Promise<EngineeringDecisionDto[]> {
    await this.verifyRepository(workspaceId, repositoryId);

    const where: any = { workspaceId, repositoryId };
    if (status) {
      where.status = status;
    }

    const records = await this.prisma.engineeringDecision.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return records.map((r) => this.mapDecisionToDto(r));
  }

  async getDecisionById(
    workspaceId: string,
    repositoryId: string,
    id: string,
  ): Promise<EngineeringDecisionDto> {
    await this.verifyRepository(workspaceId, repositoryId);

    const record = await this.prisma.engineeringDecision.findFirst({
      where: { id, workspaceId, repositoryId },
    });

    if (!record) {
      throw new NotFoundException(`Engineering decision ${id} not found.`);
    }

    return this.mapDecisionToDto(record);
  }

  async createDecision(
    workspaceId: string,
    repositoryId: string,
    dto: CreateDecisionDto,
    user?: AuthenticatedUser,
  ): Promise<EngineeringDecisionDto> {
    await this.verifyRepository(workspaceId, repositoryId);

    const record = await this.prisma.engineeringDecision.create({
      data: {
        workspaceId,
        repositoryId,
        title: dto.title.trim(),
        summary: dto.summary.trim(),
        decision: dto.decision.trim(),
        rationale: dto.rationale.trim(),
        targetFilePath: dto.targetFilePath?.trim() || null,
        targetSymbol: dto.targetSymbol?.trim() || null,
        status: (dto.status as any) || "CANDIDATE",
        severity: (dto.severity as any) || "MEDIUM",
        supportingEvidence: (dto.supportingEvidence as any) || [],
        relatedCommitSha: dto.relatedCommitSha?.trim() || null,
        relatedPrNumber: dto.relatedPrNumber || null,
        supersedesId: dto.supersedesId || null,
        createdFromClaimId: dto.createdFromClaimId || null,
        reviewerId: user?.id || null,
        reviewerName: user?.name || null,
      },
    });

    this.logger.log(
      `Created engineering decision ${record.id} (${record.status}) for repo ${repositoryId}`,
    );

    return this.mapDecisionToDto(record);
  }

  async updateDecision(
    workspaceId: string,
    repositoryId: string,
    id: string,
    dto: UpdateDecisionDto,
    user?: AuthenticatedUser,
  ): Promise<EngineeringDecisionDto> {
    await this.getDecisionById(workspaceId, repositoryId, id);

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title.trim();
    if (dto.summary !== undefined) updateData.summary = dto.summary.trim();
    if (dto.decision !== undefined) updateData.decision = dto.decision.trim();
    if (dto.rationale !== undefined)
      updateData.rationale = dto.rationale.trim();
    if (dto.targetFilePath !== undefined)
      updateData.targetFilePath = dto.targetFilePath?.trim() || null;
    if (dto.targetSymbol !== undefined)
      updateData.targetSymbol = dto.targetSymbol?.trim() || null;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.severity !== undefined) updateData.severity = dto.severity;
    if (dto.reviewNotes !== undefined)
      updateData.reviewNotes = dto.reviewNotes?.trim() || null;
    if (dto.supersedesId !== undefined)
      updateData.supersedesId = dto.supersedesId;
    if (dto.supersededById !== undefined)
      updateData.supersededById = dto.supersededById;

    const updated = await this.prisma.engineeringDecision.update({
      where: { id },
      data: updateData,
    });

    return this.mapDecisionToDto(updated);
  }

  async acceptDecision(
    workspaceId: string,
    repositoryId: string,
    id: string,
    dto: ReviewDecisionDto,
    user?: AuthenticatedUser,
  ): Promise<EngineeringDecisionDto> {
    await this.verifyReviewerRole(workspaceId, user);
    await this.getDecisionById(workspaceId, repositoryId, id);

    const updated = await this.prisma.engineeringDecision.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        reviewerId: user?.id || null,
        reviewerName: user?.name || "Human Reviewer",
        reviewNotes:
          dto.reviewNotes?.trim() || "Accepted as historical constraint.",
        reviewedAt: new Date(),
      },
    });

    this.logger.log(`Decision ${id} accepted by ${user?.name || "anonymous"}`);
    return this.mapDecisionToDto(updated);
  }

  async rejectDecision(
    workspaceId: string,
    repositoryId: string,
    id: string,
    dto: ReviewDecisionDto,
    user?: AuthenticatedUser,
  ): Promise<EngineeringDecisionDto> {
    await this.verifyReviewerRole(workspaceId, user);
    await this.getDecisionById(workspaceId, repositoryId, id);

    const updated = await this.prisma.engineeringDecision.update({
      where: { id },
      data: {
        status: "ARCHIVED",
        reviewerId: user?.id || null,
        reviewerName: user?.name || "Human Reviewer",
        reviewNotes: dto.reviewNotes?.trim() || "Rejected candidate decision.",
        reviewedAt: new Date(),
      },
    });

    return this.mapDecisionToDto(updated);
  }

  async disputeDecision(
    workspaceId: string,
    repositoryId: string,
    id: string,
    dto: ReviewDecisionDto,
    user?: AuthenticatedUser,
  ): Promise<EngineeringDecisionDto> {
    await this.verifyReviewerRole(workspaceId, user);
    await this.getDecisionById(workspaceId, repositoryId, id);

    const updated = await this.prisma.engineeringDecision.update({
      where: { id },
      data: {
        status: "DISPUTED",
        reviewerId: user?.id || null,
        reviewerName: user?.name || "Human Reviewer",
        reviewNotes:
          dto.reviewNotes?.trim() || "Decision disputed by reviewer.",
        reviewedAt: new Date(),
      },
    });

    return this.mapDecisionToDto(updated);
  }

  async supersedeDecision(
    workspaceId: string,
    repositoryId: string,
    newDecisionId: string,
    dto: SupersedeDecisionDto,
    user?: AuthenticatedUser,
  ): Promise<EngineeringDecisionDto> {
    await this.verifyReviewerRole(workspaceId, user);
    const oldDecision = await this.getDecisionById(
      workspaceId,
      repositoryId,
      dto.supersedesId,
    );

    // Update old decision to SUPERSEDED
    await this.prisma.engineeringDecision.update({
      where: { id: oldDecision.id },
      data: {
        status: "SUPERSEDED",
        supersededById: newDecisionId,
        reviewNotes:
          `Superseded by decision ${newDecisionId}. ${dto.notes || ""}`.trim(),
      },
    });

    // Update new decision to mark what it supersedes
    const updatedNew = await this.prisma.engineeringDecision.update({
      where: { id: newDecisionId },
      data: {
        supersedesId: oldDecision.id,
        status: "ACCEPTED",
        reviewerId: user?.id || null,
        reviewerName: user?.name || null,
        reviewedAt: new Date(),
      },
    });

    return this.mapDecisionToDto(updatedNew);
  }

  async proposeFromClaim(
    workspaceId: string,
    repositoryId: string,
    dto: ProposeFromClaimDto,
    user?: AuthenticatedUser,
  ): Promise<EngineeringDecisionDto> {
    await this.verifyRepository(workspaceId, repositoryId);

    const claim = await this.prisma.claim.findUnique({
      where: { id: dto.claimId },
      include: {
        session: true,
        evidence: true,
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim ${dto.claimId} not found.`);
    }

    if (
      claim.session.workspaceId !== workspaceId ||
      claim.session.repositoryId !== repositoryId
    ) {
      throw new ForbiddenException(
        "Claim does not belong to the specified workspace or repository.",
      );
    }

    // Convert evidence records to EvidenceReference items
    const evidenceItems: EvidenceReference[] = claim.evidence.map((ev) => ({
      id: ev.id,
      sourceType: ev.sourceType as any,
      referenceKey: ev.referenceKey,
      title: ev.title,
      author: ev.author,
      timestamp: ev.timestamp.toISOString(),
      url: ev.url,
      snippet: ev.snippet || undefined,
      filePath: ev.filePath || undefined,
      lineRange:
        ev.lineStart && ev.lineEnd
          ? { start: ev.lineStart, end: ev.lineEnd }
          : undefined,
    }));

    const title =
      dto.title?.trim() ||
      (claim.targetSymbol
        ? `Architectural Constraint for ${claim.targetSymbol}`
        : claim.text.slice(0, 100));

    const summary =
      dto.summary?.trim() || `Derived from verified claim: "${claim.text}"`;
    const decision =
      dto.decision?.trim() ||
      `Preserve established architectural constraint: ${claim.text}`;
    const rationale =
      dto.rationale?.trim() ||
      `Verified historical evidence confirms this requirement was intentionally implemented. Original session explanation: "${claim.session.explanation.slice(0, 300)}"`;
    const targetFilePath =
      dto.targetFilePath?.trim() ||
      claim.session.targetFilePath ||
      (evidenceItems[0]?.filePath ?? null);
    const targetSymbol = dto.targetSymbol?.trim() || claim.targetSymbol || null;

    const isExplicitlyAccepted = dto.status === "ACCEPTED";
    if (isExplicitlyAccepted) {
      await this.verifyReviewerRole(workspaceId, user);
    }
    const status: DecisionStatus = isExplicitlyAccepted
      ? "ACCEPTED"
      : "CANDIDATE";
    const reviewerId = isExplicitlyAccepted ? user?.id || null : null;
    const reviewerName = isExplicitlyAccepted
      ? user?.name || "Human Reviewer"
      : null;
    const reviewNotes = isExplicitlyAccepted
      ? dto.reviewNotes?.trim() ||
        "Explicitly accepted by reviewer during promotion."
      : null;
    const reviewedAt = isExplicitlyAccepted ? new Date() : null;

    const decisionRecord = await this.prisma.engineeringDecision.create({
      data: {
        workspaceId,
        repositoryId,
        title,
        summary,
        decision,
        rationale,
        targetFilePath,
        targetSymbol,
        status: status as any,
        severity: (dto.severity as any) || "HIGH",
        supportingEvidence: (evidenceItems as any) || [],
        relatedCommitSha:
          evidenceItems.find((e) => e.sourceType === "COMMIT")?.referenceKey ||
          null,
        relatedPrNumber:
          parseInt(
            evidenceItems
              .find((e) => e.sourceType === "PULL_REQUEST")
              ?.referenceKey.replace(/[^0-9]/g, "") || "0",
            10,
          ) || null,
        createdFromClaimId: claim.id,
        reviewerId,
        reviewerName,
        reviewNotes,
        reviewedAt,
      },
    });

    this.logger.log(
      `Proposed engineering decision ${decisionRecord.id} (${status}) from claim ${claim.id}`,
    );

    return this.mapDecisionToDto(decisionRecord);
  }

  /**
   * Generates formatted ADR markdown and metadata for a specific decision record.
   */
  async getDecisionAdr(
    workspaceId: string,
    repositoryId: string,
    id: string,
  ): Promise<AdrFileDto> {
    const decision = await this.getDecisionById(workspaceId, repositoryId, id);

    // Calculate sequential number based on created order in repository
    const priorDecisionsCount = await this.prisma.engineeringDecision.count({
      where: {
        repositoryId,
        createdAt: { lte: new Date(decision.createdAt) },
      },
    });

    const sequenceNumber = Math.max(1, priorDecisionsCount);
    const pad = String(sequenceNumber).padStart(3, "0");
    const identifier = `ADR-${pad}`;
    const fileName = generateAdrFileName(sequenceNumber, decision.title);
    const markdown = formatDecisionToAdrMarkdown(decision, sequenceNumber);

    return {
      decisionId: decision.id,
      identifier,
      title: decision.title,
      fileName,
      filePath: `docs/adr/${fileName}`,
      markdown,
      status: decision.status,
      date: decision.reviewedAt || decision.createdAt,
    };
  }

  /**
   * Resolves the target ADR directory safely on the workspace filesystem.
   */
  private resolveAdrDirectory(customDir = "docs/adr"): {
    repoRoot: string;
    adrDir: string;
    relativeDir: string;
  } {
    const cwd = process.cwd();
    let repoRoot = cwd;
    if (fs.existsSync(path.resolve(cwd, "docs"))) {
      repoRoot = cwd;
    } else if (fs.existsSync(path.resolve(cwd, "../../docs"))) {
      repoRoot = path.resolve(cwd, "../..");
    }

    const inputDir = (customDir || "docs/adr").trim();
    // Prohibit path traversal tokens and absolute paths escaping workspace boundary
    if (
      path.isAbsolute(inputDir) ||
      inputDir.includes("..") ||
      inputDir.startsWith("/") ||
      inputDir.startsWith("\\")
    ) {
      throw new BadRequestException(
        "Invalid ADR directory path: directory traversal and absolute paths are prohibited.",
      );
    }

    const normalized = path.normalize(inputDir);
    const adrDir = path.resolve(repoRoot, normalized);

    const relativeToRoot = path.relative(repoRoot, adrDir);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new BadRequestException(
        "Invalid ADR directory path: target directory must reside within repository root.",
      );
    }

    return { repoRoot, adrDir, relativeDir: relativeToRoot || "docs/adr" };
  }

  /**
   * Projects an ADR record into SourceRecords for evidence retrieval.
   */
  private async projectAdrToSourceRecord(
    repositoryId: string,
    identifier: string,
    title: string,
    markdown: string,
    filePath: string,
    recordedAt: Date,
    decisionId: string,
    reviewerName?: string | null,
  ): Promise<void> {
    try {
      await this.prisma.sourceRecord.upsert({
        where: {
          repositoryId_sourceType_externalId: {
            repositoryId,
            sourceType: "ADR" as any,
            externalId: filePath,
          },
        },
        create: {
          repositoryId,
          sourceType: "ADR" as any,
          externalId: filePath,
          referenceKey: identifier,
          title: `ADR: ${title}`,
          author: reviewerName || "Architecture Review",
          url: `/decisions?repoId=${repositoryId}&id=${decisionId}`,
          content: markdown,
          snippet: markdown.slice(0, 300),
          filePath,
          recordedAt,
        },
        update: {
          title: `ADR: ${title}`,
          content: markdown,
          snippet: markdown.slice(0, 300),
          filePath,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to project ADR ${identifier} into SourceRecord: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Exports an individual decision to a Git-native /docs/adr/*.md file.
   */
  async exportDecisionToAdr(
    workspaceId: string,
    repositoryId: string,
    id: string,
    options?: ExportAdrDto,
  ): Promise<AdrFileDto> {
    const adrDto = await this.getDecisionAdr(workspaceId, repositoryId, id);
    const { adrDir, relativeDir } = this.resolveAdrDirectory(
      options?.adrDirectory,
    );

    if (!fs.existsSync(adrDir)) {
      fs.mkdirSync(adrDir, { recursive: true });
    }

    const targetFilePath = path.join(adrDir, adrDto.fileName);
    if (!path.resolve(targetFilePath).startsWith(adrDir)) {
      throw new BadRequestException("Invalid target file path for ADR export.");
    }
    fs.writeFileSync(targetFilePath, adrDto.markdown, "utf-8");

    const relativePath = path.join(relativeDir, adrDto.fileName);
    await this.projectAdrToSourceRecord(
      repositoryId,
      adrDto.identifier,
      adrDto.title,
      adrDto.markdown,
      relativePath,
      new Date(adrDto.date),
      id,
    );

    this.logger.log(`Exported decision ${id} to ${targetFilePath}`);
    return {
      ...adrDto,
      filePath: relativePath,
    };
  }

  /**
   * Exports all decisions of a repository to /docs/adr/*.md files.
   */
  async exportAllDecisionsToAdrs(
    workspaceId: string,
    repositoryId: string,
    options?: SyncAdrsDto,
  ): Promise<AdrSyncResultDto> {
    const decisions = await this.listDecisions(workspaceId, repositoryId);
    const { adrDir, relativeDir } = this.resolveAdrDirectory(
      options?.adrDirectory,
    );

    if (!fs.existsSync(adrDir)) {
      fs.mkdirSync(adrDir, { recursive: true });
    }

    const syncedFiles: string[] = [];
    const errors: string[] = [];
    let exportedCount = 0;

    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];
      try {
        const sequenceNumber = i + 1;
        const pad = String(sequenceNumber).padStart(3, "0");
        const identifier = `ADR-${pad}`;
        const fileName = generateAdrFileName(sequenceNumber, decision.title);
        const markdown = formatDecisionToAdrMarkdown(decision, sequenceNumber);
        const fullPath = path.join(adrDir, fileName);
        const relPath = path.join(relativeDir, fileName);

        // Conflict resolution: Check if file already exists on disk and was modified more recently than DB record
        if (fs.existsSync(fullPath)) {
          const fileStat = fs.statSync(fullPath);
          const decisionTimestamp = new Date(
            decision.updatedAt || decision.createdAt,
          ).getTime();
          // If file on disk is newer by >1s, preserve manual edits and do not overwrite
          if (fileStat.mtimeMs > decisionTimestamp + 1000) {
            this.logger.log(
              `Preserving newer disk file ${relPath} (mtime ${new Date(fileStat.mtimeMs).toISOString()} > db ${new Date(decisionTimestamp).toISOString()})`,
            );
            syncedFiles.push(relPath);
            continue;
          }
        }

        fs.writeFileSync(fullPath, markdown, "utf-8");
        await this.projectAdrToSourceRecord(
          repositoryId,
          identifier,
          decision.title,
          markdown,
          relPath,
          new Date(decision.reviewedAt || decision.createdAt),
          decision.id,
          decision.reviewerName,
        );

        syncedFiles.push(relPath);
        exportedCount++;
      } catch (err) {
        errors.push(
          `Failed exporting decision ${decision.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      totalFilesScanned: decisions.length,
      exportedCount,
      importedCount: 0,
      syncedFiles,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Ingests existing /docs/adr/*.md files from disk into EngineeringDecision and SourceRecord models.
   */
  async importAdrsFromDocs(
    workspaceId: string,
    repositoryId: string,
    options?: SyncAdrsDto,
  ): Promise<AdrSyncResultDto> {
    await this.verifyRepository(workspaceId, repositoryId);
    const { repoRoot, adrDir, relativeDir } = this.resolveAdrDirectory(
      options?.adrDirectory,
    );

    const candidateDirs = [adrDir];
    // Fallback to docs/architecture/ADRs if docs/adr does not exist or is empty
    const altDir = path.resolve(repoRoot, "docs/architecture/ADRs");
    if (!fs.existsSync(adrDir) && fs.existsSync(altDir)) {
      candidateDirs.push(altDir);
    }

    const filesToProcess: Array<{ fullPath: string; relPath: string }> = [];

    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
        for (const f of files) {
          filesToProcess.push({
            fullPath: path.join(dir, f),
            relPath: path.relative(repoRoot, path.join(dir, f)),
          });
        }
      }
    }

    const syncedFiles: string[] = [];
    const errors: string[] = [];
    let importedCount = 0;

    for (const item of filesToProcess) {
      try {
        const content = fs.readFileSync(item.fullPath, "utf-8");
        const parsed = parseAdrMarkdownToDecision(content);

        // Check if decision with same title or matching identifier already exists
        const existing = await this.prisma.engineeringDecision.findFirst({
          where: {
            workspaceId,
            repositoryId,
            OR: [
              { title: parsed.title },
              parsed.createdFromClaimId
                ? { createdFromClaimId: parsed.createdFromClaimId }
                : {},
            ],
          },
        });

        const fileStat = fs.statSync(item.fullPath);
        const fileMtime = fileStat.mtimeMs;

        let savedRecord: any;
        if (existing) {
          const dbTimestamp = new Date(
            existing.updatedAt || existing.createdAt,
          ).getTime();
          // Conflict resolution: If DB record was modified more recently than disk file by >1s, preserve DB record
          if (dbTimestamp > fileMtime + 1000) {
            this.logger.log(
              `Preserving newer database record for "${existing.title}" (db ${new Date(dbTimestamp).toISOString()} > file ${new Date(fileMtime).toISOString()})`,
            );
            syncedFiles.push(item.relPath);
            importedCount++;
            continue;
          }

          savedRecord = await this.prisma.engineeringDecision.update({
            where: { id: existing.id },
            data: {
              summary: parsed.summary,
              decision: parsed.decision,
              rationale: parsed.rationale,
              status: parsed.status as any,
              severity: parsed.severity as any,
              targetFilePath: parsed.targetFilePath || existing.targetFilePath,
              targetSymbol: parsed.targetSymbol || existing.targetSymbol,
              reviewNotes: parsed.reviewNotes || existing.reviewNotes,
              supportingEvidence:
                parsed.supportingEvidence.length > 0
                  ? (parsed.supportingEvidence as any)
                  : existing.supportingEvidence,
            },
          });
        } else {
          savedRecord = await this.prisma.engineeringDecision.create({
            data: {
              workspaceId,
              repositoryId,
              title: parsed.title,
              summary: parsed.summary,
              decision: parsed.decision,
              rationale: parsed.rationale,
              status: parsed.status as any,
              severity: parsed.severity as any,
              targetFilePath: parsed.targetFilePath || null,
              targetSymbol: parsed.targetSymbol || null,
              reviewNotes: parsed.reviewNotes || null,
              supportingEvidence: (parsed.supportingEvidence as any) || [],
              reviewerName: parsed.reviewerName || "ADR Importer",
              reviewedAt: parsed.reviewedAt
                ? new Date(parsed.reviewedAt)
                : new Date(),
              createdFromClaimId: parsed.createdFromClaimId || null,
            },
          });
        }

        // Project into SourceRecords
        await this.projectAdrToSourceRecord(
          repositoryId,
          parsed.identifier || "ADR",
          parsed.title,
          content,
          item.relPath,
          new Date(),
          savedRecord.id,
          savedRecord.reviewerName,
        );

        syncedFiles.push(item.relPath);
        importedCount++;
      } catch (err) {
        errors.push(
          `Failed importing ${item.relPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      totalFilesScanned: filesToProcess.length,
      exportedCount: 0,
      importedCount,
      syncedFiles,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Executes bidirectional synchronization between PostgreSQL Decision records and /docs/adr/*.md.
   */
  async syncAdrsBidirectional(
    workspaceId: string,
    repositoryId: string,
    options?: SyncAdrsDto,
  ): Promise<AdrSyncResultDto> {
    const direction = options?.direction || "BIDIRECTIONAL";

    let importedResult: AdrSyncResultDto = {
      totalFilesScanned: 0,
      exportedCount: 0,
      importedCount: 0,
      syncedFiles: [],
      timestamp: new Date().toISOString(),
    };

    let exportedResult: AdrSyncResultDto = {
      totalFilesScanned: 0,
      exportedCount: 0,
      importedCount: 0,
      syncedFiles: [],
      timestamp: new Date().toISOString(),
    };

    if (direction === "IMPORT" || direction === "BIDIRECTIONAL") {
      importedResult = await this.importAdrsFromDocs(
        workspaceId,
        repositoryId,
        options,
      );
    }

    if (direction === "EXPORT" || direction === "BIDIRECTIONAL") {
      exportedResult = await this.exportAllDecisionsToAdrs(
        workspaceId,
        repositoryId,
        options,
      );
    }

    const combinedFiles = Array.from(
      new Set([...importedResult.syncedFiles, ...exportedResult.syncedFiles]),
    );
    const combinedErrors = [
      ...(importedResult.errors || []),
      ...(exportedResult.errors || []),
    ];

    return {
      totalFilesScanned:
        importedResult.totalFilesScanned + exportedResult.totalFilesScanned,
      exportedCount: exportedResult.exportedCount,
      importedCount: importedResult.importedCount,
      syncedFiles: combinedFiles,
      errors: combinedErrors.length > 0 ? combinedErrors : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private mapDecisionToDto(record: any): EngineeringDecisionDto {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      repositoryId: record.repositoryId,
      title: record.title,
      summary: record.summary,
      decision: record.decision,
      rationale: record.rationale,
      targetFilePath: record.targetFilePath,
      targetSymbol: record.targetSymbol,
      status: record.status as DecisionStatus,
      severity: record.severity as DecisionSeverity,
      supportingEvidence:
        (record.supportingEvidence as EvidenceReference[]) || [],
      relatedCommitSha: record.relatedCommitSha,
      relatedPrNumber: record.relatedPrNumber,
      reviewerId: record.reviewerId,
      reviewerName: record.reviewerName,
      reviewNotes: record.reviewNotes,
      reviewedAt: record.reviewedAt ? record.reviewedAt.toISOString() : null,
      supersedesId: record.supersedesId,
      supersededById: record.supersededById,
      createdFromClaimId: record.createdFromClaimId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
