import { Test, TestingModule } from "@nestjs/testing";
import { DecisionsService } from "./decisions.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";

describe("DecisionsService (Drift & Confirmation)", () => {
  let service: DecisionsService;
  let prisma: any;

  const mockPrisma = {
    repository: {
      findFirst: jest.fn(),
    },
    engineeringDecision: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    commitDiff: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DecisionsService>(DecisionsService);
    prisma = module.get(PrismaService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("computeDecisionDrift", () => {
    it("should return isPotentiallyStale: false for non-ACCEPTED decisions", async () => {
      const record = {
        id: "dec-1",
        status: "CANDIDATE",
        repositoryId: "repo-1",
        targetFilePath: "src/table.ts",
      };

      const result = await service.computeDecisionDrift(record);
      expect(result.isPotentiallyStale).toBe(false);
      expect(mockPrisma.commitDiff.findMany).not.toHaveBeenCalled();
    });

    it("should return driftStatus: CURRENT when no target files are present", async () => {
      const record = {
        id: "dec-1",
        status: "ACCEPTED",
        repositoryId: "repo-1",
        targetFilePath: null,
        supportingEvidence: [],
      };

      const result = await service.computeDecisionDrift(record);
      expect(result.driftStatus).toBe("CURRENT");
      expect(result.isPotentiallyStale).toBe(false);
      expect(result.newerCommitCount).toBe(0);
    });

    it("should detect drift when newer commits touch target files", async () => {
      const updatedAt = new Date("2026-01-01T00:00:00Z");
      const record = {
        id: "dec-1",
        status: "ACCEPTED",
        repositoryId: "repo-1",
        targetFilePath: "src/table.ts",
        updatedAt,
      };

      const committedAt = new Date("2026-02-01T00:00:00Z");
      mockPrisma.commitDiff.findMany.mockResolvedValueOnce([
        {
          filePath: "src/table.ts",
          commit: {
            sha: "abc1234567",
            committedAt,
          },
        },
      ]);

      const result = await service.computeDecisionDrift(record);
      expect(result.driftStatus).toBe("NEEDS_REVIEW");
      expect(result.isPotentiallyStale).toBe(true);
      expect(result.newerCommitCount).toBe(1);
      expect(result.latestDriftingCommitSha).toBe("abc1234567");
      expect(result.latestDriftingCommitAt).toBe(committedAt.toISOString());
      expect(result.driftedFiles).toEqual(["src/table.ts"]);
    });

    it("should return CURRENT when no newer commits exist", async () => {
      const updatedAt = new Date("2026-01-01T00:00:00Z");
      const record = {
        id: "dec-1",
        status: "ACCEPTED",
        repositoryId: "repo-1",
        targetFilePath: "src/table.ts",
        updatedAt,
      };

      mockPrisma.commitDiff.findMany.mockResolvedValueOnce([]);

      const result = await service.computeDecisionDrift(record);
      expect(result.driftStatus).toBe("CURRENT");
      expect(result.isPotentiallyStale).toBe(false);
      expect(result.newerCommitCount).toBe(0);
    });
  });

  describe("confirmDecisionValid", () => {
    it("should throw BadRequestException if decision is not ACCEPTED", async () => {
      mockPrisma.repository.findFirst.mockResolvedValueOnce({ id: "repo-1" });
      mockPrisma.engineeringDecision.findFirst.mockResolvedValueOnce({
        id: "dec-1",
        status: "CANDIDATE",
        workspaceId: "ws-1",
        repositoryId: "repo-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });

      await expect(
        service.confirmDecisionValid("ws-1", "repo-1", "dec-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should update decision timestamps and review notes, returning CURRENT status", async () => {
      const existing = {
        id: "dec-1",
        title: "Table Memoization",
        summary: "Summary",
        decision: "Decision",
        rationale: "Rationale",
        status: "ACCEPTED",
        severity: "HIGH",
        workspaceId: "ws-1",
        repositoryId: "repo-1",
        targetFilePath: "src/table.ts",
        reviewNotes: "Previous note",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      };

      mockPrisma.repository.findFirst.mockResolvedValueOnce({ id: "repo-1" });
      mockPrisma.engineeringDecision.findFirst.mockResolvedValueOnce(existing);
      mockPrisma.commitDiff.findMany.mockResolvedValueOnce([]);

      const updated = {
        ...existing,
        updatedAt: new Date(),
        reviewedAt: new Date(),
        reviewNotes: "Previous note\nConfirmed valid against current repository state by Jane Doe on ...",
      };
      mockPrisma.engineeringDecision.update.mockResolvedValueOnce(updated);

      const result = await service.confirmDecisionValid(
        "ws-1",
        "repo-1",
        "dec-1",
        { id: "user-1", name: "Jane Doe", email: "jane@example.com" },
      );

      expect(mockPrisma.engineeringDecision.update).toHaveBeenCalled();
      expect(result.driftStatus).toBe("CURRENT");
      expect(result.isPotentiallyStale).toBe(false);
      expect(result.newerCommitCount).toBe(0);
    });
  });
});
