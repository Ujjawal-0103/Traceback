/**
 * API client for Native Code Explainer ("Explain & Verify")
 * Matches existing Traceback API auth, workspace headers, and environment patterns.
 */

const rawBaseUrl =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001/api";
const API_BASE_URL = rawBaseUrl.endsWith("/api")
  ? rawBaseUrl
  : `${rawBaseUrl.replace(/\/+$/, "")}/api`;
const DEFAULT_WORKSPACE_ID = "ws_alpha";

export function getAuthToken(): string | null {
  if (typeof window !== "undefined") {
    return (
      localStorage.getItem("traceback_auth_token") ||
      localStorage.getItem("traceback_token") ||
      sessionStorage.getItem("traceback_auth_token") ||
      sessionStorage.getItem("traceback_token")
    );
  }
  return null;
}

export function getActiveWorkspaceId(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("traceback_active_workspace");
    if (stored) return stored;
  }
  return DEFAULT_WORKSPACE_ID;
}

/**
 * Safely extracts a human-readable string error message from any backend error payload.
 * Guarantees a string return value — NEVER "[object Object]".
 */
export function extractApiErrorMessage(
  payload: unknown,
  fallback = "An unexpected API error occurred",
): string {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;

  if (typeof payload === "object") {
    const obj = payload as Record<string, any>;

    // Case 1: NestJS HttpExceptionFilter envelope: { success: false, error: { message: "...", code: "..." } }
    if (obj.error && typeof obj.error === "object") {
      const nested = obj.error;
      if (typeof nested.message === "string" && nested.message.trim()) {
        return nested.message;
      }
      if (Array.isArray(nested.message)) {
        return nested.message.map((m: unknown) => String(m)).join("; ");
      }
      if (typeof nested.code === "string" && nested.code.trim()) {
        return `API Error: ${nested.code}`;
      }
    }

    // Case 2: ValidationPipe envelope: { statusCode: 400, message: ["..."], error: "Bad Request" }
    if (Array.isArray(obj.message)) {
      return obj.message.map((m: unknown) => String(m)).join("; ");
    }
    if (typeof obj.message === "string" && obj.message.trim()) {
      return obj.message;
    }

    // Case 3: Standard error string: { error: "Bad Request" }
    if (typeof obj.error === "string" && obj.error.trim()) {
      return obj.error;
    }

    // Case 4: Deeply nested message object
    if (obj.message && typeof obj.message === "object") {
      return extractApiErrorMessage(obj.message, fallback);
    }
  }

  return fallback;
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

export interface ExplainCodeRequest {
  filePath?: string;
  symbol?: string;
  codeSnippet?: string;
  question?: string;
}

export interface ExplanationBreakdown {
  summary: string;
  whatCodeDoes?: string;
  whyItWasBuilt: string;
  howItWasImplemented: string;
  governingConstraints: string[];
  evolutionSummary?: string;
  cautionBeforeEditing?: string;
}

export interface ExplainCodeResponse {
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
  explanationBreakdown?: ExplanationBreakdown;
  evidenceSummary: {
    commits: number;
    pullRequests: number;
    issues: number;
    decisions: number;
    totalSources: number;
  };
  verificationSession: any | null;
}

export class CodeExplainerApiError extends Error {
  constructor(
    message: unknown,
    public status?: number,
    public details?: unknown,
  ) {
    const safeMsg =
      typeof message === "string"
        ? message
        : extractApiErrorMessage(message, "An unexpected API error occurred");
    super(safeMsg);
    this.name = "CodeExplainerApiError";
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  customWorkspaceId?: string,
): Promise<T> {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = cleanEndpoint.startsWith("/api/")
    ? `${API_BASE_URL.replace(/\/api$/, "")}${cleanEndpoint}`
    : `${API_BASE_URL}${cleanEndpoint}`;

  const token = getAuthToken();
  const effectiveWsId = customWorkspaceId || getActiveWorkspaceId();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-workspace-id": effectiveWsId,
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchFn =
    typeof fetch !== "undefined"
      ? fetch
      : typeof window !== "undefined" && typeof window.fetch !== "undefined"
        ? window.fetch.bind(window)
        : null;

  if (!fetchFn) {
    return {
      repositoryId: "",
      targets: [],
      recentDecisions: [],
    } as unknown as T;
  }

  const res = await fetchFn(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorMsg = `API request failed with status ${res.status}`;
    let details: unknown;
    try {
      const errorData = await res.json();
      details = errorData;
      errorMsg = extractApiErrorMessage(
        errorData,
        `API request failed with status ${res.status}`,
      );
    } catch {
      // not JSON
    }
    throw new CodeExplainerApiError(errorMsg, res.status, details);
  }

  const json = await res.json();

  // Safely unwrap standard response wrappers if present: { success: true, data: ... }
  if (
    json &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    "data" in json &&
    json.data !== undefined &&
    !("targets" in json) &&
    !("generatedExplanation" in json)
  ) {
    return json.data as T;
  }

  return json as T;
}

export const codeExplainerApi = {
  async getTargets(
    workspaceId: string,
    repositoryId: string,
  ): Promise<ExplainCodeTargetsResponse> {
    return request<ExplainCodeTargetsResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/repositories/${encodeURIComponent(repositoryId)}/explain-code/targets`,
      {},
      workspaceId,
    );
  },

  async explainCode(
    workspaceId: string,
    repositoryId: string,
    data: ExplainCodeRequest,
  ): Promise<ExplainCodeResponse> {
    return request<ExplainCodeResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/repositories/${encodeURIComponent(repositoryId)}/explain-code`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      workspaceId,
    );
  },
};
