import { WorkspaceCalibrationDto } from "@traceback/shared-types";
import { api } from "./api";

export async function fetchWorkspaceCalibration(
  workspaceId: string,
): Promise<WorkspaceCalibrationDto> {
  return api.getWorkspaceCalibration(workspaceId);
}
