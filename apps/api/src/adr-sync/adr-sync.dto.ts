import { IsString, IsOptional, IsBoolean } from "class-validator";

export class ImportAdrDto {
  @IsOptional()
  @IsString()
  repositoryId?: string;

  @IsOptional()
  @IsString()
  targetDir?: string;

  @IsOptional()
  @IsBoolean()
  overwriteExisting?: boolean;
}

export class ExportAdrDto {
  @IsOptional()
  @IsString()
  repositoryId?: string;

  @IsOptional()
  @IsString()
  customSlug?: string;

  @IsOptional()
  @IsString()
  targetDir?: string;
}

export class ListAdrFilesDto {
  @IsOptional()
  @IsString()
  repositoryId?: string;

  @IsOptional()
  @IsString()
  targetDir?: string;
}
