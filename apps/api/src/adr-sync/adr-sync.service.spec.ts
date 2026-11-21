import { Test, TestingModule } from "@nestjs/testing";
import { AdrSyncService } from "./adr-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdrMarkdownMapper } from "./adr-markdown.mapper";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("AdrSyncService", () => {
  let service: AdrSyncService;
  let prisma: {
    repository: { findFirst: jest.Mock };
    engineeringDecision: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  let tempDir: string;
  const mockWorkspaceId = "ws-alpha";
  const mockRepoId = "repo-omega";

  const sampleDecision = {
    id: "dec-001",
    workspaceId: mockWorkspaceId,
    repositoryId: mockRepoId,
    title: "Adoption of Turborepo Monorepo Structure",
    summary: "Need unified monorepo for web, api, and shared packages.",
    decision:
      "Adopt Turborepo monorepo structure across all apps and packages.",
    rationale:
      "Ensures type safety, shared domain models, and fast build caching.",
    status: "ACCEPTED" as const,
    severity: "HIGH" as const,
    targetFilePath: "package.json",
    targetSymbol: "workspaces",
    relatedCommitSha: "a1b2c3d4e5f6",
    relatedPrNumber: 42,
    supportingEvidence: [
      {
        id: "ev-1",
        sourceType: "COMMIT" as const,
        referenceKey: "a1b2c3d4e5f6",
        title: "Initialize monorepo structure",
        author: "Dev Lead",
        timestamp: "2026-10-09T00:00:00.000Z",
        url: "https://github.com/org/repo/commit/a1b2c3d4e5f6",
        snippet: "workspaces: ['apps/*', 'packages/*']",
        filePath: "package.json",
      },
    ],
    reviewerName: "Principal Architect",
    reviewedAt: new Date("2026-10-10T12:00:00Z"),
    createdAt: new Date("2026-10-09T08:00:00Z"),
    updatedAt: new Date("2026-10-10T12:00:00Z"),
  };

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "traceback-adr-test-"));
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    prisma = {
      repository: { findFirst: jest.fn() },
      engineeringDecision: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AdrSyncService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AdrSyncService>(AdrSyncService);
  });

  describe("1. Markdown Parsing & Serialization Round-Trip", () => {
    it("should serialize an engineering decision to ADR Markdown and parse it back accurately", () => {
      const markdown = AdrMarkdownMapper.serialize(sampleDecision);

      expect(markdown).toContain(
        "# ADR-adoption-of-turborepo-monorepo-structure: Adoption of Turborepo Monorepo Structure",
      );
      expect(markdown).toContain("- **Status:** ACCEPTED");
      expect(markdown).toContain("- **Severity:** HIGH");
      expect(markdown).toContain("- **Related Commit:** a1b2c3d4e5f6");
      expect(markdown).toContain("- **Related PR:** #42");
      expect(markdown).toContain("## Context & Summary");
      expect(markdown).toContain("## Decision");
      expect(markdown).toContain("## Rationale");
      expect(markdown).toContain(
        "## Verified Provenance & Supporting Evidence",
      );
      expect(markdown).toContain(
        "[COMMIT] a1b2c3d4e5f6: Initialize monorepo structure",
      );

      const parsed = AdrMarkdownMapper.parse(
        markdown,
        "ADR-001-adoption-of-turborepo.md",
      );

      expect(parsed.title).toBe("Adoption of Turborepo Monorepo Structure");
      expect(parsed.status).toBe("ACCEPTED");
      expect(parsed.severity).toBe("HIGH");
      expect(parsed.relatedCommitSha).toBe("a1b2c3d4e5f6");
      expect(parsed.relatedPrNumber).toBe(42);
      expect(parsed.summary).toContain("Need unified monorepo");
      expect(parsed.decision).toContain("Adopt Turborepo monorepo structure");
      expect(parsed.rationale).toContain("Ensures type safety");
      expect(parsed.supportingEvidence.length).toBeGreaterThan(0);
      expect(parsed.supportingEvidence[0].referenceKey).toBe("a1b2c3d4e5f6");
    });

    it("should parse legacy ADR formats with bullet point metadata and custom sections", () => {
      const legacyAdr = `# ADR-007: GitHub Access and Minimum Permissions

- **Identifier:** ADR-007
- **Title:** GitHub App Integration with Minimum Read-Only Scopes
- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Traceback needs to ingest commit history from user repositories.

## Decision & Consequences

Adopt a GitHub App integration with strictly read-only permissions.

## Trade-offs

Requires slightly more setup but provides superior security.
`;

      const parsed = AdrMarkdownMapper.parse(
        legacyAdr,
        "ADR-007-github-access.md",
      );

      expect(parsed.identifier).toBe("ADR-007");
      expect(parsed.title).toBe(
        "GitHub App Integration with Minimum Read-Only Scopes",
      );
      expect(parsed.status).toBe("ACCEPTED");
      expect(parsed.summary).toContain(
        "Traceback needs to ingest commit history",
      );
      expect(parsed.decision).toContain("Adopt a GitHub App integration");
      expect(parsed.rationale).toContain("Requires slightly more setup");
    });
  });

  describe("2. Path-Traversal & Security Protection", () => {
    it("should reject path traversal attempts escaping the ADR directory with ../", () => {
      expect(() => {
        service.validatePath(tempDir, "../../etc/passwd.md");
      }).toThrow(BadRequestException);

      expect(() => {
        service.validatePath(tempDir, "../secrets.md");
      }).toThrow(BadRequestException);

      expect(() => {
        service.validatePath(tempDir, "subdir/../../outside.md");
      }).toThrow(BadRequestException);
    });

    it("should reject non-markdown files to prevent arbitrary file access or injection", () => {
      expect(() => {
        service.validatePath(tempDir, "malicious.sh");
      }).toThrow(BadRequestException);

      expect(() => {
        service.validatePath(tempDir, "payload.exe");
      }).toThrow(BadRequestException);

      expect(() => {
        service.validatePath(tempDir, "config.json");
      }).toThrow(BadRequestException);
    });

    it("should permit safe, sanitized markdown file paths inside the base directory", () => {
      const valid = service.validatePath(tempDir, "ADR-001-safe-decision.md");
      expect(valid).toBe(path.resolve(tempDir, "ADR-001-safe-decision.md"));
    });
  });

  describe("3. Import Deduplication & Upsert", () => {
    let testAdrDir: string;

    beforeEach(async () => {
      testAdrDir = await fs.mkdtemp(path.join(tempDir, "import-test-"));
      const adrContent1 = `# ADR-001: Architecture Structure\n\n- **Status:** Accepted\n\n## Context\n\nContext text\n\n## Decision\n\nDecision text\n`;
      const adrContent2 = `# ADR-002: Evidence Storage\n\n- **Status:** Proposed\n\n## Context\n\nStorage context\n\n## Decision\n\nStorage decision\n`;
      await fs.writeFile(
        path.join(testAdrDir, "ADR-001.md"),
        adrContent1,
        "utf8",
      );
      await fs.writeFile(
        path.join(testAdrDir, "ADR-002.md"),
        adrContent2,
        "utf8",
      );
    });

    it("should import new ADRs and skip already existing decisions without duplicating", async () => {
      prisma.repository.findFirst.mockResolvedValue({
        id: mockRepoId,
        workspaceId: mockWorkspaceId,
      });

      // Existing decision matches ADR-001
      prisma.engineeringDecision.findMany.mockResolvedValue([
        {
          id: "dec-existing-1",
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepoId,
          title: "ADR-001: Architecture Structure",
          status: "ACCEPTED",
          summary: "Existing summary",
          decision: "Existing decision",
          rationale: "Existing rationale",
          severity: "MEDIUM",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      prisma.engineeringDecision.create.mockImplementation((args) =>
        Promise.resolve({
          id: "dec-new-2",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await service.importAdrs(mockWorkspaceId, {
        targetDir: testAdrDir,
        overwriteExisting: false,
      });

      // 1 skipped (already in DB), 1 newly imported
      expect(result.totalFilesScanned).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.importedCount).toBe(1);
      expect(result.updatedCount).toBe(0);
      expect(prisma.engineeringDecision.create).toHaveBeenCalledTimes(1);
    });

    it("should update existing decisions when overwriteExisting is true", async () => {
      prisma.repository.findFirst.mockResolvedValue({
        id: mockRepoId,
        workspaceId: mockWorkspaceId,
      });

      prisma.engineeringDecision.findMany.mockResolvedValue([
        {
          id: "dec-existing-1",
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepoId,
          title: "ADR-001: Architecture Structure",
          status: "ACCEPTED",
          summary: "Old summary",
          decision: "Old decision",
          rationale: "Old rationale",
          severity: "MEDIUM",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      prisma.engineeringDecision.update.mockResolvedValue({
        id: "dec-existing-1",
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepoId,
        title: "ADR-001: Architecture Structure",
        status: "ACCEPTED",
        summary: "Context text",
        decision: "Decision text",
        rationale: "Context text",
        severity: "MEDIUM",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.engineeringDecision.create.mockImplementation((args) =>
        Promise.resolve({
          id: "dec-new-2",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await service.importAdrs(mockWorkspaceId, {
        targetDir: testAdrDir,
        overwriteExisting: true,
      });

      expect(result.updatedCount).toBe(1);
      expect(result.importedCount).toBe(1);
      expect(prisma.engineeringDecision.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("4. Export Formatting & Writing", () => {
    it("should format and write ADR markdown to target directory with correct metadata", async () => {
      const exportDir = await fs.mkdtemp(path.join(tempDir, "export-test-"));

      prisma.engineeringDecision.findFirst.mockResolvedValue(sampleDecision);

      const result = await service.exportDecision(
        mockWorkspaceId,
        sampleDecision.id,
        { targetDir: exportDir },
      );

      expect(result.decisionId).toBe(sampleDecision.id);
      expect(result.fileName).toContain(".md");
      expect(result.writtenBytes).toBeGreaterThan(100);

      const writtenFile = path.resolve(service.getRepoRoot(), result.filePath);
      const fileExists = await fs
        .access(writtenFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const content = await fs.readFile(writtenFile, "utf8");
      expect(content).toContain(sampleDecision.title);
      expect(content).toContain(sampleDecision.summary);
      expect(content).toContain(sampleDecision.decision);
      expect(content).toContain(sampleDecision.rationale);
      expect(content).toContain("a1b2c3d4e5f6");
    });

    it("should throw NotFoundException if decision is not found in workspace", async () => {
      prisma.engineeringDecision.findFirst.mockResolvedValue(null);

      await expect(
        service.exportDecision(mockWorkspaceId, "non-existent-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("5. File Listing & PostgreSQL Cross-Referencing", () => {
    it("should list ADR files and report matched status against database decisions", async () => {
      const listDir = await fs.mkdtemp(path.join(tempDir, "list-test-"));
      await fs.writeFile(
        path.join(listDir, "ADR-001-monorepo.md"),
        `# ADR-001: Monorepo Structure\n\n- **Status:** Accepted\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(listDir, "ADR-002-database.md"),
        `# ADR-002: PostgreSQL Storage\n\n- **Status:** Proposed\n`,
        "utf8",
      );

      prisma.engineeringDecision.findMany.mockResolvedValue([
        {
          id: "dec-db-1",
          title: "ADR-001: Monorepo Structure",
          status: "ACCEPTED",
        },
      ]);

      const files = await service.listFiles(mockWorkspaceId, {
        targetDir: listDir,
      });

      expect(files.length).toBe(2);

      const file1 = files.find((f) => f.fileName === "ADR-001-monorepo.md");
      expect(file1).toBeDefined();
      expect(file1?.existsInDatabase).toBe(true);
      expect(file1?.matchedDecisionId).toBe("dec-db-1");
      expect(file1?.matchedDecisionStatus).toBe("ACCEPTED");

      const file2 = files.find((f) => f.fileName === "ADR-002-database.md");
      expect(file2).toBeDefined();
      expect(file2?.existsInDatabase).toBe(false);
      expect(file2?.matchedDecisionId).toBeNull();
    });
  });
});
