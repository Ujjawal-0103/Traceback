import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CodeExplainerService } from "./code-explainer.service";
import {
  ExplainCodeRequestDto,
  ExplainCodeResponseDto,
  ExplainCodeTargetsResponse,
} from "./code-explainer.dto";

@Controller("workspaces/:workspaceId/repositories/:repositoryId/explain-code")
@UseGuards(AuthGuard, WorkspaceGuard)
export class CodeExplainerController {
  constructor(private readonly codeExplainerService: CodeExplainerService) {}

  /**
   * Returns indexed selectable target file paths and recent decisions
   * so developers can quickly pick a real target without typing paths.
   */
  @Get("targets")
  async getTargets(
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
  ): Promise<ExplainCodeTargetsResponse> {
    return this.codeExplainerService.getTargets(workspaceId, repositoryId);
  }

  /**
   * Evidence-first "Explain & Verify" endpoint:
   * Retrieves historical commits/PRs/issues/decisions, generates an evidence-grounded
   * explanation (or explicitly abstains), and runs end-to-end claim extraction and verification.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async explainCode(
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Body() dto: ExplainCodeRequestDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ExplainCodeResponseDto> {
    return this.codeExplainerService.explainCode(
      workspaceId,
      repositoryId,
      user?.id,
      dto,
    );
  }
}
