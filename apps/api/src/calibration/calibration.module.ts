import { Module } from "@nestjs/common";
import { CalibrationController } from "./calibration.controller";
import { CalibrationService } from "./calibration.service";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule],
  controllers: [CalibrationController],
  providers: [CalibrationService],
  exports: [CalibrationService],
})
export class CalibrationModule {}
