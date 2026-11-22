import {
  Controller,
  Post,
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
import { DecisionPromotionService } from "./decision-promotion.service";
import { PromoteClaimToDecisionDto } from "./decision-promotion.dto";
import { PromoteClaimToDecisionResponse } from "@traceback/shared-types";

@Controller("workspaces/:workspaceId/decisions")
@UseGuards(AuthGuard, WorkspaceGuard)
export class DecisionPromotionController {
  constructor(
    private readonly decisionPromotionService: DecisionPromotionService,
  ) {}

  @Post("promote-from-verification")
  @HttpCode(HttpStatus.CREATED)
  async promoteClaimToDecision(
    @Param("workspaceId") workspaceId: string,
    @Body() dto: PromoteClaimToDecisionDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<PromoteClaimToDecisionResponse> {
    return this.decisionPromotionService.promoteToDecision(
      workspaceId,
      dto,
      user,
    );
  }
}
