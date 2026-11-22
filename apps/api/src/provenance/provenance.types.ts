import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export type ProvenanceNodeType =
  "ISSUE" | "PR" | "COMMIT" | "DECISION" | "REFACTOR" | "SUPERSEDED_DECISION";

export type ProvenanceEdgeRelation =
  | "MOTIVATED"
  | "INCLUDES"
  | "INTRODUCED"
  | "EVIDENCES"
  | "GOVERNS"
  | "REFACTORED"
  | "SUPERSEDES"
  | "PRECEDED_BY";

export interface ImmutableProvenanceDto {
  sourceType: string;
  referenceId: string;
  url?: string;
  shortHash?: string;
}

export interface ProvenanceNodeDto {
  id: string;
  type: ProvenanceNodeType;
  stageOrder: number; // 1: Origin, 2: Implementation, 3: Decision Memory, 4: Evolution
  timestamp: string; // ISO-8601
  title: string;
  summary: string;
  author?: string;
  status?: string;
  filePaths: string[];
  immutableProvenance: ImmutableProvenanceDto;
  metadata?: Record<string, unknown>;
}

export interface ProvenanceEdgeDto {
  id: string;
  source: string;
  target: string;
  relation: ProvenanceEdgeRelation;
  label: string;
}

export interface ProvenanceSummaryDto {
  totalNodes: number;
  countsByType: Record<string, number>;
  earliestTimestamp?: string;
  latestTimestamp?: string;
}

export interface ProvenanceRepositoryRefDto {
  id: string;
  name: string;
  fullName: string;
  htmlUrl?: string;
}

export interface ProvenanceTimelineResponse {
  repository: ProvenanceRepositoryRefDto;
  query: {
    filePath?: string;
    symbol?: string;
    decisionId?: string;
  };
  dataSource: "neo4j" | "postgres_fallback";
  neo4jConnected: boolean;
  insufficientHistory: boolean;
  abstentionReason?: string;
  nodes: ProvenanceNodeDto[];
  edges: ProvenanceEdgeDto[];
  summary: ProvenanceSummaryDto;
}

export interface ProvenanceTargetsResponse {
  repository: ProvenanceRepositoryRefDto;
  files: Array<{
    path: string;
    eventCount: number;
  }>;
  decisions: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    targetFilePath?: string;
  }>;
  neo4jStatus: {
    configured: boolean;
    connected: boolean;
  };
}

export interface ProvenanceSyncResponse {
  repositoryId: string;
  synced: boolean;
  neo4jConnected: boolean;
  message: string;
  nodesSynced?: number;
  edgesSynced?: number;
  nodesCount?: number;
  edgesCount?: number;
  syncedAt?: string;
  durationMs?: number;
}

export class ProvenanceTimelineQueryDto {
  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  decisionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(150)
  limit?: number = 50;
}
