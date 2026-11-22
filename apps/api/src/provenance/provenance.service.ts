import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Neo4jService } from "../graph/neo4j.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProvenanceGraphSyncService } from "./provenance-graph-sync.service";
import {
  ProvenanceTimelineQueryDto,
  ProvenanceTimelineResponse,
  ProvenanceTargetsResponse,
  ProvenanceNodeDto,
  ProvenanceEdgeDto,
  ProvenanceNodeType,
  ProvenanceEdgeRelation,
} from "./provenance.types";
import { sanitizeProvenanceUrl } from "./provenance-url.util";

@Injectable()
export class ProvenanceService {
  private readonly logger = new Logger(ProvenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
    private readonly workspacesService: WorkspacesService,
    private readonly syncService: ProvenanceGraphSyncService,
  ) {}

  /**
   * Verifies that the repository exists and belongs to the specified workspace,
   * and that the user has authorized membership in that workspace.
   */
  async verifyRepositoryAccess(
    workspaceId: string,
    repositoryId: string,
    userId?: string,
  ): Promise<{ id: string; fullName: string; defaultBranch: string }> {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        workspaceId: true,
        fullName: true,
        defaultBranch: true,
      },
    });

    if (!repo) {
      throw new NotFoundException(`Repository "${repositoryId}" not found`);
    }

    if (repo.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        `Cross-workspace access denied: Repository "${repositoryId}" does not belong to workspace "${workspaceId}"`,
      );
    }

    if (userId) {
      const membership = await this.workspacesService.getMembership(
        workspaceId,
        userId,
      );
      if (!membership) {
        throw new ForbiddenException(
          `User ${userId} does not have membership in workspace ${workspaceId}`,
        );
      }
    }

    return repo;
  }

  /**
   * Returns selectable target file paths and engineering decisions for the repository.
   */
  async getTargets(
    workspaceId: string,
    repositoryId: string,
    userId?: string,
  ): Promise<ProvenanceTargetsResponse> {
    const repo = await this.verifyRepositoryAccess(
      workspaceId,
      repositoryId,
      userId,
    );

    // 1. Collect file paths from CommitDiff
    const commitDiffs = await this.prisma.commitDiff.findMany({
      where: {
        commit: { repositoryId },
      },
      select: {
        filePath: true,
      },
    });

    // 2. Collect decisions for repository
    const decisions = await this.prisma.engineeringDecision.findMany({
      where: { repositoryId },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        targetFilePath: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // 3. Count events per file path
    const fileEventCounts = new Map<string, number>();
    for (const diff of commitDiffs) {
      if (diff.filePath) {
        fileEventCounts.set(
          diff.filePath,
          (fileEventCounts.get(diff.filePath) || 0) + 1,
        );
      }
    }

    for (const dec of decisions) {
      if (dec.targetFilePath) {
        fileEventCounts.set(
          dec.targetFilePath,
          (fileEventCounts.get(dec.targetFilePath) || 0) + 2,
        );
      }
    }

    const files = Array.from(fileEventCounts.entries())
      .map(([path, eventCount]) => ({ path, eventCount }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 100);

    const neo4jConfigured = Boolean(
      process.env.NEO4J_URI && process.env.NEO4J_URI.trim().length > 0,
    );
    if (!this.neo4j.isAvailable()) {
      await this.neo4j.verifyOrReconnect();
    }
    const neo4jConnected = this.neo4j.isAvailable();

    return {
      repository: {
        id: repo.id,
        name: repo.fullName.split("/")[1] || repo.fullName,
        fullName: repo.fullName,
        htmlUrl: `https://github.com/${repo.fullName}`,
      },
      files,
      decisions: decisions.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        targetFilePath: d.targetFilePath || undefined,
      })),
      neo4jStatus: {
        configured: neo4jConfigured,
        connected: neo4jConnected,
      },
    };
  }

  /**
   * Helper that bounds asynchronous operations with a strict timeout.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    errorDesc: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(errorDesc)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timer!);
    });
  }

  /**
   * Retrieves the interactive causal provenance graph and timeline for a file, symbol, decision, or repository.
   * Primary path: Neo4j multi-hop traversal.
   * Honest fallback: PostgreSQL read-only reconstruction if Neo4j is offline or unconfigured.
   */
  async getTimeline(
    workspaceId: string,
    repositoryId: string,
    query: ProvenanceTimelineQueryDto = {},
    userId?: string,
  ): Promise<ProvenanceTimelineResponse> {
    const repo = await this.verifyRepositoryAccess(
      workspaceId,
      repositoryId,
      userId,
    );

    const repoRef = {
      id: repo.id,
      name: repo.fullName.split("/")[1] || repo.fullName,
      fullName: repo.fullName,
      htmlUrl: `https://github.com/${repo.fullName}`,
    };

    // Attempt Neo4j path if connected or reconnectable
    if (!this.neo4j.isAvailable()) {
      await this.neo4j.verifyOrReconnect();
    }
    if (this.neo4j.isAvailable()) {
      try {
        const neo4jResult = await this.withTimeout(
          this.queryNeo4jTimeline(workspaceId, repositoryId, query, repoRef),
          15000,
          "Neo4j query execution timed out after 15000ms",
        );
        if (neo4jResult) {
          return neo4jResult;
        }
      } catch (err) {
        this.logger.warn(
          `Neo4j query execution encountered error; falling back to PostgreSQL causal baseline: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Honest Fallback: PostgreSQL Causal Reconstruction
    return this.reconstructPostgresTimeline(
      workspaceId,
      repositoryId,
      query,
      repoRef,
    );
  }

  /**
   * Primary Path: Multi-hop parameterized Cypher query on Neo4j.
   */
  private async queryNeo4jTimeline(
    workspaceId: string,
    repositoryId: string,
    query: ProvenanceTimelineQueryDto,
    repoRef: { id: string; name: string; fullName: string; htmlUrl?: string },
  ): Promise<ProvenanceTimelineResponse | null> {
    const limit = query.limit || 50;

    // Check if any provenance nodes exist for this repo
    const countCheck = await this.neo4j.runQuery(
      `MATCH (n)
       WHERE (n:ProvenanceCommit OR n:ProvenancePR OR n:ProvenanceDecision OR n:ProvenanceIssue)
         AND n.repositoryId = $repositoryId
         AND n.workspaceId = $workspaceId
       RETURN count(n) AS totalCount LIMIT 1`,
      { repositoryId, workspaceId },
    );

    const totalInGraph = countCheck[0]
      ? Number(countCheck[0].get("totalCount"))
      : 0;
    if (totalInGraph === 0) {
      // Auto-project if PostgreSQL has records
      const syncRes = await this.syncService.syncProvenanceGraph(
        workspaceId,
        repositoryId,
      );
      const syncedCount = syncRes.nodesSynced ?? syncRes.nodesCount ?? 0;
      if (!syncRes.synced || syncedCount === 0) {
        return null; // Fallback will handle abstention check
      }
    }

    let cypher: string;
    const params: Record<string, any> = {
      repositoryId,
      workspaceId,
      limit: Math.floor(limit),
    };

    if (query.filePath) {
      params.filePath = query.filePath;
      cypher = `
        MATCH (f:ProvenanceFile { repositoryId: $repositoryId, workspaceId: $workspaceId, path: $filePath })
        OPTIONAL MATCH (c:ProvenanceCommit)-[r1:INTRODUCED_OR_MODIFIED|REFACTORED]->(f)
        OPTIONAL MATCH (p:ProvenancePR)-[r2:INCLUDES]->(c)
        OPTIONAL MATCH (i:ProvenanceIssue)-[r3:MOTIVATED]->(p)
        OPTIONAL MATCH (i2:ProvenanceIssue)-[r4:MOTIVATED]->(c)
        OPTIONAL MATCH (d:ProvenanceDecision { repositoryId: $repositoryId, workspaceId: $workspaceId })
          WHERE d.targetFilePath = $filePath OR (c)-[:EVIDENCES]->(d) OR (p)-[:EVIDENCES]->(d)
        OPTIONAL MATCH (d)-[r5:SUPERSEDES]->(older:ProvenanceDecision)
        WITH collect(DISTINCT i) + collect(DISTINCT i2) + collect(DISTINCT p) + collect(DISTINCT c) + collect(DISTINCT d) + collect(DISTINCT older) AS matchedFromRel
        OPTIONAL MATCH (cDirect:ProvenanceCommit { repositoryId: $repositoryId, workspaceId: $workspaceId })
          WHERE $filePath IN cDirect.files
        OPTIONAL MATCH (dDirect:ProvenanceDecision { repositoryId: $repositoryId, workspaceId: $workspaceId })
          WHERE dDirect.targetFilePath = $filePath
        WITH matchedFromRel + collect(DISTINCT cDirect) + collect(DISTINCT dDirect) AS allNodes
        UNWIND allNodes AS n
        WITH DISTINCT n
        WHERE n IS NOT NULL
        RETURN
          n.uid AS uid,
          labels(n)[0] AS nodeType,
          properties(n) AS props
        LIMIT toInteger($limit)
      `;
    } else if (query.decisionId) {
      params.decisionId = query.decisionId;
      cypher = `
        MATCH (d:ProvenanceDecision { repositoryId: $repositoryId, workspaceId: $workspaceId, decisionId: $decisionId })
        OPTIONAL MATCH (d)-[r1:SUPERSEDES]->(older:ProvenanceDecision)
        OPTIONAL MATCH (newer:ProvenanceDecision)-[r2:SUPERSEDES]->(d)
        OPTIONAL MATCH (c:ProvenanceCommit)-[r3:EVIDENCES]->(d)
        OPTIONAL MATCH (p:ProvenancePR)-[r4:EVIDENCES]->(d)
        OPTIONAL MATCH (p2:ProvenancePR)-[r5:INCLUDES]->(c)
        OPTIONAL MATCH (i:ProvenanceIssue)-[r6:MOTIVATED]->(p)
        OPTIONAL MATCH (i2:ProvenanceIssue)-[r7:MOTIVATED]->(c)
        WITH collect(DISTINCT d) + collect(DISTINCT older) + collect(DISTINCT newer) + collect(DISTINCT c) + collect(DISTINCT p) + collect(DISTINCT p2) + collect(DISTINCT i) + collect(DISTINCT i2) AS allNodes
        UNWIND allNodes AS n
        WITH DISTINCT n
        WHERE n IS NOT NULL
        RETURN
          n.uid AS uid,
          labels(n)[0] AS nodeType,
          properties(n) AS props
        LIMIT toInteger($limit)
      `;
    } else {
      // High-signal connected causal subgraph for default view:
      // Guarantees all issues and decisions are returned, plus connected PRs and commits across all 4 stages
      cypher = `
        MATCH (n)
        WHERE n.repositoryId = $repositoryId AND n.workspaceId = $workspaceId
          AND (n:ProvenanceIssue OR n:ProvenanceDecision)
        WITH collect(n) AS coreNodes

        OPTIONAL MATCH (p:ProvenancePR { repositoryId: $repositoryId, workspaceId: $workspaceId })
        WITH coreNodes, collect(DISTINCT p) AS prNodes

        OPTIONAL MATCH (cIntro:ProvenanceCommit { repositoryId: $repositoryId, workspaceId: $workspaceId, isRefactor: false })
        WITH coreNodes, prNodes, collect(DISTINCT cIntro) AS introCommits

        OPTIONAL MATCH (cRefactor:ProvenanceCommit { repositoryId: $repositoryId, workspaceId: $workspaceId, isRefactor: true })
        WITH coreNodes, prNodes, introCommits, collect(DISTINCT cRefactor) AS refactorCommits

        WITH coreNodes + prNodes[..6] + introCommits[..8] + refactorCommits[..8] AS allCandidateNodes
        UNWIND allCandidateNodes AS n
        WITH DISTINCT n
        WHERE n IS NOT NULL
        RETURN
          n.uid AS uid,
          labels(n)[0] AS nodeType,
          properties(n) AS props
        ORDER BY n.timestamp ASC
        LIMIT toInteger($limit)
      `;
    }

    const records = await this.neo4j.runQuery(cypher, params);
    if (!records || records.length === 0) {
      return {
        repository: repoRef,
        query: {
          filePath: query.filePath,
          symbol: query.symbol,
          decisionId: query.decisionId,
        },
        dataSource: "neo4j",
        neo4jConnected: true,
        insufficientHistory: true,
        abstentionReason:
          "Insufficient historical evidence found in repository records for the requested target.",
        nodes: [],
        edges: [],
        summary: { totalNodes: 0, countsByType: {} },
      };
    }

    // Convert Neo4j records to ProvenanceNodeDto[]
    const nodes: ProvenanceNodeDto[] = [];
    const nodeIdSet = new Set<string>();

    for (const r of records) {
      const nodeTypeLabel = r.get("nodeType") as string;
      const props = r.get("props") as Record<string, any>;
      const parsed = this.mapNeo4jNode(nodeTypeLabel, props);
      if (parsed && !nodeIdSet.has(parsed.id)) {
        nodeIdSet.add(parsed.id);
        nodes.push(parsed);
      }
    }

    // Ensure Stage 4 Evolution is properly populated with refactors
    const seenFiles = new Set<string>();
    for (const node of nodes) {
      if (node.type === "COMMIT" || node.type === "REFACTOR") {
        const isSubsequent =
          node.filePaths.length > 0 &&
          node.filePaths.every((fp) => seenFiles.has(fp));
        if (isSubsequent || node.metadata?.isRefactor) {
          node.type = "REFACTOR";
          node.stageOrder = 4;
          node.status = "REFACTORED";
          node.immutableProvenance.sourceType = "REFACTOR";
        }
        for (const fp of node.filePaths) {
          seenFiles.add(fp);
        }
      }
    }

    // Sort nodes chronologically
    nodes.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Query edges between the resolved nodes
    const nodeUids = records.map((r) => r.get("uid") as string);
    const edgesQuery = `
      MATCH (source)-[r]->(target)
      WHERE source.uid IN $nodeUids AND target.uid IN $nodeUids
      RETURN
        id(r) AS edgeId,
        source.uid AS sourceUid,
        target.uid AS targetUid,
        type(r) AS relType
    `;
    const edgeRecords = await this.neo4j.runQuery(edgesQuery, { nodeUids });

    const validNodeIds = new Set(nodes.map((n) => n.id));
    const edges: ProvenanceEdgeDto[] = [];
    const edgeKeySet = new Set<string>();

    for (const er of edgeRecords) {
      const sourceUid = er.get("sourceUid") as string;
      const targetUid = er.get("targetUid") as string;
      const relType = er.get("relType") as string;

      const sourceId = this.extractIdFromUid(sourceUid);
      const targetId = this.extractIdFromUid(targetUid);
      const key = `${sourceId}->${targetId}:${relType}`;

      if (
        validNodeIds.has(sourceId) &&
        validNodeIds.has(targetId) &&
        !edgeKeySet.has(key)
      ) {
        edgeKeySet.add(key);
        edges.push({
          id: `edge-${edges.length + 1}`,
          source: sourceId,
          target: targetId,
          relation: this.normalizeRelation(relType),
          label: this.formatEdgeLabel(relType),
        });
      }
    }

    // Supplement cross-stage relationships between resolved nodes from metadata
    let edgeSeq = edges.length + 1;
    // 1. Issue -> PR (MOTIVATED)
    for (const issueNode of nodes.filter((n) => n.type === "ISSUE")) {
      const issueRef = issueNode.immutableProvenance.referenceId;
      for (const prNode of nodes.filter((n) => n.type === "PR")) {
        const key = `${issueNode.id}->${prNode.id}:MOTIVATED`;
        if (
          !edgeKeySet.has(key) &&
          (prNode.summary.includes(issueRef) ||
            prNode.title.includes(issueRef) ||
            (issueNode.filePaths.length > 0 &&
              issueNode.filePaths.some((fp) => prNode.filePaths.includes(fp))))
        ) {
          edgeKeySet.add(key);
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: issueNode.id,
            target: prNode.id,
            relation: "MOTIVATED",
            label: "Motivated PR",
          });
        }
      }
    }

    // 2. PR -> Commit (INCLUDES)
    for (const prNode of nodes.filter((n) => n.type === "PR")) {
      const prRef = prNode.immutableProvenance.referenceId;
      for (const commitNode of nodes.filter(
        (n) => n.type === "COMMIT" || n.type === "REFACTOR",
      )) {
        const key = `${prNode.id}->${commitNode.id}:INCLUDES`;
        if (
          !edgeKeySet.has(key) &&
          (commitNode.summary.includes(prRef) ||
            commitNode.summary.includes(`pull/${prRef.replace("#", "")}`))
        ) {
          edgeKeySet.add(key);
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: prNode.id,
            target: commitNode.id,
            relation: "INCLUDES",
            label: "Included in PR",
          });
        }
      }
    }

    // 3. Commit / PR -> Decision (EVIDENCES) & Decision -> Refactor (GOVERNS)
    for (const decNode of nodes.filter(
      (n) => n.type === "DECISION" || n.type === "SUPERSEDED_DECISION",
    )) {
      const decFilePath = decNode.filePaths[0];
      if (decFilePath) {
        for (const commitNode of nodes.filter((n) =>
          n.filePaths.includes(decFilePath),
        )) {
          if (commitNode.type === "COMMIT") {
            const key = `${commitNode.id}->${decNode.id}:EVIDENCES`;
            if (!edgeKeySet.has(key)) {
              edgeKeySet.add(key);
              edges.push({
                id: `edge-${edgeSeq++}`,
                source: commitNode.id,
                target: decNode.id,
                relation: "EVIDENCES",
                label: "Evidences Decision",
              });
            }
          } else if (commitNode.type === "REFACTOR") {
            const key = `${decNode.id}->${commitNode.id}:GOVERNS`;
            if (!edgeKeySet.has(key)) {
              edgeKeySet.add(key);
              edges.push({
                id: `edge-${edgeSeq++}`,
                source: decNode.id,
                target: commitNode.id,
                relation: "GOVERNS",
                label: "Governs Refactor",
              });
            }
          }
        }
      }
    }

    const summary = this.buildSummary(nodes);

    return {
      repository: repoRef,
      query: {
        filePath: query.filePath,
        symbol: query.symbol,
        decisionId: query.decisionId,
      },
      dataSource: "neo4j",
      neo4jConnected: true,
      insufficientHistory: nodes.length === 0,
      abstentionReason:
        nodes.length === 0
          ? "Insufficient historical evidence found in repository records for the requested target."
          : undefined,
      nodes,
      edges,
      summary,
    };
  }

  /**
   * Honest Fallback: Reconstructs the exact causal provenance graph read-only from PostgreSQL.
   */
  private async reconstructPostgresTimeline(
    workspaceId: string,
    repositoryId: string,
    query: ProvenanceTimelineQueryDto,
    repoRef: { id: string; name: string; fullName: string; htmlUrl?: string },
  ): Promise<ProvenanceTimelineResponse> {
    const limit = query.limit || 50;
    const targetFile = query.filePath?.trim();
    const targetDecisionId = query.decisionId?.trim();

    // 1. Fetch relevant commits
    const commitWhere: any = { repositoryId };
    if (targetFile) {
      commitWhere.diffs = {
        some: { filePath: targetFile },
      };
    }
    const commits = await this.prisma.gitCommit.findMany({
      where: commitWhere,
      include: { diffs: true },
      orderBy: { committedAt: "asc" },
      take: limit,
    });

    // 2. Fetch relevant PRs
    const prs = await this.prisma.pullRequest.findMany({
      where: { repositoryId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // 3. Fetch relevant Issues
    const issues = await this.prisma.issue.findMany({
      where: { repositoryId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // 4. Fetch relevant Engineering Decisions
    const decisionWhere: any = { repositoryId, workspaceId };
    if (targetDecisionId) {
      decisionWhere.OR = [
        { id: targetDecisionId },
        { supersedesId: targetDecisionId },
        { supersededById: targetDecisionId },
      ];
    } else if (targetFile) {
      decisionWhere.targetFilePath = targetFile;
    }
    const decisions = await this.prisma.engineeringDecision.findMany({
      where: decisionWhere,
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // Determine earliest commit for target file to label INTRODUCED vs REFACTORED
    const earliestCommitSha = commits[0]?.sha;

    const nodes: ProvenanceNodeDto[] = [];
    const edges: ProvenanceEdgeDto[] = [];
    const addedNodeIds = new Set<string>();

    // A. Add Issues (Stage 1: Origin)
    for (const issue of issues) {
      // If filtering by file or decision, only include issue if it relates to matched PRs or commits
      let isRelevant = !targetFile && !targetDecisionId;
      if (!isRelevant) {
        const issueRef = `#${issue.number}`;
        const issueNumStr = String(issue.number);
        const touchesCommit = commits.some(
          (c) =>
            c.message.toLowerCase().includes(issueRef) ||
            c.message.includes(`issues/${issueNumStr}`),
        );
        const touchesPr = prs.some(
          (p) =>
            (p.title + " " + (p.body || "")).toLowerCase().includes(issueRef) ||
            (p.title + " " + (p.body || "")).includes(`issues/${issueNumStr}`),
        );
        isRelevant = touchesCommit || touchesPr;
      }

      if (isRelevant && !addedNodeIds.has(`issue-${issue.id}`)) {
        addedNodeIds.add(`issue-${issue.id}`);
        nodes.push({
          id: `issue-${issue.id}`,
          type: "ISSUE",
          stageOrder: 1,
          timestamp: issue.createdAt.toISOString(),
          title: `Issue #${issue.number}: ${issue.title}`,
          summary:
            (issue.body || "").slice(0, 300) ||
            "No issue description provided.",
          author: issue.author,
          status: issue.state.toUpperCase(),
          filePaths: targetFile ? [targetFile] : [],
          immutableProvenance: {
            sourceType: "ISSUE",
            referenceId: `#${issue.number}`,
            url: sanitizeProvenanceUrl(issue.url),
          },
        });
      }
    }

    // B. Add PRs (Stage 2: Implementation)
    for (const pr of prs) {
      let isRelevant = !targetFile && !targetDecisionId;
      if (!isRelevant) {
        const prRef = `#${pr.number}`;
        const touchesCommit = commits.some(
          (c) =>
            c.message.toLowerCase().includes(prRef) ||
            c.message.includes(`pull/${pr.number}`),
        );
        const touchesDecision = decisions.some(
          (d) => d.relatedPrNumber === pr.number,
        );
        isRelevant = touchesCommit || touchesDecision;
      }

      if (isRelevant && !addedNodeIds.has(`pr-${pr.id}`)) {
        addedNodeIds.add(`pr-${pr.id}`);
        nodes.push({
          id: `pr-${pr.id}`,
          type: "PR",
          stageOrder: 2,
          timestamp: (pr.mergedAt || pr.createdAt).toISOString(),
          title: `PR #${pr.number}: ${pr.title}`,
          summary:
            (pr.body || "").slice(0, 300) ||
            "Pull Request rationale and diff summary.",
          author: pr.author,
          status: pr.isMerged ? "MERGED" : pr.state.toUpperCase(),
          filePaths: targetFile ? [targetFile] : [],
          immutableProvenance: {
            sourceType: "PULL_REQUEST",
            referenceId: `#${pr.number}`,
            url: sanitizeProvenanceUrl(pr.url),
          },
        });
      }
    }

    // C. Add Commits (Stage 2: Implementation / Stage 4: Refactor)
    const earliestCommitPerFile = new Map<string, string>();
    for (const commit of commits) {
      for (const diff of commit.diffs) {
        if (!earliestCommitPerFile.has(diff.filePath)) {
          earliestCommitPerFile.set(diff.filePath, commit.sha);
        }
      }
    }

    for (const commit of commits) {
      if (!addedNodeIds.has(`commit-${commit.id}`)) {
        addedNodeIds.add(`commit-${commit.id}`);
        const introducesAnyFile = commit.diffs.some(
          (d) => earliestCommitPerFile.get(d.filePath) === commit.sha,
        );
        const isRefactor =
          (targetFile &&
            earliestCommitSha &&
            commit.sha !== earliestCommitSha) ||
          (!targetFile && !introducesAnyFile && commit.diffs.length > 0);
        const nodeType: ProvenanceNodeType = isRefactor ? "REFACTOR" : "COMMIT";
        const stageOrder = isRefactor ? 4 : 2;

        const filesTouched = commit.diffs.map((d) => d.filePath);
        nodes.push({
          id: `commit-${commit.id}`,
          type: nodeType,
          stageOrder,
          timestamp: commit.committedAt.toISOString(),
          title: commit.message.split("\n")[0] || commit.sha.slice(0, 7),
          summary: commit.message,
          author: commit.authorName,
          status: isRefactor ? "REFACTORED" : "COMMITTED",
          filePaths: filesTouched,
          immutableProvenance: {
            sourceType: isRefactor ? "REFACTOR" : "COMMIT",
            referenceId: commit.sha,
            shortHash: commit.sha.slice(0, 7),
            url: sanitizeProvenanceUrl(commit.url),
          },
        });
      }
    }

    // D. Add Decisions (Stage 3: Decision Memory / Stage 4: Superseded)
    for (const dec of decisions) {
      if (!addedNodeIds.has(`decision-${dec.id}`)) {
        addedNodeIds.add(`decision-${dec.id}`);
        const isSuperseded =
          dec.status === "SUPERSEDED" || Boolean(dec.supersededById);
        const nodeType: ProvenanceNodeType = isSuperseded
          ? "SUPERSEDED_DECISION"
          : "DECISION";
        const stageOrder = isSuperseded ? 4 : 3;

        nodes.push({
          id: `decision-${dec.id}`,
          type: nodeType,
          stageOrder,
          timestamp: dec.createdAt.toISOString(),
          title: `Decision: ${dec.title}`,
          summary:
            `${dec.summary || ""}\n\nRationale: ${dec.rationale || ""}`.trim(),
          author: dec.reviewerName || "Engineering Team",
          status: dec.status,
          filePaths: dec.targetFilePath ? [dec.targetFilePath] : [],
          immutableProvenance: {
            sourceType: "ENGINEERING_DECISION",
            referenceId: dec.id,
            url: undefined,
          },
          metadata: {
            severity: dec.severity,
            supersedesId: dec.supersedesId,
            supersededById: dec.supersededById,
          },
        });
      }
    }

    // Explicit Abstention check if filtered target had zero evidence
    if (nodes.length === 0) {
      return {
        repository: repoRef,
        query: {
          filePath: query.filePath,
          symbol: query.symbol,
          decisionId: query.decisionId,
        },
        dataSource: "postgres_fallback",
        neo4jConnected: false,
        insufficientHistory: true,
        abstentionReason:
          "Insufficient historical evidence found in repository records for the requested target.",
        nodes: [],
        edges: [],
        summary: { totalNodes: 0, countsByType: {} },
      };
    }

    // Sort nodes chronologically
    nodes.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Build Causal Edges
    let edgeSeq = 1;
    // 1. Issue -> PR & Issue -> Commit
    for (const issueNode of nodes.filter((n) => n.type === "ISSUE")) {
      const issueNum = issueNode.immutableProvenance.referenceId;
      for (const prNode of nodes.filter((n) => n.type === "PR")) {
        if (
          prNode.summary.includes(issueNum) ||
          prNode.title.includes(issueNum)
        ) {
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: issueNode.id,
            target: prNode.id,
            relation: "MOTIVATED",
            label: "Motivated PR",
          });
        }
      }
      for (const commitNode of nodes.filter(
        (n) => n.type === "COMMIT" || n.type === "REFACTOR",
      )) {
        if (commitNode.summary.includes(issueNum)) {
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: issueNode.id,
            target: commitNode.id,
            relation: "MOTIVATED",
            label: "Addressed Issue",
          });
        }
      }
    }

    // 2. PR -> Commit (INCLUDES)
    for (const prNode of nodes.filter((n) => n.type === "PR")) {
      const prRef = prNode.immutableProvenance.referenceId;
      for (const commitNode of nodes.filter(
        (n) => n.type === "COMMIT" || n.type === "REFACTOR",
      )) {
        if (
          commitNode.summary.includes(prRef) ||
          commitNode.summary.includes(`pull/${prRef.replace("#", "")}`)
        ) {
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: prNode.id,
            target: commitNode.id,
            relation: "INCLUDES",
            label: "Included in PR",
          });
        }
      }
    }

    // 3. Commit / PR -> Decision (EVIDENCES)
    for (const decNode of nodes.filter(
      (n) => n.type === "DECISION" || n.type === "SUPERSEDED_DECISION",
    )) {
      const decRecord = decisions.find(
        (d) => `decision-${d.id}` === decNode.id,
      );
      if (decRecord?.relatedCommitSha) {
        const commitNode = nodes.find(
          (c) =>
            c.immutableProvenance.referenceId === decRecord.relatedCommitSha,
        );
        if (commitNode) {
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: commitNode.id,
            target: decNode.id,
            relation: "EVIDENCES",
            label: "Evidences Decision",
          });
        }
      }
      if (decRecord?.relatedPrNumber) {
        const prNode = nodes.find(
          (p) =>
            p.immutableProvenance.referenceId ===
            `#${decRecord.relatedPrNumber}`,
        );
        if (prNode) {
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: prNode.id,
            target: decNode.id,
            relation: "EVIDENCES",
            label: "Evidences Decision",
          });
        }
      }
      // Decision -> Superseded Decision (SUPERSEDES)
      if (decRecord?.supersedesId) {
        const olderNode = nodes.find(
          (d) => d.id === `decision-${decRecord.supersedesId}`,
        );
        if (olderNode) {
          edges.push({
            id: `edge-${edgeSeq++}`,
            source: decNode.id,
            target: olderNode.id,
            relation: "SUPERSEDES",
            label: "Supersedes Decision",
          });
        }
      }
    }

    // 4. Introducing Commit -> Subsequent Refactor Commits (REFACTORED)
    const introducingCommit = nodes.find((n) => n.type === "COMMIT");
    if (introducingCommit) {
      for (const refactorNode of nodes.filter((n) => n.type === "REFACTOR")) {
        edges.push({
          id: `edge-${edgeSeq++}`,
          source: introducingCommit.id,
          target: refactorNode.id,
          relation: "REFACTORED",
          label: "Subsequent Refactor",
        });
      }
    }

    // 5. Chronological commit evolution chaining on same file (PRECEDED_BY)
    const commitsByFile = new Map<
      string,
      Array<{ id: string; timestamp: string }>
    >();
    for (const c of nodes.filter(
      (n) => n.type === "COMMIT" || n.type === "REFACTOR",
    )) {
      for (const fp of c.filePaths) {
        if (!commitsByFile.has(fp)) commitsByFile.set(fp, []);
        commitsByFile.get(fp)!.push({ id: c.id, timestamp: c.timestamp });
      }
    }
    for (const [_fp, fileCommits] of commitsByFile.entries()) {
      if (fileCommits.length > 1) {
        fileCommits.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        for (let i = 0; i < fileCommits.length - 1; i++) {
          const c1 = fileCommits[i];
          const c2 = fileCommits[i + 1];
          if (c1.id !== c2.id) {
            edges.push({
              id: `edge-${edgeSeq++}`,
              source: c1.id,
              target: c2.id,
              relation: "PRECEDED_BY",
              label: "Preceded By",
            });
          }
        }
      }
    }

    const validNodeIds = new Set(nodes.map((n) => n.id));
    const filteredEdges = edges.filter(
      (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
    );

    const summary = this.buildSummary(nodes);

    return {
      repository: repoRef,
      query: {
        filePath: query.filePath,
        symbol: query.symbol,
        decisionId: query.decisionId,
      },
      dataSource: "postgres_fallback",
      neo4jConnected: false,
      insufficientHistory: false,
      nodes,
      edges: filteredEdges,
      summary,
    };
  }

  private mapNeo4jNode(
    label: string,
    props: Record<string, any>,
  ): ProvenanceNodeDto | null {
    if (!props) return null;

    if (label === "ProvenanceIssue") {
      return {
        id: `issue-${props.number || props.uid}`,
        type: "ISSUE",
        stageOrder: 1,
        timestamp: props.timestamp || new Date().toISOString(),
        title: `Issue #${props.number}: ${props.title || "Untitled Issue"}`,
        summary: props.excerpt || props.title || "GitHub Issue reference",
        author: props.author || "Unknown",
        status: (props.state || "OPEN").toUpperCase(),
        filePaths: [],
        immutableProvenance: {
          sourceType: "ISSUE",
          referenceId: `#${props.number}`,
          url: sanitizeProvenanceUrl(props.url),
        },
      };
    }

    if (label === "ProvenancePR") {
      return {
        id: `pr-${props.number || props.uid}`,
        type: "PR",
        stageOrder: 2,
        timestamp: props.timestamp || new Date().toISOString(),
        title: `PR #${props.number}: ${props.title || "Untitled PR"}`,
        summary:
          props.excerpt ||
          props.title ||
          "Pull request implementation rationale",
        author: props.author || "Unknown",
        status: (props.state || "MERGED").toUpperCase(),
        filePaths: [],
        immutableProvenance: {
          sourceType: "PULL_REQUEST",
          referenceId: `#${props.number}`,
          url: sanitizeProvenanceUrl(props.url),
        },
      };
    }

    if (label === "ProvenanceCommit") {
      const sha = props.sha || "unknown";
      const isRefactor = Boolean(props.isRefactor);
      return {
        id: `commit-${sha}`,
        type: isRefactor ? "REFACTOR" : "COMMIT",
        stageOrder: isRefactor ? 4 : 2,
        timestamp: props.timestamp || new Date().toISOString(),
        title: props.title || sha.slice(0, 7),
        summary: props.message || "Git commit",
        author: props.author || "Developer",
        status: isRefactor ? "REFACTORED" : "COMMITTED",
        filePaths: Array.isArray(props.files) ? props.files : [],
        immutableProvenance: {
          sourceType: isRefactor ? "REFACTOR" : "COMMIT",
          referenceId: sha,
          shortHash: sha.slice(0, 7),
          url: sanitizeProvenanceUrl(props.url),
        },
      };
    }

    if (label === "ProvenanceDecision") {
      const isSuperseded =
        props.status === "SUPERSEDED" || Boolean(props.supersededById);
      return {
        id: `decision-${props.decisionId || props.uid}`,
        type: isSuperseded ? "SUPERSEDED_DECISION" : "DECISION",
        stageOrder: isSuperseded ? 4 : 3,
        timestamp: props.timestamp || new Date().toISOString(),
        title: `Decision: ${props.title || "Engineering Decision"}`,
        summary:
          `${props.description || ""}\n\nRationale: ${props.rationale || ""}`.trim(),
        author: "Engineering Reviewer",
        status: props.status || "ACCEPTED",
        filePaths: props.targetFilePath ? [props.targetFilePath] : [],
        immutableProvenance: {
          sourceType: "ENGINEERING_DECISION",
          referenceId: props.decisionId || props.uid,
          url: undefined,
        },
      };
    }

    return null;
  }

  private extractIdFromUid(uid: string): string {
    const parts = uid.split(":");
    if (parts.length >= 3) {
      const type = parts[1];
      const val = parts.slice(2).join(":");
      return `${type}-${val}`;
    }
    return uid;
  }

  private normalizeRelation(rel: string): ProvenanceEdgeRelation {
    const valid: ProvenanceEdgeRelation[] = [
      "MOTIVATED",
      "INCLUDES",
      "INTRODUCED",
      "EVIDENCES",
      "GOVERNS",
      "REFACTORED",
      "SUPERSEDES",
      "PRECEDED_BY",
    ];
    if (valid.includes(rel as ProvenanceEdgeRelation)) {
      return rel as ProvenanceEdgeRelation;
    }
    if (rel === "INTRODUCED_OR_MODIFIED") return "INTRODUCED";
    if (rel === "PRECEDED_BY") return "PRECEDED_BY";
    return "EVIDENCES";
  }

  private formatEdgeLabel(rel: string): string {
    switch (rel) {
      case "MOTIVATED":
        return "Motivated";
      case "INCLUDES":
        return "Includes";
      case "INTRODUCED_OR_MODIFIED":
      case "INTRODUCED":
        return "Introduced";
      case "REFACTORED":
        return "Refactored";
      case "EVIDENCES":
        return "Evidences";
      case "GOVERNS":
        return "Governs";
      case "SUPERSEDES":
        return "Supersedes";
      case "PRECEDED_BY":
        return "Preceded By";
      default:
        return rel;
    }
  }

  private buildSummary(nodes: ProvenanceNodeDto[]) {
    const countsByType: Record<string, number> = {};
    let earliest: string | undefined;
    let latest: string | undefined;

    for (const node of nodes) {
      countsByType[node.type] = (countsByType[node.type] || 0) + 1;
      if (
        !earliest ||
        new Date(node.timestamp).getTime() < new Date(earliest).getTime()
      ) {
        earliest = node.timestamp;
      }
      if (
        !latest ||
        new Date(node.timestamp).getTime() > new Date(latest).getTime()
      ) {
        latest = node.timestamp;
      }
    }

    return {
      totalNodes: nodes.length,
      countsByType,
      earliestTimestamp: earliest,
      latestTimestamp: latest,
    };
  }
}
