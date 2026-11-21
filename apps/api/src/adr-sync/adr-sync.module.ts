import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AdrSyncController } from "./adr-sync.controller";
import { AdrSyncService } from "./adr-sync.service";
import { AdrMarkdownMapper } from "./adr-markdown.mapper";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule],
  controllers: [AdrSyncController],
  providers: [AdrSyncService, AdrMarkdownMapper],
  exports: [AdrSyncService, AdrMarkdownMapper],
})
export class AdrSyncModule {}
