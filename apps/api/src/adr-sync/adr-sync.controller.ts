import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";
import { AdrSyncService } from "./adr-sync.service";
import { ImportAdrDto, ExportAdrDto, ListAdrFilesDto } from "./adr-sync.dto";
import {
  AdrFileSummary,
  AdrSyncImportResponse,
  AdrSyncExportResponse,
} from "@traceback/shared-types";

@Controller("workspaces/:workspaceId/adr-sync")
@UseGuards(AuthGuard, WorkspaceGuard)
export class AdrSyncController {
  constructor(private readonly adrSyncService: AdrSyncService) {}

  /**
   * Lists .md files in the local ADR directory, parses their metadata,
   * and reports whether a matching decision exists in PostgreSQL.
   */
  @Get("files")
  async listFiles(
    @Param("workspaceId") workspaceId: string,
    @Query() query?: ListAdrFilesDto,
  ): Promise<AdrFileSummary[]> {
    return this.adrSyncService.listFiles(workspaceId, query);
  }

  /**
   * Reads local ADR files, parses frontmatter and markdown sections,
   * and upserts/imports missing decisions into PostgreSQL for the workspace.
   */
  @Post("import")
  @HttpCode(HttpStatus.OK)
  async importAdrs(
    @Param("workspaceId") workspaceId: string,
    @Body() dto?: ImportAdrDto,
  ): Promise<AdrSyncImportResponse> {
    return this.adrSyncService.importAdrs(workspaceId, dto);
  }

  /**
   * Serializes a workspace Engineering Decision into clean, deterministic
   * ADR Markdown and writes it to `<repoRoot>/docs/adr/ADR-<slug>.md`.
   */
  @Post("export/:decisionId")
  @HttpCode(HttpStatus.CREATED)
  async exportDecision(
    @Param("workspaceId") workspaceId: string,
    @Param("decisionId") decisionId: string,
    @Body() dto?: ExportAdrDto,
  ): Promise<AdrSyncExportResponse> {
    return this.adrSyncService.exportDecision(workspaceId, decisionId, dto);
  }
}
