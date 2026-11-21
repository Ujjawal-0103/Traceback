import { IsString, IsNotEmpty, IsOptional, MaxLength } from "class-validator";
import {
  PromoteClaimToDecisionRequest,
  DecisionSeverity,
} from "@traceback/shared-types";

export class PromoteClaimToDecisionDto implements PromoteClaimToDecisionRequest {
  @IsOptional()
  @IsString()
  claimId?: string;

  @IsOptional()
  @IsString()
  verificationSessionId?: string;

  @IsString()
  @IsNotEmpty()
  repositoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  decision?: string;

  @IsOptional()
  @IsString()
  rationale?: string;

  @IsOptional()
  @IsString()
  severity?: DecisionSeverity;

  @IsOptional()
  @IsString()
  targetFilePath?: string;

  @IsOptional()
  @IsString()
  targetSymbol?: string;
}
