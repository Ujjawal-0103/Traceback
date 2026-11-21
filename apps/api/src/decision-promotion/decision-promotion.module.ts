import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DecisionPromotionController } from "./decision-promotion.controller";
import { DecisionPromotionService } from "./decision-promotion.service";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule],
  controllers: [DecisionPromotionController],
  providers: [DecisionPromotionService],
  exports: [DecisionPromotionService],
})
export class DecisionPromotionModule {}
