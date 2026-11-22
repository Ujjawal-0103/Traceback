/**
 * Traceback Shared Domain Contracts
 * Single source of truth for cross-boundary types between frontend and backend.
 */

// 1. Core Verification & Epistemological Enums
export type HumanVerdict = "SUPPORTED" | "CONTRADICTED" | "UNVERIFIED";

export type AIAssessmentConfidence =
  "HIGH_SUPPORT" | "PARTIAL_SUPPORT" | "SPARSE_EVIDENCE" | "CONTRADICTED";

export type VerificationAssessmentStatus =
  "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE" | "MIXED";

export type EvidenceSourceType =
  "COMMIT" | "PULL_REQUEST" | "ISSUE" | "DOCUMENTATION" | "ADR";

// 2. Evidence & Provenance Contracts
export interface EvidenceReference {
  id: string;
  sourceType: EvidenceSourceType;
  referenceKey: string; // Commit SHA (e.g. 7f8a9b), PR # (e.g. #42), Issue #, or path
  title: string;
  author: string;
  timestamp: string; // ISO 8601 string
  url: string; // Verified clickable URL (e.g. https://github.com/org/repo/commit/...)
  snippet?: string; // Unified diff snippet or discussion excerpt
  filePath?: string;
  lineRange?: {
    start: number;
    end: number;
  };
}

export interface ClaimItem {
  id: string;
  text: string;
  targetSymbol?: string;
  preliminaryConfidence: AIAssessmentConfidence;
  structuredStatus?: VerificationAssessmentStatus;
  humanVerdict?: HumanVerdict;
  reviewNotes?: string;
  evidence: EvidenceReference[];
}

export interface VerifyExplanationRequest {
  explanation: string;
  codeSnippet?: string;
  targetFilePath?: string;
  targetSymbol?: string;
  maxClaims?: number;
}

export interface VerificationSession {
  id: string;
  workspaceId: string;
  repositoryId: string;
  explanation: string;
  codeSnippet?: string;
  targetFilePath?: string;
  claims: ClaimItem[];
  status: "PENDING" | "ANALYZING" | "REVIEWING" | "COMPLETED" | "FAILED";
  createdAt: string;
  updatedAt: string;
}

// 3. API Envelopes & Health Contracts
export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
}

export interface DependencyCheck {
  ready: boolean;
  message?: string;
  latencyMs?: number;
}

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: {
    database: DependencyCheck;
    config: DependencyCheck;
    [key: string]: DependencyCheck;
  };
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// 4. Workspace & Identity Boundaries
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface UserIdentity {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

export interface RepositorySummary {
  id: string;
  workspaceId: string;
  fullName: string; // e.g. "org/repo"
  defaultBranch: string;
  isPrivate: boolean;
  indexedAt?: string;
}

export interface RepositoryDetailsDto {
  id: string;
  workspaceId: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    commits: number;
    pullRequests: number;
    issues: number;
    sourceRecords: number;
  };
  latestSyncJob?: {
    id: string;
    status: string;
    trigger: string;
    commitsCount: number;
    pullRequestsCount: number;
    issuesCount: number;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  } | null;
}

export interface RepositoryActivityDto {
  repositoryId: string;
  fullName: string;
  commits: Array<{
    sha: string;
    message: string;
    authorName: string;
    committedAt: string;
    url: string;
  }>;
  pullRequests: Array<{
    number: number;
    title: string;
    author: string;
    state: string;
    isMerged: boolean;
    url: string;
    createdAt: string;
  }>;
  issues: Array<{
    number: number;
    title: string;
    author: string;
    state: string;
    url: string;
    createdAt: string;
  }>;
}

export interface CreateRepositoryDto {
  fullName: string;
  defaultBranch?: string;
  isPrivate?: boolean;
  installationId?: number;
}

export interface ImportRepositoryByUrlDto {
  url: string;
}

export interface ImportRepositoryByUrlResponse {
  repository: RepositoryDetailsDto;
  isAlreadyConnected: boolean;
  message: string;
}

export interface GitHubAuthorizedRepositoryDto {
  id: number;
  fullName: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  isPrivate: boolean;
  permissions: {
    contents?: string;
    issues?: string;
    pullRequests?: string;
  };
}

export interface GitHubInstallationSummaryDto {
  id: string;
  workspaceId: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  createdAt: string;
}

export interface GitHubIntegrationStatusDto {
  isConfigured: boolean;
  isMockMode: boolean;
  appSlug?: string;
  installation: GitHubInstallationSummaryDto | null;
  installUrl?: string;
}

export interface ConnectInstallationDto {
  installationId: number;
  state?: string;
}

// 5. Ingestion & Repository Sync Contracts
export type SyncStatus = "PENDING" | "SYNCING" | "COMPLETED" | "FAILED";
export type SyncTrigger = "MANUAL" | "WEBHOOK";

export interface SyncProgressCounts {
  commits: number;
  pullRequests: number;
  issues: number;
}

export interface RepositorySyncSummary {
  id: string;
  repositoryId: string;
  status: SyncStatus;
  trigger: SyncTrigger;
  counts: SyncProgressCounts;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface SyncProgress {
  jobId: string;
  repositoryId: string;
  status: SyncStatus;
  commitsCount: number;
  pullRequestsCount: number;
  issuesCount: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

export interface TriggerSyncRequest {
  trigger?: SyncTrigger;
}

export interface TriggerSyncResponse {
  jobId: string;
  repositoryId: string;
  status: SyncStatus;
  message: string;
}

export interface RepositorySyncStatusResponse {
  repositoryId: string;
  lastIndexedAt?: string;
  activeJob?: RepositorySyncSummary;
  recentJobs: RepositorySyncSummary[];
}

// 6. Evidence Store & Retrieval Contracts (Sprint 4)
export interface SourceRecordDto {
  id: string;
  repositoryId: string;
  sourceType: EvidenceSourceType;
  externalId: string;
  referenceKey: string;
  title: string;
  author: string;
  url: string;
  snippet?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  metadata?: Record<string, unknown>;
  recordedAt: string;
}

export interface EvidenceSearchQuery {
  query: string;
  sourceTypes?: EvidenceSourceType[];
  filePath?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  includeGraph?: boolean;
}

export type RetrievalMethod = "lexical" | "graph_expansion" | "hybrid";

export interface GraphProximitySignal {
  seedSourceId: string;
  relationship: string;
  depth: number;
}

export interface EvidenceSearchResultItem {
  source: SourceRecordDto;
  score: number;
  retrievalMethod: RetrievalMethod;
  matchReasons: string[];
  graphProximity?: GraphProximitySignal;
}

export interface EvidenceSearchResponse {
  query: string;
  totalCount: number;
  items: EvidenceSearchResultItem[];
  graphAvailable: boolean;
  executionTimeMs: number;
  fallbackNotice?: string;
}

export interface ClaimAssessmentDto {
  id: string;
  claimId: string;
  confidence: AIAssessmentConfidence;
  rationale: string;
  modelIdentifier: string;
  evidenceRecordIds?: string[];
  createdAt: string;
}

export interface HumanVerdictRecordDto {
  id: string;
  claimId: string;
  verdict: HumanVerdict;
  reviewerId?: string;
  reviewNotes?: string;
  decidedAt: string;
}

export interface VerificationReportDto {
  id: string;
  sessionId: string;
  workspaceId: string;
  summary: Record<string, unknown>;
  markdownContent: string;
  jsonPayload: Record<string, unknown>;
  createdAt: string;
}

// 7. Authentication & Session Contracts (Sprint 2)
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}

export interface LoginRequest {
  email?: string;
  password?: string;
  userId?: string; // Kept as optional for test harnesses
  name?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthenticatedUser;
  workspaces: WorkspaceSummary[];
}

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  confirmPassword?: string;
}

export interface ResetPasswordResponse {
  success: boolean;
  message: string;
}

// 8. Human Review & Verdict Audit Contracts (Sprint 6)
export interface SubmitHumanVerdictRequest {
  verdict: HumanVerdict;
  reviewNotes?: string;
}

export interface HumanVerdictHistoryItem {
  id: string;
  claimId: string;
  verdict: HumanVerdict;
  reviewerId: string | null;
  reviewerName?: string;
  reviewNotes: string | null;
  decidedAt: string;
}

// 9. Verification History Contracts (Sprint 6)
export interface VerificationHistoryItem {
  id: string;
  workspaceId: string;
  repositoryId: string;
  repositoryFullName: string;
  explanation: string;
  targetFilePath?: string;
  status: string;
  claimsCount: number;
  assessedCount: number;
  humanReviewedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationHistoryResponse {
  items: VerificationHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

// 10. Report History & JSON Export Schema (Sprint 6)
export interface TracebackReportExportClaim {
  id: string;
  text: string;
  targetSymbol?: string;
  preliminaryConfidence: AIAssessmentConfidence;
  structuredStatus?: VerificationAssessmentStatus;
  humanVerdict?: HumanVerdict;
  reviewNotes?: string;
  assessment?: {
    confidence: AIAssessmentConfidence;
    rationale: string;
    modelIdentifier: string;
  };
  evidence: EvidenceReference[];
  verdictHistory: HumanVerdictHistoryItem[];
}

export interface TracebackReportExport {
  schemaVersion: "traceback.report.v1";
  exportedAt: string;
  verificationId: string;
  workspace: {
    id: string;
    name: string;
  };
  repository: {
    id: string;
    fullName: string;
  };
  explanation: string;
  codeSnippet?: string;
  targetFilePath?: string;
  status: string;
  createdAt: string;
  claims: TracebackReportExportClaim[];
  summary: {
    totalClaims: number;
    supportedClaims: number;
    contradictedClaims: number;
    insufficientClaims: number;
    mixedClaims: number;
    humanReviewedClaims: number;
  };
}

// ============================================================================
// Sprint 7: MCP Interoperability & Advisory Change Checks Contracts
// ============================================================================

export type AdvisorySeverity = "HIGH" | "MEDIUM" | "LOW";

export type AdvisoryStatus =
  | "CONFLICT_DETECTED"
  | "POTENTIAL_RISK"
  | "NO_CONFLICT_DETECTED"
  | "INSUFFICIENT_EVIDENCE";

export interface HistoricalConflict {
  conflictId: string;
  historicalConstraint: string;
  severity: AdvisorySeverity;
  severityBasis: string;
  explanation: string;
  supportingEvidence: EvidenceReference[];
  recommendedFollowUp: string;
}

export interface CheckChangeAgainstDecisionsRequest {
  workspaceId?: string;
  repositoryId?: string;
  diff?: string;
  changeDescription?: string;
  filePath?: string;
  targetFilePaths?: string[];
  pullRequestNumber?: number;
  pullRequestId?: string;
}

export interface CheckChangeAgainstDecisionsResponse {
  advisoryStatus: AdvisoryStatus;
  summary: string;
  conflicts: HistoricalConflict[];
  advisoryNotice: string;
  limitations: string[];
  inspectedSourcesCount: number;
  evaluatedAt: string;
  repositoryId: string;
  targetFilePath?: string;
}

export interface HistoricalContextMcpItem {
  sourceId: string;
  sourceType: EvidenceSourceType;
  referenceKey: string;
  title: string;
  author: string;
  timestamp: string;
  url: string;
  excerpt: string;
  relevanceScore: number;
  matchReasons: string[];
}

export interface HistoricalContextMcpResponse {
  repositoryId: string;
  query: string;
  totalMatches: number;
  sources: HistoricalContextMcpItem[];
}

export interface VerifyExplanationMcpClaim {
  claimId: string;
  claimText: string;
  status: VerificationAssessmentStatus;
  confidenceScore: number;
  rationale: string;
  citations: Array<{
    sourceId: string;
    sourceType: string;
    referenceKey: string;
    title: string;
    url: string;
    relevanceScore: number;
  }>;
  limitations?: string;
}

export interface VerifyExplanationMcpResponse {
  sessionId: string;
  status: VerificationAssessmentStatus;
  confidenceScore: number;
  claimsCount: number;
  claims: VerifyExplanationMcpClaim[];
  abstentionNotice?: string;
  citationValidityRate: number;
  advisoryNotice: string;
}

export interface VerificationSessionResult {
  sessionId: string;
  workspaceId: string;
  repositoryId: string;
  status: string;
  explanation: string;
  codeSnippet?: string;
  targetFilePath?: string;
  claimsCount: number;
  assessments: Array<{
    claimId: string;
    claimText: string;
    targetSymbol?: string;
    status: VerificationAssessmentStatus;
    confidenceScore: number;
    rationale: string;
    supportingEvidence: any[];
    contradictingEvidence: any[];
    allValidatedEvidence: any[];
    requiresHumanReview: boolean;
    abstentionNotice?: string;
  }>;
  citationValidityRate: number;
  executionTimeMs: number;
  estimatedTokensUsed: number;
  fallbackNotice?: string;
}

// ============================================================================
// Sprint 10: Engineering Decision Memory & Historical Intent Contracts
// ============================================================================

export type DecisionStatus =
  | "CANDIDATE"
  | "IN_REVIEW"
  | "ACCEPTED"
  | "SUPERSEDED"
  | "DISPUTED"
  | "ARCHIVED";

export type DecisionSeverity =
  "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "ADVISORY";

export interface EngineeringDecisionDto {
  id: string;
  workspaceId: string;
  repositoryId: string;
  title: string;
  summary: string;
  decision: string;
  rationale: string;
  targetFilePath?: string | null;
  targetSymbol?: string | null;
  status: DecisionStatus;
  severity: DecisionSeverity;
  supportingEvidence: EvidenceReference[];
  relatedCommitSha?: string | null;
  relatedPrNumber?: number | null;
  reviewerId?: string | null;
  reviewerName?: string | null;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  supersedesId?: string | null;
  supersededById?: string | null;
  createdFromClaimId?: string | null;
  driftStatus?: "NEEDS_REVIEW" | "CURRENT";
  isPotentiallyStale?: boolean;
  driftedFiles?: string[];
  newerCommitCount?: number;
  latestDriftingCommitSha?: string;
  latestDriftingCommitAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCalibrationDto {
  workspaceId: string;
  calculatedAt?: string;
  totals?: {
    verifiedSessions: number;
    extractedClaims: number;
    humanReviews: number;
  };
  verdictBreakdown?: {
    supported: { count: number; percentage: number };
    contradicted: { count: number; percentage: number };
    insufficientEvidence: { count: number; percentage: number };
    mixed: { count: number; percentage: number };
  };
  verdictDistribution: {
    total: number;
    supported: number;
    supportedPct: number;
    contradicted: number;
    contradictedPct: number;
    mixed: number;
    mixedPct: number;
    insufficientEvidence: number;
    insufficientEvidencePct: number;
  };
  humanOversight: {
    totalEvaluated: number;
    totalReviewed?: number;
    humanReviewedCount: number;
    humanReviewRate: number;
    agreementCount: number;
    overrideCount: number;
    overridden?: number;
    overrideRate: number;
    overrideRatePercent?: number;
    averageConfidence?: number;
  };
  decisionHealth: {
    total: number;
    totalDecisions?: number;
    accepted: number;
    freshDecisionsCount?: number;
    needsReview: number;
    staleDecisionsCount?: number;
    superseded: number;
    rejected: number;
    candidate: number;
  };
  contextBlindSpots: Array<{
    repositoryId: string;
    repositoryName: string;
    filePath: string;
    commitCount: number;
    insufficientEvidenceHits: number;
    hasAcceptedDecision: boolean;
    unindexedFilesCount?: number;
    missingDecisionsCount?: number;
    riskScore?: "HIGH" | "MEDIUM" | "LOW";
  }>;
}

export interface CreateEngineeringDecisionDto {
  title: string;
  summary: string;
  decision: string;
  rationale: string;
  targetFilePath?: string;
  targetSymbol?: string;
  status?: DecisionStatus;
  severity?: DecisionSeverity;
  supportingEvidence?: EvidenceReference[];
  relatedCommitSha?: string;
  relatedPrNumber?: number;
  supersedesId?: string;
  createdFromClaimId?: string;
}

export interface UpdateEngineeringDecisionDto {
  title?: string;
  summary?: string;
  decision?: string;
  rationale?: string;
  targetFilePath?: string;
  targetSymbol?: string;
  status?: DecisionStatus;
  severity?: DecisionSeverity;
  reviewNotes?: string;
  supersedesId?: string;
  supersededById?: string;
}

export interface ProposeDecisionFromClaimDto {
  claimId: string;
  title?: string;
  severity?: DecisionSeverity;
}

export type HistoricalIntentOutcome =
  | "DOCUMENTED_CONFLICT"
  | "POTENTIAL_CONFLICT"
  | "NO_KNOWN_CONFLICT"
  | "INSUFFICIENT_CONTEXT";

export type HumanDisposition = "APPROVED" | "REJECTED" | "NEEDS_DISCUSSION";

export interface IntentConflictItem {
  id: string;
  title: string;
  affectedCodeOrSymbol?: string;
  conflictingDecisionId?: string;
  conflictingDecisionTitle?: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  outcome: HistoricalIntentOutcome;
  rationale: string;
  unestablishedContext?: string;
  supportingEvidence: EvidenceReference[];
  recommendedReview: string;
}

export interface HistoricalIntentCheckSessionDto {
  id: string;
  workspaceId: string;
  repositoryId: string;
  diff: string;
  filePath?: string | null;
  changeDescription?: string | null;
  status: string;
  outcome: HistoricalIntentOutcome;
  summary: string;
  conflicts: IntentConflictItem[];
  humanDisposition?: HumanDisposition | null;
  dispositionNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunHistoricalIntentCheckRequest {
  diff: string;
  filePath?: string;
  changeDescription?: string;
  targetFilePaths?: string[];
}

export interface RecordIntentDispositionDto {
  disposition: HumanDisposition;
  notes?: string;
}

// ============================================================================
// Deliverable #4: AI Hallucination & Calibration Scorecard & Context Blind-Spot Map
// ============================================================================

export interface VerdictBreakdownItem {
  count: number;
  percentage: number;
}

export interface VerdictBreakdown {
  supported: VerdictBreakdownItem;
  contradicted: VerdictBreakdownItem;
  mixed: VerdictBreakdownItem;
  insufficientEvidence: VerdictBreakdownItem;
}

export interface HumanOverrideBreakdown {
  totalReviewed: number;
  agreedCount: number;
  overrideCount: number;
  overrideRate: number | null;
  hasHumanReviews: boolean;
}

export interface ContextBlindSpotItem {
  filePath: string;
  repositoryId: string;
  repositoryName: string;
  insufficientEvidenceCount: number;
  totalQueries: number;
  commitChurnCount: number;
  hasAcceptedDecision: boolean;
  decisionsCount: number;
  suggestedAction: "DOCUMENT_DECISION" | "COVERED";
  lastQueriedAt?: string;
}

export interface CalibrationSessionTrendItem {
  sessionId: string;
  label: string;
  trustScore: number;
  supportedCount: number;
  contradictedCount: number;
  abstainedCount: number;
}

export interface CalibrationQuadrants {
  verifiedGrounded: number;
  silentHallucinations: number;
  caughtContradictions: number;
  safeAbstentions: number;
}

export interface CalibrationRecentDisagreementItem {
  claimId: string;
  sessionId: string;
  claimText: string;
  filePath: string;
  machineVerdict: string;
  humanVerdict: string;
}

export interface CalibrationScorecardDto {
  workspaceId: string;
  totalVerifications: number;
  totalClaims: number;
  effectiveTrustScore: number;
  aiGroundedRate: number;
  effectiveGroundedRate: number;
  groundedRate: number;
  abstentionRate: number;
  contradictedRate: number;
  mixedRate: number;
  overrideRate: number | null;
  verdictBreakdown: VerdictBreakdown;
  effectiveVerdictBreakdown: VerdictBreakdown;
  aiVerdictBreakdown: VerdictBreakdown;
  humanOverride: HumanOverrideBreakdown;
  blindSpots: ContextBlindSpotItem[];
  sessionTrend: CalibrationSessionTrendItem[];
  calibrationQuadrants: CalibrationQuadrants;
  recentDisagreements: CalibrationRecentDisagreementItem[];
  summaryTimestamp: string;
}

// Feature 4: ADR Synchronization & Evidence-to-Decision Contracts
// ============================================================================

export type AdrSyncDirection = "EXPORT" | "IMPORT" | "BIDIRECTIONAL";

export interface AdrSyncResultDto {
  totalFilesScanned: number;
  exportedCount: number;
  importedCount: number;
  syncedFiles: string[];
  errors?: string[];
  timestamp: string;
}

export interface AdrFileDto {
  decisionId?: string;
  identifier: string; // e.g. "ADR-001"
  title: string;
  fileName: string; // e.g. "ADR-001-adoption-of-turborepo.md"
  filePath: string; // e.g. "docs/adr/ADR-001-adoption-of-turborepo.md"
  markdown: string;
  status: DecisionStatus;
  date: string;
}

export interface SyncAdrOptionsDto {
  direction?: AdrSyncDirection;
  adrDirectory?: string; // defaults to "docs/adr"
}

// Legacy decision-promotion payload retained for API compatibility.
export interface PromoteToDecisionRequest {
  claimId: string;
  title?: string;
  summary?: string;
  decision?: string;
  rationale?: string;
  targetFilePath?: string;
  targetSymbol?: string;
  severity?: DecisionSeverity;
  status?: DecisionStatus; // "CANDIDATE" or "ACCEPTED"
  reviewNotes?: string;
}

// ============================================================================
// Sprint 11: Promote Verification Claim to Engineering Decision
// ============================================================================

export interface PromoteClaimToDecisionRequest {
  claimId?: string;
  verificationSessionId?: string;
  repositoryId: string;
  title?: string;
  summary?: string;
  decision?: string;
  rationale?: string;
  severity?: DecisionSeverity;
  targetFilePath?: string;
  targetSymbol?: string;
  status?: DecisionStatus; // "CANDIDATE" or "ACCEPTED"
  reviewNotes?: string;
}

export interface PromoteClaimToDecisionResponse {
  decisionId: string;
  id: string;
  workspaceId: string;
  repositoryId: string;
  title: string;
  summary: string;
  decision: string;
  rationale: string;
  targetFilePath?: string | null;
  targetSymbol?: string | null;
  status: DecisionStatus;
  severity: DecisionSeverity;
  supportingEvidence: EvidenceReference[];
  relatedCommitSha?: string | null;
  relatedPrNumber?: number | null;
  createdFromClaimId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Sprint 11: ADR Sync Engine (Bidirectional Markdown Sync)
// ============================================================================

export interface AdrFileSummary {
  fileName: string;
  filePath: string;
  title: string;
  identifier?: string;
  status: string;
  date?: string;
  matchedDecisionId?: string | null;
  matchedDecisionStatus?: DecisionStatus | null;
  existsInDatabase: boolean;
}

export interface AdrSyncImportResponse {
  workspaceId: string;
  repositoryId?: string;
  totalFilesScanned: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  decisions: EngineeringDecisionDto[];
  files: AdrFileSummary[];
}

export interface AdrSyncExportResponse {
  decisionId: string;
  fileName: string;
  filePath: string;
  status: DecisionStatus;
  title: string;
  writtenBytes: number;
  content: string;
}
