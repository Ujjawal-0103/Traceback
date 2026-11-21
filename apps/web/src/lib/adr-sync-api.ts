import {
  PromoteClaimToDecisionRequest,
  PromoteClaimToDecisionResponse,
  AdrFileSummary,
  AdrSyncImportResponse,
  AdrSyncExportResponse,
} from "@traceback/shared-types";
import { getApiActiveWorkspaceId, ApiError } from "./api";

const rawBaseUrl =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001/api";
const API_BASE_URL = rawBaseUrl.endsWith("/api")
  ? rawBaseUrl
  : `${rawBaseUrl.replace(/\/+$/, "")}/api`;

async function adrApiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = cleanEndpoint.startsWith("/api/")
    ? `${API_BASE_URL.replace(/\/api$/, "")}${cleanEndpoint}`
    : `${API_BASE_URL}${cleanEndpoint}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Token resolution
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("traceback_auth_token")
      : null;

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Workspace context header
  const activeWsId = getApiActiveWorkspaceId();
  if (!headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", activeWsId);
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      let details: unknown = undefined;
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
        details = errorJson;
      } catch {
        // ignore JSON parse error
      }
      throw new ApiError(errorMsg, res.status, details);
    }

    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Network error connecting to ADR sync API: ${message}`);
  }
}

export const adrSyncApi = {
  /**
   * Promotes a verified factual claim into a draft Engineering Decision.
   * Scoped to the active workspace.
   */
  async promoteClaimToDecision(
    payload: PromoteClaimToDecisionRequest,
    workspaceId: string = getApiActiveWorkspaceId(),
  ): Promise<PromoteClaimToDecisionResponse> {
    return adrApiRequest<PromoteClaimToDecisionResponse>(
      `/workspaces/${workspaceId}/decisions/promote-from-verification`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  /**
   * Lists .md files in the local ADR directory with parsed metadata
   * and cross-references against database decisions.
   */
  async getAdrFiles(
    query?: { repositoryId?: string; targetDir?: string },
    workspaceId: string = getApiActiveWorkspaceId(),
  ): Promise<AdrFileSummary[]> {
    const params = new URLSearchParams();
    if (query?.repositoryId) params.set("repositoryId", query.repositoryId);
    if (query?.targetDir) params.set("targetDir", query.targetDir);
    const qs = params.toString() ? `?${params.toString()}` : "";

    return adrApiRequest<AdrFileSummary[]>(
      `/workspaces/${workspaceId}/adr-sync/files${qs}`,
    );
  },

  /**
   * Reads local ADR files, parses YAML/markdown sections, and upserts
   * them into PostgreSQL for the workspace.
   */
  async importAdrs(
    payload?: {
      repositoryId?: string;
      targetDir?: string;
      overwriteExisting?: boolean;
    },
    workspaceId: string = getApiActiveWorkspaceId(),
  ): Promise<AdrSyncImportResponse> {
    return adrApiRequest<AdrSyncImportResponse>(
      `/workspaces/${workspaceId}/adr-sync/import`,
      {
        method: "POST",
        body: JSON.stringify(payload || {}),
      },
    );
  },

  /**
   * Serializes an Engineering Decision into clean ADR Markdown
   * and writes it to `/docs/adr/ADR-<slug>.md`.
   */
  async exportDecisionToAdr(
    decisionId: string,
    payload?: {
      repositoryId?: string;
      customSlug?: string;
      targetDir?: string;
    },
    workspaceId: string = getApiActiveWorkspaceId(),
  ): Promise<AdrSyncExportResponse> {
    return adrApiRequest<AdrSyncExportResponse>(
      `/workspaces/${workspaceId}/adr-sync/export/${decisionId}`,
      {
        method: "POST",
        body: JSON.stringify(payload || {}),
      },
    );
  },
};
