import { IsString, IsOptional, MaxLength, ValidateIf } from "class-validator";

export class ExplainCodeRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  filePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  codeSnippet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  question?: string;
}

export interface ExplainCodeTargetItem {
  filePath: string;
  activityCount: number;
  lastCommittedAt?: string;
  relatedDecisionCount: number;
}

export interface ExplainCodeTargetsResponse {
  repositoryId: string;
  targets: ExplainCodeTargetItem[];
  recentDecisions: Array<{
    id: string;
    title: string;
    targetFilePath?: string;
    status: string;
  }>;
}

export interface ExplanationBreakdownDto {
  summary: string;
  whatCodeDoes?: string;
  whyItWasBuilt: string;
  howItWasImplemented: string;
  governingConstraints: string[];
  evolutionSummary?: string;
  cautionBeforeEditing: string;
}

export interface ExplainCodeResponseDto {
  repositoryId: string;
  target: {
    filePath?: string;
    symbol?: string;
    question?: string;
  };
  insufficientHistory: boolean;
  abstentionReason?: string;
  synthesisMode: "ai_grounded" | "deterministic_grounded" | "abstained";
  generatedExplanation: string;
  explanationBreakdown?: ExplanationBreakdownDto;
  evidenceSummary: {
    commits: number;
    pullRequests: number;
    issues: number;
    decisions: number;
    totalSources: number;
  };
  verificationSession: any | null;
}
