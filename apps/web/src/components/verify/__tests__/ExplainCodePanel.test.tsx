import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExplainCodePanel } from "../ExplainCodePanel";
import {
  codeExplainerApi,
  extractApiErrorMessage,
  CodeExplainerApiError,
} from "../../../lib/code-explainer-api";

// Mock the code-explainer API module
jest.mock("../../../lib/code-explainer-api", () => {
  const actual = jest.requireActual("../../../lib/code-explainer-api");
  return {
    ...actual,
    codeExplainerApi: {
      getTargets: jest.fn(),
      explainCode: jest.fn(),
    },
  };
});

describe("extractApiErrorMessage helper", () => {
  it("extracts message from NestJS HttpExceptionFilter envelope { error: { message, code } }", () => {
    const payload = {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required to access protected resource",
        details: null,
      },
    };
    const extracted = extractApiErrorMessage(payload);
    expect(extracted).toBe(
      "Authentication required to access protected resource",
    );
  });

  it("extracts message from ValidationPipe array envelope { message: ['a', 'b'] }", () => {
    const payload = {
      statusCode: 400,
      message: [
        "filePath must be a string",
        "symbol must be shorter than 200 characters",
      ],
      error: "Bad Request",
    };
    const extracted = extractApiErrorMessage(payload);
    expect(extracted).toBe(
      "filePath must be a string; symbol must be shorter than 200 characters",
    );
  });

  it("handles string error and fallback gracefully", () => {
    expect(extractApiErrorMessage("Simple error string")).toBe(
      "Simple error string",
    );
    expect(extractApiErrorMessage(null, "Default fallback")).toBe(
      "Default fallback",
    );
    expect(extractApiErrorMessage({}, "Default fallback")).toBe(
      "Default fallback",
    );
  });

  it("guarantees a string is returned and NEVER [object Object]", () => {
    const payloads = [
      { error: { code: "FORBIDDEN" } },
      { error: {} },
      { message: { message: "Nested inner message" } },
      { random: { foo: "bar" } },
    ];

    payloads.forEach((p) => {
      const result = extractApiErrorMessage(p, "Safe fallback");
      expect(typeof result).toBe("string");
      expect(result).not.toBe("[object Object]");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe("ExplainCodePanel", () => {
  const mockOnSessionGenerated = jest.fn();
  const mockOnSelectRepository = jest.fn();
  const defaultProps = {
    workspaceId: "ws_alpha",
    repositoryId: "repo_1",
    repositories: [
      { id: "repo_1", fullName: "org/repo-main", workspaceId: "ws_alpha" },
    ],
    onSelectRepository: mockOnSelectRepository,
    onSessionGenerated: mockOnSessionGenerated,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (codeExplainerApi.getTargets as jest.Mock).mockResolvedValue({
      repositoryId: "repo_1",
      targets: [
        {
          filePath: "apps/web/src/components/Table.tsx",
          activityCount: 15,
          relatedDecisionCount: 2,
        },
        {
          filePath: "apps/api/src/auth/jwt.ts",
          activityCount: 8,
          relatedDecisionCount: 1,
        },
      ],
      recentDecisions: [],
    });
  });

  it("renders inputs, loads targets, and displays quick-pick chips", async () => {
    render(<ExplainCodePanel {...defaultProps} />);

    expect(screen.getByText(/Native Rationale Generator/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Target File Path/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Explain & Verify from History/i }),
    ).toBeInTheDocument();

    // Verify chips load
    await waitFor(() => {
      expect(screen.getByText("Table.tsx")).toBeInTheDocument();
      expect(screen.getByText("jwt.ts")).toBeInTheDocument();
    });

    // Clicking chip populates input
    fireEvent.click(screen.getByText("Table.tsx"));
    expect(screen.getByLabelText(/Target File Path/i)).toHaveValue(
      "apps/web/src/components/Table.tsx",
    );
  });

  it("handles unwrapping targets when returned in envelope { data: { targets: [...] } }", async () => {
    (codeExplainerApi.getTargets as jest.Mock).mockResolvedValue({
      data: {
        repositoryId: "repo_1",
        targets: [
          {
            filePath: "apps/api/src/prisma/prisma.service.ts",
            activityCount: 12,
            relatedDecisionCount: 0,
          },
        ],
        recentDecisions: [],
      },
    });

    render(<ExplainCodePanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("prisma.service.ts")).toBeInTheDocument();
    });
  });

  it("submits request, renders grounded explanation, and passes session to verify view", async () => {
    const mockSession = {
      sessionId: "session_new_123",
      claimsCount: 2,
      assessments: [],
    };

    (codeExplainerApi.explainCode as jest.Mock).mockResolvedValue({
      repositoryId: "repo_1",
      target: { filePath: "apps/web/src/components/Table.tsx" },
      insufficientHistory: false,
      synthesisMode: "deterministic_grounded",
      generatedExplanation:
        'This implementation originated from Issue #10 ("Table performance lag"). It was integrated in Pull Request #42 via commit a1b2c3d upon passing review.',
      evidenceSummary: {
        commits: 3,
        pullRequests: 1,
        issues: 1,
        decisions: 1,
        totalSources: 6,
      },
      verificationSession: mockSession,
    });

    render(<ExplainCodePanel {...defaultProps} />);

    // Fill in file path
    const fileInput = screen.getByLabelText(/Target File Path/i);
    fireEvent.change(fileInput, {
      target: { value: "apps/web/src/components/Table.tsx" },
    });

    // Click explain button
    const submitBtn = screen.getByRole("button", {
      name: /Explain & Verify from History/i,
    });
    fireEvent.click(submitBtn);

    // Verify loading and result
    await waitFor(() => {
      expect(codeExplainerApi.explainCode).toHaveBeenCalledWith(
        "ws_alpha",
        "repo_1",
        {
          filePath: "apps/web/src/components/Table.tsx",
          symbol: undefined,
          question: undefined,
          codeSnippet: undefined,
        },
      );
    });

    // Check explanation card rendered
    await waitFor(() => {
      expect(
        screen.getByText(/Deterministic Evidence Synthesis/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Table performance lag/i)).toBeInTheDocument();
      expect(screen.getByText("3 Commits")).toBeInTheDocument();
      expect(screen.getByText("1 PRs")).toBeInTheDocument();
    });

    // Check onSessionGenerated callback triggered
    expect(mockOnSessionGenerated).toHaveBeenCalledWith(mockSession);
  });

  it("renders structured Section 1 explanation breakdown and Section 2 audit divider", async () => {
    const mockSession = {
      sessionId: "session_breakdown_456",
      claimsCount: 3,
      assessments: [],
    };

    (codeExplainerApi.explainCode as jest.Mock).mockResolvedValue({
      repositoryId: "repo_1",
      target: { filePath: "apps/web/src/components/Table.tsx" },
      insufficientHistory: false,
      synthesisMode: "deterministic_grounded",
      generatedExplanation: "Table memoization narrative",
      explanationBreakdown: {
        summary: "The Table component memoizes rows when count exceeds 500 to prevent layout thrashing.",
        whyItWasBuilt: "Created to resolve UI stuttering during high-frequency telemetry updates.",
        howItWasImplemented: "Implemented React.memo with a shallow row comparison predicate.",
        whatCodeDoes: "Iterates through rows and conditionally delegates to VirtualizedRow.",
        governingConstraints: [
          "Row height must remain static at 48px",
          "Maximum batch size capped at 1,000 items",
        ],
        cautionBeforeEditing: "Modifying the memoization threshold will trigger re-renders in parent viewport.",
        evolutionSummary: "Iterated across PR #42 and commit a1b2c3d.",
      },
      evidenceSummary: {
        commits: 5,
        pullRequests: 2,
        issues: 1,
        decisions: 1,
        totalSources: 9,
      },
      verificationSession: mockSession,
    });

    render(<ExplainCodePanel {...defaultProps} />);

    const fileInput = screen.getByLabelText(/Target File Path/i);
    fireEvent.change(fileInput, {
      target: { value: "apps/web/src/components/Table.tsx" },
    });

    const submitBtn = screen.getByRole("button", {
      name: /Explain & Verify from History/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("explanation-breakdown")).toBeInTheDocument();
      expect(
        screen.getByText(/The Table component memoizes rows when count exceeds 500/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Origin & Problem Solved/i)).toBeInTheDocument();
      expect(screen.getByText(/Technical Approach/i)).toBeInTheDocument();
      expect(screen.getByText(/From Code Snippet — Not Historical Proof/i)).toBeInTheDocument();
      expect(screen.getByText(/Row height must remain static at 48px/i)).toBeInTheDocument();
      expect(screen.getByText(/Caution Before Editing/i)).toBeInTheDocument();
      expect(screen.getByText(/How It Evolved/i)).toBeInTheDocument();
      expect(screen.getByTestId("section-2-divider")).toBeInTheDocument();
      expect(
        screen.getByText(/Section 2: Verified Claims & Supporting Proof/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/3 Claims Extracted & Verified/i),
      ).toBeInTheDocument();
    });
  });

  it("renders honest abstention banner when insufficientHistory is true (Refuses to guess)", async () => {
    (codeExplainerApi.explainCode as jest.Mock).mockResolvedValue({
      repositoryId: "repo_1",
      target: { filePath: "src/legacy/missing.ts" },
      insufficientHistory: true,
      abstentionReason:
        "No matching historical commits, PR discussions, or decisions were indexed for this target. Traceback refuses to invent or hallucinate implementation rationales.",
      synthesisMode: "abstained",
      generatedExplanation:
        "Insufficient historical evidence in the indexed repository history to explain why this code exists.",
      evidenceSummary: {
        commits: 0,
        pullRequests: 0,
        issues: 0,
        decisions: 0,
        totalSources: 0,
      },
      verificationSession: null,
    });

    render(<ExplainCodePanel {...defaultProps} />);

    const fileInput = screen.getByLabelText(/Target File Path/i);
    fireEvent.change(fileInput, {
      target: { value: "src/legacy/missing.ts" },
    });

    const submitBtn = screen.getByRole("button", {
      name: /Explain & Verify from History/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Insufficient Historical Evidence — Refused to Guess/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Traceback refuses to invent or hallucinate/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Abstained — Insufficient History/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Sync Repository History/i }),
      ).toBeInTheDocument();
    });
  });

  it("displays readable error banner on API failure and NEVER [object Object]", async () => {
    const structuredError = new CodeExplainerApiError({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required to access protected resource",
      },
    });

    (codeExplainerApi.explainCode as jest.Mock).mockRejectedValue(
      structuredError,
    );

    render(<ExplainCodePanel {...defaultProps} />);

    const fileInput = screen.getByLabelText(/Target File Path/i);
    fireEvent.change(fileInput, {
      target: { value: "src/components/Table.tsx" },
    });

    const submitBtn = screen.getByRole("button", {
      name: /Explain & Verify from History/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Authentication required to access protected resource",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
    });
  });

  it("displays validation error when required inputs are empty", async () => {
    render(<ExplainCodePanel {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.queryByText(/Loading indexed paths/i),
      ).not.toBeInTheDocument();
    });

    const submitBtn = screen.getByRole("button", {
      name: /Explain & Verify from History/i,
    });
    fireEvent.click(submitBtn);

    expect(
      screen.getByText(
        /Please provide at least a Target File Path, Symbol, or Question/i,
      ),
    ).toBeInTheDocument();
    expect(codeExplainerApi.explainCode).not.toHaveBeenCalled();
  });
});
