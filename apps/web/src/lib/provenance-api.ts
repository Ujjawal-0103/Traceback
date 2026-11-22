/**
 * Provenance API Client
 *
 * Provides typed methods for interacting with the /api/provenance endpoints.
 * Operates strictly with existing authentication and workspace context.
 */

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

export interface ProvenanceTimelineQuery {
  filePath?: string;
  symbol?: string;
  decisionId?: string;
  limit?: number;
}

const rawBaseUrl =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001/api";
const API_BASE_URL = rawBaseUrl.endsWith("/api")
  ? rawBaseUrl
  : `${rawBaseUrl.replace(/\/+$/, "")}/api`;

function getAuthToken(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem("traceback_auth_token");
  }
  return null;
}

function getActiveWorkspaceId(override?: string): string {
  if (override?.trim()) return override.trim();
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("traceback_active_workspace");
    if (stored?.trim()) return stored.trim();
  }
  return "ws_alpha";
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  workspaceId?: string,
  timeoutMs: number = 20000,
): Promise<T> {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = cleanEndpoint.startsWith("/api/")
    ? `${API_BASE_URL.replace(/\/api$/, "")}${cleanEndpoint}`
    : `${API_BASE_URL}${cleanEndpoint}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const wsId = getActiveWorkspaceId(workspaceId);
  if (!headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", wsId);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errorJson = await res.json();
        const extracted =
          errorJson.error?.message ||
          errorJson.message ||
          (typeof errorJson.error === "string" ? errorJson.error : null);
        if (extracted) {
          errorMsg = Array.isArray(extracted)
            ? extracted.join(", ")
            : extracted;
        }
      } catch {
        // use default HTTP error
      }
      throw new Error(errorMsg);
    }

    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Request timed out while projecting graph. Please retry.",
      );
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(
      `Network error connecting to Provenance API: ${String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const provenanceApi = {
  /**
   * Fetch target files, decisions, and Neo4j connectivity status for a repository
   */
  async getTargets(
    repositoryId: string,
    workspaceId?: string,
  ): Promise<ProvenanceTargetsResponse> {
    return request<ProvenanceTargetsResponse>(
      `/provenance/repositories/${encodeURIComponent(repositoryId)}/targets`,
      { method: "GET" },
      workspaceId,
      20000,
    );
  },

  /**
   * Query the causal provenance timeline for a repository (optionally filtered by filePath, symbol, or decisionId)
   */
  async getTimeline(
    repositoryId: string,
    query: ProvenanceTimelineQuery = {},
    workspaceId?: string,
  ): Promise<ProvenanceTimelineResponse> {
    const searchParams = new URLSearchParams();
    if (query.filePath) searchParams.set("filePath", query.filePath);
    if (query.symbol) searchParams.set("symbol", query.symbol);
    if (query.decisionId) searchParams.set("decisionId", query.decisionId);
    if (query.limit) searchParams.set("limit", String(query.limit));

    const qs = searchParams.toString();
    const endpoint = `/provenance/repositories/${encodeURIComponent(repositoryId)}/timeline${qs ? `?${qs}` : ""}`;

    return request<ProvenanceTimelineResponse>(
      endpoint,
      { method: "GET" },
      workspaceId,
      20000,
    );
  },

  /**
   * Trigger projection of PostgreSQL history into Neo4j graph nodes & relationships
   */
  async syncGraph(
    repositoryId: string,
    workspaceId?: string,
  ): Promise<ProvenanceSyncResponse> {
    return request<ProvenanceSyncResponse>(
      `/provenance/repositories/${encodeURIComponent(repositoryId)}/sync-graph`,
      { method: "POST" },
      workspaceId,
      30000,
    );
  },
};
