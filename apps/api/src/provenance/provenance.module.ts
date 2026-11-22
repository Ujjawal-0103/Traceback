import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { EvidenceModule } from "../evidence/evidence.module";
import { ProvenanceController } from "./provenance.controller";
import { ProvenanceService } from "./provenance.service";
import { ProvenanceGraphSyncService } from "./provenance-graph-sync.service";

@Module({
  imports: [PrismaModule, WorkspacesModule, EvidenceModule, ConfigModule],
  controllers: [ProvenanceController],
  providers: [ProvenanceService, ProvenanceGraphSyncService],
  exports: [ProvenanceService, ProvenanceGraphSyncService],
})
export class ProvenanceModule {}
