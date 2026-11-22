import { Test, TestingModule } from "@nestjs/testing";
import { ProvenanceController } from "./provenance.controller";
import { ProvenanceService } from "./provenance.service";
import { ProvenanceGraphSyncService } from "./provenance-graph-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { AuthService } from "../auth/auth.service";
import { BadRequestException } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ProvenanceTargetsResponse,
  ProvenanceTimelineResponse,
  ProvenanceSyncResponse,
} from "./provenance.types";

describe("ProvenanceController", () => {
  let controller: ProvenanceController;
  let provenanceService: jest.Mocked<ProvenanceService>;
  let syncService: jest.Mocked<ProvenanceGraphSyncService>;
  let prisma: jest.Mocked<PrismaService>;

  const mockUser: AuthenticatedUser = {
    id: "user_test_1",
    email: "test@traceback.dev",
    name: "Tester",
  };

  beforeEach(async () => {
    provenanceService = {
      getTargets: jest.fn(),
      getTimeline: jest.fn(),
      verifyRepositoryAccess: jest.fn(),
    } as unknown as jest.Mocked<ProvenanceService>;

    syncService = {
      syncProvenanceGraph: jest.fn(),
    } as unknown as jest.Mocked<ProvenanceGraphSyncService>;

    prisma = {
      repository: {
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProvenanceController],
      providers: [
        { provide: ProvenanceService, useValue: provenanceService },
        { provide: ProvenanceGraphSyncService, useValue: syncService },
        { provide: PrismaService, useValue: prisma },
        { provide: WorkspacesService, useValue: new WorkspacesService() },
        {
          provide: AuthService,
          useValue: {
            validateToken: jest.fn().mockResolvedValue({ id: "user_test_1" }),
          },
        },
      ],
    }).compile();

    controller = module.get<ProvenanceController>(ProvenanceController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getTargets", () => {
    it("should return targets using header workspace ID", async () => {
      const mockResult: ProvenanceTargetsResponse = {
        repository: {
          id: "repo_1",
          name: "test-repo",
          fullName: "org/test-repo",
        },
        files: [{ path: "src/auth/jwt.ts", eventCount: 4 }],
        decisions: [
          {
            id: "dec_1",
            title: "JWT Strategy",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
          },
        ],
        neo4jStatus: { configured: false, connected: false },
      };

      provenanceService.getTargets.mockResolvedValue(mockResult);

      const res = await controller.getTargets("repo_1", "ws_alpha");

      expect(provenanceService.getTargets).toHaveBeenCalledWith(
        "ws_alpha",
        "repo_1",
        undefined,
      );
      expect(res).toEqual(mockResult);
    });

    it("should resolve workspace ID from database if header is missing", async () => {
      (prisma.repository.findUnique as jest.Mock).mockResolvedValue({
        workspaceId: "ws_resolved",
      });

      provenanceService.getTargets.mockResolvedValue({
        repository: { id: "repo_1", name: "r", fullName: "o/r" },
        files: [],
        decisions: [],
        neo4jStatus: { configured: false, connected: false },
      });

      const res = await controller.getTargets("repo_1", undefined, undefined);

      expect(prisma.repository.findUnique).toHaveBeenCalledWith({
        where: { id: "repo_1" },
        select: { workspaceId: true },
      });
      expect(provenanceService.getTargets).toHaveBeenCalledWith(
        "ws_resolved",
        "repo_1",
        undefined,
      );
      expect(res.repository.id).toBe("repo_1");
    });

    it("should throw BadRequestException if repository is not found when resolving workspace", async () => {
      (prisma.repository.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        controller.getTargets("nonexistent_repo", undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getTimeline", () => {
    it("should return causal timeline for file query", async () => {
      const mockResponse: ProvenanceTimelineResponse = {
        repository: { id: "repo_1", name: "r", fullName: "o/r" },
        query: { filePath: "src/auth/jwt.ts" },
        dataSource: "postgres_fallback",
        neo4jConnected: false,
        insufficientHistory: false,
        nodes: [],
        edges: [],
        summary: { totalNodes: 0, countsByType: {} },
      };

      provenanceService.getTimeline.mockResolvedValue(mockResponse);

      const res = await controller.getTimeline(
        "repo_1",
        { filePath: "src/auth/jwt.ts", limit: 50 },
        "ws_alpha",
        undefined,
        mockUser,
      );

      expect(provenanceService.getTimeline).toHaveBeenCalledWith(
        "ws_alpha",
        "repo_1",
        expect.objectContaining({ filePath: "src/auth/jwt.ts" }),
        "user_test_1",
      );
      expect(res).toEqual(mockResponse);
    });
  });

  describe("syncGraph", () => {
    it("should trigger graph sync and return result", async () => {
      const mockSyncRes: ProvenanceSyncResponse = {
        repositoryId: "repo_1",
        synced: true,
        neo4jConnected: true,
        message: "Successfully projected repository to Neo4j graph",
        nodesCount: 15,
        edgesCount: 12,
        durationMs: 45,
      };

      provenanceService.verifyRepositoryAccess.mockResolvedValue(
        undefined as any,
      );
      syncService.syncProvenanceGraph.mockResolvedValue(mockSyncRes);

      const res = await controller.syncGraph(
        "repo_1",
        "ws_alpha",
        undefined,
        mockUser,
      );

      expect(provenanceService.verifyRepositoryAccess).toHaveBeenCalledWith(
        "ws_alpha",
        "repo_1",
        "user_test_1",
      );
      expect(syncService.syncProvenanceGraph).toHaveBeenCalledWith(
        "ws_alpha",
        "repo_1",
      );
      expect(res).toEqual(mockSyncRes);
    });

    it("should return graceful structured response when Neo4j is offline", async () => {
      const mockOfflineRes: ProvenanceSyncResponse = {
        repositoryId: "repo_1",
        synced: false,
        neo4jConnected: false,
        nodesSynced: 0,
        edgesSynced: 0,
        message:
          "Neo4j is not connected. Configure NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD and restart API.",
      };

      provenanceService.verifyRepositoryAccess.mockResolvedValue(
        undefined as any,
      );
      syncService.syncProvenanceGraph.mockResolvedValue(mockOfflineRes);

      const res = await controller.syncGraph(
        "repo_1",
        "ws_alpha",
        undefined,
        mockUser,
      );

      expect(res.synced).toBe(false);
      expect(res.neo4jConnected).toBe(false);
      expect(res.nodesSynced).toBe(0);
      expect(res.edgesSynced).toBe(0);
    });
  });
});
