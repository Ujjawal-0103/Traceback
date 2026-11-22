import { Module, forwardRef } from "@nestjs/common";
import { TelemetryController } from "./telemetry.controller";
import { TelemetryService } from "./telemetry.service";
import { PrismaModule } from "../prisma/prisma.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => WorkspacesModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [TelemetryController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
