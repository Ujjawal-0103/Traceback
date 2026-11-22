import { Test, TestingModule } from "@nestjs/testing";
import { CodeExplainerController } from "./code-explainer.controller";
import { CodeExplainerService } from "./code-explainer.service";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";

describe("CodeExplainerController", () => {
  let controller: CodeExplainerController;
  let service: any;

  const mockWorkspaceId = "ws-123";
  const mockRepoId = "repo-456";

  beforeEach(async () => {
    service = {
      getTargets: jest.fn().mockResolvedValue({
        repositoryId: mockRepoId,
        targets: [{ filePath: "src/main.ts", activityCount: 5 }],
        recentDecisions: [],
      }),
      explainCode: jest.fn().mockResolvedValue({
        repositoryId: mockRepoId,
        target: { filePath: "src/main.ts" },
        insufficientHistory: false,
        synthesisMode: "deterministic_grounded",
        generatedExplanation: "Grounded rationale",
        evidenceSummary: {
          commits: 1,
          pullRequests: 0,
          issues: 0,
          decisions: 0,
          totalSources: 1,
        },
        verificationSession: { sessionId: "sess-123" },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CodeExplainerController],
      providers: [{ provide: CodeExplainerService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CodeExplainerController>(CodeExplainerController);
  });

  it("delegates getTargets to service with workspace and repository IDs", async () => {
    const result = await controller.getTargets(mockWorkspaceId, mockRepoId);
    expect(service.getTargets).toHaveBeenCalledWith(
      mockWorkspaceId,
      mockRepoId,
    );
    expect(result.repositoryId).toBe(mockRepoId);
    expect(result.targets[0].filePath).toBe("src/main.ts");
  });

  it("delegates explainCode to service passing user id and request body", async () => {
    const dto = { filePath: "src/main.ts", question: "Why?" };
    const user = { id: "user-999", email: "test@example.com" } as any;

    const result = await controller.explainCode(
      mockWorkspaceId,
      mockRepoId,
      dto,
      user,
    );
    expect(service.explainCode).toHaveBeenCalledWith(
      mockWorkspaceId,
      mockRepoId,
      "user-999",
      dto,
    );
    expect(result.generatedExplanation).toBe("Grounded rationale");
    expect(result.verificationSession.sessionId).toBe("sess-123");
  });
});
