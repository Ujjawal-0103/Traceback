import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { configuration } from "./config/configuration";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { GitHubModule } from "./github/github.module";
import { IngestionQueueModule } from "./ingestion/ingestion-queue.module";
import { EvidenceModule } from "./evidence/evidence.module";
import { RepositoriesModule } from "./repositories/repositories.module";
import { AuthModule } from "./auth/auth.module";
import { VerificationModule } from "./verification/verification.module";
import { AdvisoryModule } from "./advisory/advisory.module";
import { DecisionsModule } from "./decisions/decisions.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { DecisionPromotionModule } from "./decision-promotion/decision-promotion.module";
import { AdrSyncModule } from "./adr-sync/adr-sync.module";
import { ProvenanceModule } from "./provenance/provenance.module";
import { CodeExplainerModule } from "./code-explainer/code-explainer.module";
import { CalibrationModule } from "./calibration/calibration.module";

import * as path from "path";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "apps/api/.env"),
        path.resolve(__dirname, "../../.env"),
        path.resolve(__dirname, "../.env"),
      ],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    GitHubModule,
    IngestionQueueModule,
    EvidenceModule,
    RepositoriesModule,
    VerificationModule,
    AdvisoryModule,
    DecisionsModule,
    TelemetryModule,
    DecisionPromotionModule,
    AdrSyncModule,
    ProvenanceModule,
    CodeExplainerModule,
    CalibrationModule,
  ],
})
export class AppModule {}
