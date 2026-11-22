import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";
import { CalibrationService } from "./calibration.service";
import { WorkspaceCalibrationDto } from "@traceback/shared-types";

@Controller("workspaces/:workspaceId/calibration")
@UseGuards(AuthGuard, WorkspaceGuard)
export class CalibrationController {
  constructor(private readonly calibrationService: CalibrationService) {}

  @Get()
  async getCalibration(
    @Param("workspaceId") workspaceId: string,
  ): Promise<WorkspaceCalibrationDto> {
    return this.calibrationService.getWorkspaceCalibration(workspaceId);
  }
}
