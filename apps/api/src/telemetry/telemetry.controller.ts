import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";
import { TelemetryService } from "./telemetry.service";
import { CalibrationScorecardDto } from "@traceback/shared-types";

@Controller("workspaces/:workspaceId/telemetry")
@UseGuards(AuthGuard, WorkspaceGuard)
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * GET /api/workspaces/:workspaceId/telemetry/calibration
   * Returns AI Hallucination & Calibration Scorecard with Context Blind-Spot Map.
   */
  @Get("calibration")
  async getCalibrationScorecard(
    @Param("workspaceId") workspaceId: string,
  ): Promise<CalibrationScorecardDto> {
    return this.telemetryService.getCalibrationScorecard(workspaceId);
  }
}
