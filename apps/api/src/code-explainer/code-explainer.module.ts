import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { VerificationModule } from "../verification/verification.module";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CodeExplainerController } from "./code-explainer.controller";
import { CodeExplainerService } from "./code-explainer.service";

@Module({
  imports: [PrismaModule, VerificationModule, AuthModule, WorkspacesModule],
  controllers: [CodeExplainerController],
  providers: [CodeExplainerService],
  exports: [CodeExplainerService],
})
export class CodeExplainerModule {}
