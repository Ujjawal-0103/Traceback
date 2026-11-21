import { Test, TestingModule } from "@nestjs/testing";
import { DecisionsController } from "./decisions.controller";
import { DecisionsService } from "./decisions.service";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspaceGuard } from "../workspaces/workspace.guard";

describe("DecisionsController", () => {
  let controller: DecisionsController;
  let service: any;

  const mockDecision = {
    id: "dec-101",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    title: "Light Theme Default",
    summary: "Enforce light theme on startup",
    decision: "Use light mode",
    rationale: "Compliance with AGENTS.md",
    status: "ACCEPTED",
    severity: "HIGH",
    supportingEvidence: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockAdr = {
    decisionId: "dec-101",
    identifier: "ADR-001",
    title: "Light Theme Default",
    fileName: "ADR-001-light-theme-default.md",
    filePath: "docs/adr/ADR-001-light-theme-default.md",
    markdown: "# ADR-001: Light Theme Default\n...",
    status: "ACCEPTED",
    date: new Date().toISOString(),
  };

  const mockSyncResult = {
    totalFilesScanned: 2,
    exportedCount: 1,
    importedCount: 1,
    syncedFiles: ["docs/adr/ADR-001-light-theme-default.md"],
    timestamp: new Date().toISOString(),
  };

  beforeEach(async () => {
    service = {
      listDecisions: jest.fn().mockResolvedValue([mockDecision]),
      getDecisionById: jest.fn().mockResolvedValue(mockDecision),
      createDecision: jest.fn().mockResolvedValue(mockDecision),
      proposeFromClaim: jest.fn().mockResolvedValue(mockDecision),
      updateDecision: jest.fn().mockResolvedValue(mockDecision),
      acceptDecision: jest.fn().mockResolvedValue(mockDecision),
      rejectDecision: jest
        .fn()
        .mockResolvedValue({ ...mockDecision, status: "ARCHIVED" }),
      disputeDecision: jest
        .fn()
        .mockResolvedValue({ ...mockDecision, status: "DISPUTED" }),
      supersedeDecision: jest
        .fn()
        .mockResolvedValue({ ...mockDecision, status: "SUPERSEDED" }),
      getDecisionAdr: jest.fn().mockResolvedValue(mockAdr),
      exportDecisionToAdr: jest.fn().mockResolvedValue(mockAdr),
      exportAllDecisionsToAdrs: jest.fn().mockResolvedValue(mockSyncResult),
      importAdrsFromDocs: jest.fn().mockResolvedValue(mockSyncResult),
      syncAdrsBidirectional: jest.fn().mockResolvedValue(mockSyncResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DecisionsController],
      providers: [{ provide: DecisionsService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DecisionsController>(DecisionsController);
  });

  it("lists decisions with optional status filter", async () => {
    const result = await controller.listDecisions(
      "ws-1",
      "repo-1",
      "ACCEPTED" as any,
    );
    expect(result).toHaveLength(1);
    expect(service.listDecisions).toHaveBeenCalledWith(
      "ws-1",
      "repo-1",
      "ACCEPTED",
    );
  });

  it("proposes decision from verified claim", async () => {
    const result = await controller.proposeFromClaim(
      "ws-1",
      "repo-1",
      { claimId: "claim-1" },
      { id: "u-1", name: "Alex" } as any,
    );
    expect(result.id).toBe("dec-101");
    expect(service.proposeFromClaim).toHaveBeenCalledWith(
      "ws-1",
      "repo-1",
      { claimId: "claim-1" },
      { id: "u-1", name: "Alex" },
    );
  });

  it("retrieves ADR markdown for a decision", async () => {
    const result = await controller.getDecisionAdr("ws-1", "repo-1", "dec-101");
    expect(result.identifier).toBe("ADR-001");
    expect(service.getDecisionAdr).toHaveBeenCalledWith(
      "ws-1",
      "repo-1",
      "dec-101",
    );
  });

  it("exports decision to ADR file", async () => {
    const result = await controller.exportDecisionAdr(
      "ws-1",
      "repo-1",
      "dec-101",
      { adrDirectory: "docs/adr" },
    );
    expect(result.filePath).toBe("docs/adr/ADR-001-light-theme-default.md");
    expect(service.exportDecisionToAdr).toHaveBeenCalled();
  });

  it("executes bidirectional ADR sync", async () => {
    const result = await controller.syncAdrs("ws-1", "repo-1", {
      direction: "BIDIRECTIONAL",
    });
    expect(result.syncedFiles).toContain(
      "docs/adr/ADR-001-light-theme-default.md",
    );
    expect(service.syncAdrsBidirectional).toHaveBeenCalled();
  });
});
