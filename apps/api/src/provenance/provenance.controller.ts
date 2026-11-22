import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProvenanceService } from "./provenance.service";
import { ProvenanceGraphSyncService } from "./provenance-graph-sync.service";
import {
  ProvenanceTimelineQueryDto,
  ProvenanceTimelineResponse,
  ProvenanceTargetsResponse,
  ProvenanceSyncResponse,
} from "./provenance.types";
import { PrismaService } from "../prisma/prisma.service";

@Controller("provenance")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ProvenanceController {
  constructor(
    private readonly provenanceService: ProvenanceService,
    private readonly syncService: ProvenanceGraphSyncService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveWorkspaceId(
    repositoryId: string,
    headerWorkspaceId?: string,
    queryWorkspaceId?: string,
  ): Promise<string> {
    if (headerWorkspaceId?.trim()) return headerWorkspaceId.trim();
    if (queryWorkspaceId?.trim()) return queryWorkspaceId.trim();

    // Look up repository's workspace
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { workspaceId: true },
    });
    if (!repo) {
      throw new BadRequestException(`Repository ${repositoryId} not found`);
    }
    return repo.workspaceId;
  }

  @Get("repositories/:repositoryId/targets")
  async getTargets(
    @Param("repositoryId") repositoryId: string,
    @Headers("x-workspace-id") headerWorkspaceId?: string,
    @Query("workspaceId") queryWorkspaceId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ProvenanceTargetsResponse> {
    const workspaceId = await this.resolveWorkspaceId(
      repositoryId,
      headerWorkspaceId,
      queryWorkspaceId,
    );
    return this.provenanceService.getTargets(
      workspaceId,
      repositoryId,
      user?.id,
    );
  }

  @Post([
    "repositories/:repositoryId/sync-graph",
    "repositories/:repositoryId/sync",
  ])
  @HttpCode(HttpStatus.OK)
  async syncGraph(
    @Param("repositoryId") repositoryId: string,
    @Headers("x-workspace-id") headerWorkspaceId?: string,
    @Query("workspaceId") queryWorkspaceId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ProvenanceSyncResponse> {
    const workspaceId = await this.resolveWorkspaceId(
      repositoryId,
      headerWorkspaceId,
      queryWorkspaceId,
    );
    // Verify access first
    await this.provenanceService.verifyRepositoryAccess(
      workspaceId,
      repositoryId,
      user?.id,
    );
    return this.syncService.syncProvenanceGraph(workspaceId, repositoryId);
  }

  @Get("repositories/:repositoryId/timeline")
  async getTimeline(
    @Param("repositoryId") repositoryId: string,
    @Query() query: ProvenanceTimelineQueryDto,
    @Headers("x-workspace-id") headerWorkspaceId?: string,
    @Query("workspaceId") queryWorkspaceId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ProvenanceTimelineResponse> {
    const workspaceId = await this.resolveWorkspaceId(
      repositoryId,
      headerWorkspaceId,
      queryWorkspaceId,
    );
    return this.provenanceService.getTimeline(
      workspaceId,
      repositoryId,
      query,
      user?.id,
    );
  }
}
