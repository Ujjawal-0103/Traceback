import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Neo4jService } from "../graph/neo4j.service";
import { ProvenanceSyncResponse } from "./provenance.types";
import { sanitizeProvenanceUrl } from "./provenance-url.util";

@Injectable()
export class ProvenanceGraphSyncService {
  private readonly logger = new Logger(ProvenanceGraphSyncService.name);
  private readonly activeSyncs = new Map<
    string,
    Promise<ProvenanceSyncResponse>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
  ) {}

  /**
   * Initializes constraints and indexes for Provenance graph nodes.
   */
  async initializeSchema(): Promise<void> {
    if (!this.neo4j.isAvailable()) {
      return;
    }

    const constraints = [
      "CREATE CONSTRAINT prov_issue_id_uniq IF NOT EXISTS FOR (i:ProvenanceIssue) REQUIRE i.uid IS UNIQUE",
      "CREATE CONSTRAINT prov_pr_id_uniq IF NOT EXISTS FOR (p:ProvenancePR) REQUIRE p.uid IS UNIQUE",
      "CREATE CONSTRAINT prov_commit_id_uniq IF NOT EXISTS FOR (c:ProvenanceCommit) REQUIRE c.uid IS UNIQUE",
      "CREATE CONSTRAINT prov_decision_id_uniq IF NOT EXISTS FOR (d:ProvenanceDecision) REQUIRE d.uid IS UNIQUE",
      "CREATE CONSTRAINT prov_file_id_uniq IF NOT EXISTS FOR (f:ProvenanceFile) REQUIRE f.uid IS UNIQUE",
    ];

    for (const cypher of constraints) {
      try {
        await this.neo4j.runQuery(cypher);
      } catch (err) {
        this.logger.debug(
          `Constraint init note: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Projects PostgreSQL repository provenance records into Neo4j using idempotent Cypher MERGE.
   * Concurrency-safe: Deduplicates overlapping requests for the same repository using an in-flight Promise map.
   * High-performance: Batches all nodes and relationships using UNWIND Cypher queries.
   */
  async syncProvenanceGraph(
    workspaceId: string,
    repositoryId: string,
  ): Promise<ProvenanceSyncResponse> {
    const lockKey = `${workspaceId}:${repositoryId}`;
    const existing = this.activeSyncs.get(lockKey);
    if (existing) {
      this.logger.log(
        `[ProvenanceSync] In-flight sync already active for repo ${repositoryId}; awaiting existing projection.`,
      );
      return existing;
    }

    const syncPromise = this.doSyncProvenanceGraph(
      workspaceId,
      repositoryId,
    ).finally(() => {
      this.activeSyncs.delete(lockKey);
    });

    this.activeSyncs.set(lockKey, syncPromise);
    return syncPromise;
  }

  private async doSyncProvenanceGraph(
    workspaceId: string,
    repositoryId: string,
  ): Promise<ProvenanceSyncResponse> {
    const startTime = Date.now();

    // Check connectivity or attempt reconnect
    if (!this.neo4j.isAvailable()) {
      await this.neo4j.verifyOrReconnect();
    }

    if (!this.neo4j.isAvailable()) {
      return {
        repositoryId,
        synced: false,
        neo4jConnected: false,
        nodesSynced: 0,
        edgesSynced: 0,
        message:
          "Neo4j is not connected. Configure NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD (AuraDB or local Docker bolt://localhost:7687) and restart API.",
      };
    }

    const repo = await this.prisma.repository.findFirst({
      where: { id: repositoryId, workspaceId },
      include: {
        commits: {
          include: { diffs: true },
          orderBy: { committedAt: "asc" },
        },
        pullRequests: {
          orderBy: { createdAt: "asc" },
        },
        issues: {
          orderBy: { createdAt: "asc" },
        },
        engineeringDecisions: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!repo) {
      return {
        repositoryId,
        synced: false,
        neo4jConnected: true,
        nodesSynced: 0,
        edgesSynced: 0,
        message: `Repository ${repositoryId} not found in workspace ${workspaceId}.`,
      };
    }

    await this.initializeSchema();

    // =========================================================================
    // IN-MEMORY AGGREGATION FOR BATCHED UNWIND (Eliminates N+1 Cypher calls)
    // =========================================================================

    // 1. Files & Commits
    const filesMap = new Map<
      string,
      { uid: string; repositoryId: string; workspaceId: string; path: string }
    >();
    const commitRows: Array<{
      uid: string;
      repositoryId: string;
      workspaceId: string;
      sha: string;
      title: string;
      message: string;
      url: string;
      author: string;
      timestamp: string;
      files: string[];
    }> = [];

    const introducedEdges: Array<{
      commitUid: string;
      fileUid: string;
      status: string;
      additions: number;
      deletions: number;
    }> = [];
    const refactoredEdges: Array<{
      commitUid: string;
      fileUid: string;
      status: string;
      additions: number;
      deletions: number;
    }> = [];
    const precededByEdges: Array<{ c1Uid: string; c2Uid: string }> = [];

    const earliestCommitPerFile = new Map<string, string>();
    const commitsByFile = new Map<
      string,
      Array<{ sha: string; committedAt: Date }>
    >();

    // First pass: identify earliest introducing commit per file path
    for (const commit of repo.commits) {
      for (const diff of commit.diffs) {
        if (!earliestCommitPerFile.has(diff.filePath)) {
          earliestCommitPerFile.set(diff.filePath, commit.sha);
        }
      }
    }

    const commitRefactoredCommitEdges: Array<{
      c1Uid: string;
      c2Uid: string;
    }> = [];

    for (const commit of repo.commits) {
      const commitUid = `${repositoryId}:commit:${commit.sha}`;
      const safeUrl = sanitizeProvenanceUrl(commit.url);
      const commitTitle =
        commit.message.split("\n")[0] || commit.sha.slice(0, 7);

      const introducesAnyFile = commit.diffs.some(
        (d) => earliestCommitPerFile.get(d.filePath) === commit.sha,
      );
      const isRefactor = !introducesAnyFile && commit.diffs.length > 0;

      commitRows.push({
        uid: commitUid,
        repositoryId,
        workspaceId,
        sha: commit.sha,
        title: commitTitle,
        message: commit.message,
        url: safeUrl || "",
        author: commit.authorName,
        timestamp: commit.committedAt.toISOString(),
        files: commit.diffs.map((d) => d.filePath),
        isRefactor,
      } as any);

      for (const diff of commit.diffs) {
        const fileUid = `${repositoryId}:file:${diff.filePath}`;
        if (!filesMap.has(fileUid)) {
          filesMap.set(fileUid, {
            uid: fileUid,
            repositoryId,
            workspaceId,
            path: diff.filePath,
          });
        }

        if (!commitsByFile.has(diff.filePath)) {
          commitsByFile.set(diff.filePath, []);
        }
        commitsByFile.get(diff.filePath)!.push({
          sha: commit.sha,
          committedAt: commit.committedAt,
        });

        const earliestSha = earliestCommitPerFile.get(diff.filePath);
        if (earliestSha === commit.sha) {
          introducedEdges.push({
            commitUid,
            fileUid,
            status: diff.status,
            additions: diff.additions,
            deletions: diff.deletions,
          });
        } else {
          refactoredEdges.push({
            commitUid,
            fileUid,
            status: diff.status,
            additions: diff.additions,
            deletions: diff.deletions,
          });

          if (earliestSha) {
            const earliestUid = `${repositoryId}:commit:${earliestSha}`;
            commitRefactoredCommitEdges.push({
              c1Uid: earliestUid,
              c2Uid: commitUid,
            });
          }
        }
      }
    }

    // Chronological Commit Evolution Chaining (PRECEDED_BY)
    for (const [_fp, fileCommits] of commitsByFile.entries()) {
      if (fileCommits.length > 1) {
        fileCommits.sort(
          (a, b) => a.committedAt.getTime() - b.committedAt.getTime(),
        );
        for (let i = 0; i < fileCommits.length - 1; i++) {
          const c1Uid = `${repositoryId}:commit:${fileCommits[i].sha}`;
          const c2Uid = `${repositoryId}:commit:${fileCommits[i + 1].sha}`;
          precededByEdges.push({ c1Uid, c2Uid });
        }
      }
    }

    // 2. Pull Requests
    const prRows: Array<{
      uid: string;
      repositoryId: string;
      workspaceId: string;
      externalId: string;
      number: number;
      title: string;
      url: string;
      author: string;
      timestamp: string;
      state: string;
      excerpt: string;
    }> = [];
    const prIncludesCommitEdges: Array<{ prUid: string; commitUid: string }> =
      [];

    for (const pr of repo.pullRequests) {
      const prUid = `${repositoryId}:pr:${pr.number}`;
      const safeUrl = sanitizeProvenanceUrl(pr.url);

      prRows.push({
        uid: prUid,
        repositoryId,
        workspaceId,
        externalId: String(pr.number),
        number: pr.number,
        title: pr.title,
        url: safeUrl || "",
        author: pr.author,
        timestamp: (pr.mergedAt || pr.createdAt).toISOString(),
        state: pr.isMerged ? "merged" : pr.state,
        excerpt: (pr.body || "").slice(0, 300),
      });

      for (const commit of repo.commits) {
        const commitMsg = commit.message.toLowerCase();
        const prRefPattern = new RegExp(`(#|pull\\/)${pr.number}\\b`, "i");
        if (prRefPattern.test(commitMsg)) {
          const commitUid = `${repositoryId}:commit:${commit.sha}`;
          prIncludesCommitEdges.push({ prUid, commitUid });
        }
      }
    }

    // 3. Issues and Motivation Links
    const issueRows: Array<{
      uid: string;
      repositoryId: string;
      workspaceId: string;
      externalId: string;
      number: number;
      title: string;
      url: string;
      author: string;
      timestamp: string;
      state: string;
      excerpt: string;
    }> = [];
    const issueMotivatedPrEdges: Array<{ issueUid: string; prUid: string }> =
      [];
    const issueMotivatedCommitEdges: Array<{
      issueUid: string;
      commitUid: string;
    }> = [];

    for (const issue of repo.issues) {
      const issueUid = `${repositoryId}:issue:${issue.number}`;
      const safeUrl = sanitizeProvenanceUrl(issue.url);

      issueRows.push({
        uid: issueUid,
        repositoryId,
        workspaceId,
        externalId: String(issue.number),
        number: issue.number,
        title: issue.title,
        url: safeUrl || "",
        author: issue.author,
        timestamp: issue.createdAt.toISOString(),
        state: issue.state,
        excerpt: (issue.body || "").slice(0, 300),
      });

      for (const pr of repo.pullRequests) {
        const prText = `${pr.title} ${pr.body || ""}`.toLowerCase();
        const issueRefPattern = new RegExp(
          `(#|issues\\/)${issue.number}\\b`,
          "i",
        );
        const issueWords = (issue.title + " " + (issue.body || ""))
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 5);
        const matchingWords = issueWords.filter((w) => prText.includes(w));
        const sharesTopic = matchingWords.length >= 2;

        if (issueRefPattern.test(prText) || sharesTopic) {
          const prUid = `${repositoryId}:pr:${pr.number}`;
          issueMotivatedPrEdges.push({ issueUid, prUid });
        }
      }

      for (const commit of repo.commits) {
        const commitMsg = commit.message.toLowerCase();
        const issueRefPattern = new RegExp(
          `(#|issues\\/)${issue.number}\\b`,
          "i",
        );
        const issueWords = (issue.title + " " + (issue.body || ""))
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 5);
        const matchingWords = issueWords.filter((w) => commitMsg.includes(w));
        const sharesTopic = matchingWords.length >= 2;

        if (issueRefPattern.test(commitMsg) || sharesTopic) {
          const commitUid = `${repositoryId}:commit:${commit.sha}`;
          issueMotivatedCommitEdges.push({ issueUid, commitUid });
        }
      }
    }

    // 4. Engineering Decisions and Governing/Evidence/Supersession Links
    const decisionRows: Array<{
      uid: string;
      repositoryId: string;
      workspaceId: string;
      decisionId: string;
      title: string;
      status: string;
      rationale: string;
      description: string;
      timestamp: string;
      targetFilePath: string;
      supersededById: string;
    }> = [];
    const decisionGovernsFileEdges: Array<{ decUid: string; fileUid: string }> =
      [];
    const decisionGovernsCommitEdges: Array<{
      decUid: string;
      commitUid: string;
    }> = [];
    const commitEvidencesDecisionEdges: Array<{
      commitUid: string;
      decUid: string;
    }> = [];
    const prEvidencesDecisionEdges: Array<{ prUid: string; decUid: string }> =
      [];
    const decisionSupersedesEdges: Array<{
      decUid: string;
      olderDecUid: string;
    }> = [];

    for (const dec of repo.engineeringDecisions) {
      const decUid = `${repositoryId}:decision:${dec.id}`;

      decisionRows.push({
        uid: decUid,
        repositoryId,
        workspaceId,
        decisionId: dec.id,
        title: dec.title,
        status: dec.status,
        rationale: dec.rationale || "",
        description: dec.summary || dec.decision || "",
        timestamp: dec.createdAt.toISOString(),
        targetFilePath: dec.targetFilePath || "",
        supersededById: dec.supersededById || "",
      });

      if (dec.targetFilePath) {
        const fileUid = `${repositoryId}:file:${dec.targetFilePath}`;
        if (!filesMap.has(fileUid)) {
          filesMap.set(fileUid, {
            uid: fileUid,
            repositoryId,
            workspaceId,
            path: dec.targetFilePath,
          });
        }
        decisionGovernsFileEdges.push({ decUid, fileUid });

        const fileCommits = repo.commits.filter((c) =>
          c.diffs.some((d) => d.filePath === dec.targetFilePath),
        );
        for (const fc of fileCommits) {
          const commitUid = `${repositoryId}:commit:${fc.sha}`;
          commitEvidencesDecisionEdges.push({ commitUid, decUid });
          decisionGovernsCommitEdges.push({ decUid, commitUid });
        }
      }

      if (dec.relatedCommitSha) {
        const commitUid = `${repositoryId}:commit:${dec.relatedCommitSha}`;
        commitEvidencesDecisionEdges.push({ commitUid, decUid });
      }

      if (dec.relatedPrNumber) {
        const prUid = `${repositoryId}:pr:${dec.relatedPrNumber}`;
        prEvidencesDecisionEdges.push({ prUid, decUid });
      }

      if (dec.supersedesId) {
        const olderDecUid = `${repositoryId}:decision:${dec.supersedesId}`;
        decisionSupersedesEdges.push({ decUid, olderDecUid });
      }
    }

    // =========================================================================
    // EXECUTE BATCHED UNWIND CYPHER QUERIES (Target < 3 seconds)
    // =========================================================================

    // 1. Files
    const fileRows = Array.from(filesMap.values());
    await this.runChunked(
      `UNWIND $rows AS row
       MERGE (f:ProvenanceFile { uid: row.uid })
       ON CREATE SET f.repositoryId = row.repositoryId, f.workspaceId = row.workspaceId, f.path = row.path
       ON MATCH SET f.path = row.path`,
      fileRows,
    );

    // 2. Commits
    await this.runChunked(
      `UNWIND $rows AS row
       MERGE (c:ProvenanceCommit { uid: row.uid })
       ON CREATE SET
         c.repositoryId = row.repositoryId, c.workspaceId = row.workspaceId,
         c.sha = row.sha, c.title = row.title, c.message = row.message,
         c.url = row.url, c.author = row.author, c.timestamp = row.timestamp,
         c.files = row.files, c.isRefactor = row.isRefactor
       ON MATCH SET
         c.title = row.title, c.message = row.message, c.url = row.url,
         c.author = row.author, c.timestamp = row.timestamp, c.files = row.files,
         c.isRefactor = row.isRefactor`,
      commitRows,
    );

    // 3. PRs
    await this.runChunked(
      `UNWIND $rows AS row
       MERGE (p:ProvenancePR { uid: row.uid })
       ON CREATE SET
         p.repositoryId = row.repositoryId, p.workspaceId = row.workspaceId,
         p.externalId = row.externalId, p.number = row.number, p.title = row.title,
         p.url = row.url, p.author = row.author, p.timestamp = row.timestamp,
         p.state = row.state, p.excerpt = row.excerpt
       ON MATCH SET
         p.title = row.title, p.url = row.url, p.author = row.author,
         p.timestamp = row.timestamp, p.state = row.state, p.excerpt = row.excerpt`,
      prRows,
    );

    // 4. Issues
    await this.runChunked(
      `UNWIND $rows AS row
       MERGE (i:ProvenanceIssue { uid: row.uid })
       ON CREATE SET
         i.repositoryId = row.repositoryId, i.workspaceId = row.workspaceId,
         i.externalId = row.externalId, i.number = row.number, i.title = row.title,
         i.url = row.url, i.author = row.author, i.timestamp = row.timestamp,
         i.state = row.state, i.excerpt = row.excerpt
       ON MATCH SET
         i.title = row.title, i.url = row.url, i.author = row.author,
         i.timestamp = row.timestamp, i.state = row.state, i.excerpt = row.excerpt`,
      issueRows,
    );

    // 5. Decisions
    await this.runChunked(
      `UNWIND $rows AS row
       MERGE (d:ProvenanceDecision { uid: row.uid })
       ON CREATE SET
         d.repositoryId = row.repositoryId, d.workspaceId = row.workspaceId,
         d.decisionId = row.decisionId, d.title = row.title, d.status = row.status,
         d.rationale = row.rationale, d.description = row.description,
         d.timestamp = row.timestamp, d.targetFilePath = row.targetFilePath,
         d.supersededById = row.supersededById
       ON MATCH SET
         d.title = row.title, d.status = row.status, d.rationale = row.rationale,
         d.description = row.description, d.timestamp = row.timestamp,
         d.targetFilePath = row.targetFilePath, d.supersededById = row.supersededById`,
      decisionRows,
    );

    // 6. Relationships (Batched)
    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (c:ProvenanceCommit { uid: row.commitUid })
       MATCH (f:ProvenanceFile { uid: row.fileUid })
       MERGE (c)-[r:INTRODUCED_OR_MODIFIED]->(f)
       ON CREATE SET r.status = row.status, r.additions = row.additions, r.deletions = row.deletions`,
      introducedEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (c:ProvenanceCommit { uid: row.commitUid })
       MATCH (f:ProvenanceFile { uid: row.fileUid })
       MERGE (c)-[r:REFACTORED]->(f)
       ON CREATE SET r.status = row.status, r.additions = row.additions, r.deletions = row.deletions`,
      refactoredEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (c1:ProvenanceCommit { uid: row.c1Uid })
       MATCH (c2:ProvenanceCommit { uid: row.c2Uid })
       MERGE (c1)-[:PRECEDED_BY]->(c2)`,
      precededByEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (c1:ProvenanceCommit { uid: row.c1Uid })
       MATCH (c2:ProvenanceCommit { uid: row.c2Uid })
       MERGE (c1)-[:REFACTORED]->(c2)`,
      commitRefactoredCommitEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (p:ProvenancePR { uid: row.prUid })
       MATCH (c:ProvenanceCommit { uid: row.commitUid })
       MERGE (p)-[:INCLUDES]->(c)`,
      prIncludesCommitEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (i:ProvenanceIssue { uid: row.issueUid })
       MATCH (p:ProvenancePR { uid: row.prUid })
       MERGE (i)-[:MOTIVATED]->(p)`,
      issueMotivatedPrEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (i:ProvenanceIssue { uid: row.issueUid })
       MATCH (c:ProvenanceCommit { uid: row.commitUid })
       MERGE (i)-[:MOTIVATED]->(c)`,
      issueMotivatedCommitEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (d:ProvenanceDecision { uid: row.decUid })
       MATCH (f:ProvenanceFile { uid: row.fileUid })
       MERGE (d)-[:GOVERNS]->(f)`,
      decisionGovernsFileEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (d:ProvenanceDecision { uid: row.decUid })
       MATCH (c:ProvenanceCommit { uid: row.commitUid })
       MERGE (d)-[:GOVERNS]->(c)`,
      decisionGovernsCommitEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (c:ProvenanceCommit { uid: row.commitUid })
       MATCH (d:ProvenanceDecision { uid: row.decUid })
       MERGE (c)-[:EVIDENCES]->(d)`,
      commitEvidencesDecisionEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (p:ProvenancePR { uid: row.prUid })
       MATCH (d:ProvenanceDecision { uid: row.decUid })
       MERGE (p)-[:EVIDENCES]->(d)`,
      prEvidencesDecisionEdges,
    );

    await this.runChunked(
      `UNWIND $rows AS row
       MATCH (d:ProvenanceDecision { uid: row.decUid })
       MATCH (older:ProvenanceDecision { uid: row.olderDecUid })
       MERGE (d)-[:SUPERSEDES]->(older)`,
      decisionSupersedesEdges,
    );

    const nodesCount =
      fileRows.length +
      commitRows.length +
      prRows.length +
      issueRows.length +
      decisionRows.length;
    const edgesCount =
      introducedEdges.length +
      refactoredEdges.length +
      precededByEdges.length +
      prIncludesCommitEdges.length +
      issueMotivatedPrEdges.length +
      issueMotivatedCommitEdges.length +
      decisionGovernsFileEdges.length +
      commitEvidencesDecisionEdges.length +
      prEvidencesDecisionEdges.length +
      decisionSupersedesEdges.length;

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `[ProvenanceSync] Projected repo ${repo.fullName}: ${nodesCount} nodes, ${edgesCount} edges in ${durationMs}ms (Batched UNWIND)`,
    );

    return {
      repositoryId,
      synced: true,
      neo4jConnected: true,
      nodesSynced: nodesCount,
      edgesSynced: edgesCount,
      nodesCount,
      edgesCount,
      syncedAt: new Date().toISOString(),
      durationMs,
      message: `Successfully synchronized ${nodesCount} graph nodes and ${edgesCount} causal edges to Neo4j in ${durationMs}ms.`,
    };
  }

  private async runChunked<T>(
    cypher: string,
    rows: T[],
    chunkSize = 200,
  ): Promise<void> {
    if (!rows || rows.length === 0) return;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await this.neo4j.runQuery(cypher, { rows: chunk });
    }
  }
}
