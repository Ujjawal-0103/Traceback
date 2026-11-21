import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdrMarkdownMapper } from "./adr-markdown.mapper";
import { ImportAdrDto, ExportAdrDto, ListAdrFilesDto } from "./adr-sync.dto";
import {
  AdrFileSummary,
  AdrSyncImportResponse,
  AdrSyncExportResponse,
  DecisionStatus,
  EngineeringDecisionDto,
  EvidenceReference,
} from "@traceback/shared-types";
import * as fs from "fs/promises";
import * as path from "path";

@Injectable()
export class AdrSyncService {
  private readonly logger = new Logger(AdrSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves repository root directory cleanly regardless of cwd
   * (e.g. running from root or apps/api).
   */
  getRepoRoot(): string {
    let current = path.resolve(process.cwd());
    for (let i = 0; i < 4; i++) {
      try {
        const pkgPath = path.join(current, "package.json");
        // Check if package.json has traceback or workspaces
        if (path.basename(current).toLowerCase() === "traceback") {
          return current;
        }
      } catch {
        // continue
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return path.resolve(process.cwd());
  }

  formatDisplayPath(fullPath: string): string {
    const repoRoot = this.getRepoRoot();
    return fullPath.startsWith(repoRoot)
      ? path.relative(repoRoot, fullPath).replace(/\\/g, "/")
      : fullPath.replace(/\\/g, "/");
  }

  /**
   * Resolves the canonical ADR directory:
   * Defaults to `<repoRoot>/docs/adr`.
   * If `docs/adr` does not exist or has no markdown files, checks `<repoRoot>/docs/architecture/ADRs`.
   */
  async resolveAdrDirectory(customDir?: string): Promise<string> {
    if (customDir) {
      return path.resolve(customDir);
    }

    const repoRoot = this.getRepoRoot();
    const defaultAdr = path.join(repoRoot, "docs", "adr");
    const fallbackAdr = path.join(repoRoot, "docs", "architecture", "ADRs");

    try {
      const stats = await fs.stat(defaultAdr);
      if (stats.isDirectory()) {
        const entries = await fs.readdir(defaultAdr);
        if (entries.some((e) => e.toLowerCase().endsWith(".md"))) {
          return defaultAdr;
        }
      }
    } catch {
      // defaultAdr does not exist yet
    }

    // Check if docs/architecture/ADRs has existing ADR files
    try {
      const fallbackStats = await fs.stat(fallbackAdr);
      if (fallbackStats.isDirectory()) {
        const fallbackEntries = await fs.readdir(fallbackAdr);
        if (fallbackEntries.some((e) => e.toLowerCase().endsWith(".md"))) {
          return fallbackAdr;
        }
      }
    } catch {
      // fallback doesn't exist
    }

    return defaultAdr;
  }

  /**
   * Strict path traversal guard:
   * Asserts that target file resolves strictly inside baseDir and ends with .md.
   */
  validatePath(baseDir: string, targetFile: string): string {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(resolvedBase, targetFile);

    // Reject traversal outside baseDir
    if (
      !resolvedTarget.startsWith(resolvedBase + path.sep) &&
      resolvedTarget !== resolvedBase
    ) {
      throw new BadRequestException(
        `Path traversal detected: "${targetFile}" attempts to escape allowed directory "${baseDir}".`,
      );
    }

    // Reject non-markdown files
    if (!resolvedTarget.toLowerCase().endsWith(".md")) {
      throw new BadRequestException(
        `Invalid file extension: Only Markdown (.md) files are permitted. Target: "${targetFile}".`,
      );
    }

    return resolvedTarget;
  }

  /**
   * Lists all ADR files in the resolved ADR directory, parses metadata,
   * and cross-references them against existing PostgreSQL engineering decisions.
   */
  async listFiles(
    workspaceId: string,
    query?: ListAdrFilesDto,
  ): Promise<AdrFileSummary[]> {
    const adrDir = await this.resolveAdrDirectory(query?.targetDir);

    let entries: string[] = [];
    try {
      entries = await fs.readdir(adrDir);
    } catch {
      return [];
    }

    const mdFiles = entries.filter((e) => e.toLowerCase().endsWith(".md"));
    if (mdFiles.length === 0) return [];

    // Fetch existing decisions in the workspace to cross-reference
    const existingDecisions = await this.prisma.engineeringDecision.findMany({
      where: {
        workspaceId,
        ...(query?.repositoryId ? { repositoryId: query.repositoryId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    const summaries: AdrFileSummary[] = [];

    for (const fileName of mdFiles) {
      try {
        const filePath = this.validatePath(adrDir, fileName);
        const content = await fs.readFile(filePath, "utf8");
        const parsed = AdrMarkdownMapper.parse(content, fileName);

        // Match against database decisions by title or ADR identifier
        const matched = existingDecisions.find((d) => {
          const dTitleLower = d.title.toLowerCase();
          const pTitleLower = parsed.title.toLowerCase();
          if (dTitleLower === pTitleLower) return true;
          if (
            parsed.identifier &&
            (dTitleLower.includes(parsed.identifier.toLowerCase()) ||
              d.title.includes(parsed.identifier))
          ) {
            return true;
          }
          return false;
        });

        summaries.push({
          fileName,
          filePath: this.formatDisplayPath(filePath),
          title: parsed.title,
          identifier: parsed.identifier,
          status: parsed.status,
          date: parsed.date,
          existsInDatabase: !!matched,
          matchedDecisionId: matched?.id || null,
          matchedDecisionStatus: (matched?.status as DecisionStatus) || null,
        });
      } catch (err: any) {
        this.logger.warn(
          `Failed to parse ADR file ${fileName}: ${err.message}`,
        );
      }
    }

    return summaries.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  /**
   * Imports and upserts ADR Markdown files into PostgreSQL for the workspace.
   */
  async importAdrs(
    workspaceId: string,
    dto?: ImportAdrDto,
  ): Promise<AdrSyncImportResponse> {
    const adrDir = await this.resolveAdrDirectory(dto?.targetDir);

    // Resolve target repository in workspace
    const repoWhere: any = { workspaceId };
    if (dto?.repositoryId) {
      repoWhere.id = dto.repositoryId;
    }
    const repository = await this.prisma.repository.findFirst({
      where: repoWhere,
    });

    if (!repository) {
      throw new NotFoundException(
        `Repository ${dto?.repositoryId || "default"} not found in workspace ${workspaceId}.`,
      );
    }

    let entries: string[] = [];
    try {
      entries = await fs.readdir(adrDir);
    } catch {
      throw new NotFoundException(`ADR directory not found at: ${adrDir}`);
    }

    const mdFiles = entries.filter((e) => e.toLowerCase().endsWith(".md"));

    const existingDecisions = await this.prisma.engineeringDecision.findMany({
      where: {
        workspaceId,
        repositoryId: repository.id,
      },
    });

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const fileSummaries: AdrFileSummary[] = [];
    const activeDecisions: EngineeringDecisionDto[] = [];

    for (const fileName of mdFiles) {
      try {
        const filePath = this.validatePath(adrDir, fileName);
        const content = await fs.readFile(filePath, "utf8");
        const parsed = AdrMarkdownMapper.parse(content, fileName);

        // Find existing match by title or identifier
        const existing = existingDecisions.find((d) => {
          const dTitleLower = d.title.toLowerCase();
          const pTitleLower = parsed.title.toLowerCase();
          if (dTitleLower === pTitleLower) return true;
          if (
            parsed.identifier &&
            (dTitleLower.includes(parsed.identifier.toLowerCase()) ||
              d.title.includes(parsed.identifier))
          ) {
            return true;
          }
          return false;
        });

        if (existing) {
          if (dto?.overwriteExisting) {
            const updated = await this.prisma.engineeringDecision.update({
              where: { id: existing.id },
              data: {
                summary: parsed.summary,
                decision: parsed.decision,
                rationale: parsed.rationale,
                status: parsed.status,
                severity: parsed.severity,
                targetFilePath:
                  parsed.targetFilePath || existing.targetFilePath,
                targetSymbol: parsed.targetSymbol || existing.targetSymbol,
                relatedCommitSha:
                  parsed.relatedCommitSha || existing.relatedCommitSha,
                relatedPrNumber:
                  parsed.relatedPrNumber || existing.relatedPrNumber,
              },
            });
            updatedCount++;
            activeDecisions.push(this.mapToDto(updated));
            fileSummaries.push({
              fileName,
              filePath: this.formatDisplayPath(filePath),
              title: parsed.title,
              identifier: parsed.identifier,
              status: parsed.status,
              date: parsed.date,
              existsInDatabase: true,
              matchedDecisionId: updated.id,
              matchedDecisionStatus: updated.status as DecisionStatus,
            });
          } else {
            skippedCount++;
            activeDecisions.push(this.mapToDto(existing));
            fileSummaries.push({
              fileName,
              filePath: this.formatDisplayPath(filePath),
              title: parsed.title,
              identifier: parsed.identifier,
              status: parsed.status,
              date: parsed.date,
              existsInDatabase: true,
              matchedDecisionId: existing.id,
              matchedDecisionStatus: existing.status as DecisionStatus,
            });
          }
        } else {
          // Create new EngineeringDecision in database
          const created = await this.prisma.engineeringDecision.create({
            data: {
              workspaceId,
              repositoryId: repository.id,
              title: parsed.identifier
                ? `${parsed.identifier}: ${parsed.title}`
                : parsed.title,
              summary: parsed.summary,
              decision: parsed.decision,
              rationale: parsed.rationale,
              status: parsed.status,
              severity: parsed.severity,
              targetFilePath: parsed.targetFilePath || null,
              targetSymbol: parsed.targetSymbol || null,
              supportingEvidence: (parsed.supportingEvidence as any) || [],
              relatedCommitSha: parsed.relatedCommitSha || null,
              relatedPrNumber: parsed.relatedPrNumber || null,
              reviewerName: parsed.reviewerName || null,
              reviewedAt: parsed.reviewedAt
                ? new Date(parsed.reviewedAt)
                : null,
            },
          });
          importedCount++;
          activeDecisions.push(this.mapToDto(created));
          fileSummaries.push({
            fileName,
            filePath: this.formatDisplayPath(filePath),
            title: parsed.title,
            identifier: parsed.identifier,
            status: parsed.status,
            date: parsed.date,
            existsInDatabase: true,
            matchedDecisionId: created.id,
            matchedDecisionStatus: created.status as DecisionStatus,
          });
        }
      } catch (err: any) {
        this.logger.error(`Error importing ADR ${fileName}: ${err.message}`);
      }
    }

    this.logger.log(
      `ADR Sync Import complete: ${importedCount} imported, ${updatedCount} updated, ${skippedCount} skipped.`,
    );

    return {
      workspaceId,
      repositoryId: repository.id,
      totalFilesScanned: mdFiles.length,
      importedCount,
      updatedCount,
      skippedCount,
      decisions: activeDecisions,
      files: fileSummaries,
    };
  }

  /**
   * Serializes an existing Engineering Decision into deterministic ADR Markdown
   * and writes it to `<repoRoot>/docs/adr/ADR-<slug>.md` (creating directory if missing).
   */
  async exportDecision(
    workspaceId: string,
    decisionId: string,
    dto?: ExportAdrDto,
  ): Promise<AdrSyncExportResponse> {
    const decision = await this.prisma.engineeringDecision.findFirst({
      where: {
        id: decisionId,
        workspaceId,
        ...(dto?.repositoryId ? { repositoryId: dto.repositoryId } : {}),
      },
    });

    if (!decision) {
      throw new NotFoundException(
        `Engineering decision ${decisionId} not found in workspace ${workspaceId}.`,
      );
    }

    // Target export directory is strictly <repoRoot>/docs/adr (or safe custom dir)
    const repoRoot = this.getRepoRoot();
    const adrDir = dto?.targetDir
      ? path.resolve(dto.targetDir)
      : path.join(repoRoot, "docs", "adr");

    // Ensure directory exists
    await fs.mkdir(adrDir, { recursive: true });

    // Generate filename and validate with path traversal guard
    const rawSlug = dto?.customSlug || AdrMarkdownMapper.generateSlug(decision);
    const fileName = `ADR-${rawSlug}.md`;
    const targetFilePath = this.validatePath(adrDir, fileName);

    // Serialize Markdown content
    const markdownContent = AdrMarkdownMapper.serialize({
      id: decision.id,
      title: decision.title,
      summary: decision.summary,
      decision: decision.decision,
      rationale: decision.rationale,
      status: decision.status as DecisionStatus,
      severity: decision.severity as any,
      targetFilePath: decision.targetFilePath,
      targetSymbol: decision.targetSymbol,
      relatedCommitSha: decision.relatedCommitSha,
      relatedPrNumber: decision.relatedPrNumber,
      supportingEvidence: decision.supportingEvidence,
      reviewerName: decision.reviewerName,
      reviewedAt: decision.reviewedAt,
      createdAt: decision.createdAt,
    });

    await fs.writeFile(targetFilePath, markdownContent, "utf8");
    const writtenBytes = Buffer.byteLength(markdownContent, "utf8");

    this.logger.log(
      `Exported decision ${decision.id} to ${targetFilePath} (${writtenBytes} bytes)`,
    );

    return {
      decisionId: decision.id,
      fileName,
      filePath: this.formatDisplayPath(targetFilePath),
      status: decision.status as DecisionStatus,
      title: decision.title,
      writtenBytes,
      content: markdownContent,
    };
  }

  private mapToDto(record: any): EngineeringDecisionDto {
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
      severity: record.severity as any,
      supportingEvidence:
        (record.supportingEvidence as unknown as EvidenceReference[]) || [],
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
