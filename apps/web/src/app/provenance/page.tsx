"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { RepositoryDetailsDto } from "@traceback/shared-types";
import {
  provenanceApi,
  ProvenanceTimelineResponse,
  ProvenanceNodeDto,
  ProvenanceNodeType,
  ProvenanceSyncResponse,
} from "../../lib/provenance-api";
import { ProvenanceControls } from "../../components/provenance/ProvenanceControls";
import { ProvenanceGraphCanvas } from "../../components/provenance/ProvenanceGraphCanvas";
import { ProvenanceInspectorDrawer } from "../../components/provenance/ProvenanceInspectorDrawer";
import styles from "../../components/provenance/provenance.module.css";

const DEFAULT_FILTERS: Record<ProvenanceNodeType, boolean> = {
  ISSUE: true,
  PR: true,
  COMMIT: true,
  DECISION: true,
  REFACTOR: true,
  SUPERSEDED_DECISION: true,
};

function ProvenanceContent() {
  const searchParams = useSearchParams();
  const urlRepoId = searchParams.get("repoId");
  const urlFilePath = searchParams.get("filePath");
  const urlDecisionId = searchParams.get("decisionId");
  const urlSymbol = searchParams.get("symbol");

  const { activeWorkspace } = useAuth();

  // Repository state
  const [repositories, setRepositories] = useState<RepositoryDetailsDto[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>(urlRepoId || "");
  const [isLoadingRepos, setIsLoadingRepos] = useState<boolean>(true);

  // Targets state
  const [targetFiles, setTargetFiles] = useState<
    Array<{ path: string; eventCount: number }>
  >([]);
  const [targetDecisions, setTargetDecisions] = useState<
    Array<{
      id: string;
      title: string;
      status: string;
      targetFilePath?: string;
    }>
  >([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>(
    urlFilePath || "",
  );
  const [selectedDecisionId, setSelectedDecisionId] = useState<string>(
    urlDecisionId || "",
  );

  // Timeline / Graph state
  const [timelineData, setTimelineData] =
    useState<ProvenanceTimelineResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<ProvenanceNodeDto | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"causal" | "timeline">("causal");
  const [activeFilters, setActiveFilters] =
    useState<Record<ProvenanceNodeType, boolean>>(DEFAULT_FILTERS);

  // UI state
  const [isLoadingTimeline, setIsLoadingTimeline] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
    telemetry?: ProvenanceSyncResponse;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1. Load repositories in active workspace
  useEffect(() => {
    let isMounted = true;
    async function loadRepos() {
      if (!activeWorkspace?.id) return;
      setIsLoadingRepos(true);
      setError(null);
      try {
        const repos = await api.getRepositories(activeWorkspace.id);
        if (!isMounted) return;
        setRepositories(repos);

        // Select initial repo
        if (urlRepoId && repos.some((r) => r.id === urlRepoId)) {
          setSelectedRepoId(urlRepoId);
        } else if (repos.length > 0 && !selectedRepoId) {
          setSelectedRepoId(repos[0].id);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load repositories: ${msg}`);
      } finally {
        if (isMounted) setIsLoadingRepos(false);
      }
    }

    loadRepos();
    return () => {
      isMounted = false;
    };
  }, [activeWorkspace?.id, urlRepoId, selectedRepoId]);

  // 2. Load targets when repository changes
  const loadTargets = useCallback(
    async (repoId: string) => {
      if (!repoId) return;
      try {
        const targetsRes = await provenanceApi.getTargets(
          repoId,
          activeWorkspace?.id,
        );
        setTargetFiles(targetsRes.files || []);
        setTargetDecisions(targetsRes.decisions || []);
      } catch {
        // Non-blocking fallback
        setTargetFiles([]);
        setTargetDecisions([]);
      }
    },
    [activeWorkspace?.id],
  );

  // 3. Load Timeline / Provenance Graph
  const loadTimeline = useCallback(
    async (repoId: string, filePath?: string, decisionId?: string) => {
      if (!repoId) return;
      setIsLoadingTimeline(true);
      setError(null);
      try {
        const res = await provenanceApi.getTimeline(
          repoId,
          {
            filePath: filePath?.trim() || undefined,
            decisionId: decisionId?.trim() || undefined,
            symbol: urlSymbol?.trim() || undefined,
            limit: 60,
          },
          activeWorkspace?.id,
        );
        setTimelineData(res);
        // If previous selected node is in new nodes, preserve it, otherwise null
        setSelectedNode((prev) => {
          if (!prev) return null;
          return res.nodes.find((n) => n.id === prev.id) || null;
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Error loading provenance timeline: ${msg}`);
      } finally {
        setIsLoadingTimeline(false);
      }
    },
    [activeWorkspace?.id, urlSymbol],
  );

  // Load targets when selectedRepoId changes
  useEffect(() => {
    if (selectedRepoId) {
      loadTargets(selectedRepoId);
    }
  }, [selectedRepoId, loadTargets]);

  // Load timeline when selectedRepoId, selectedFilePath, or selectedDecisionId changes
  useEffect(() => {
    if (selectedRepoId) {
      loadTimeline(selectedRepoId, selectedFilePath, selectedDecisionId);
    }
  }, [selectedRepoId, selectedFilePath, selectedDecisionId, loadTimeline]);

  // Handle Neo4j Graph Sync
  const handleSyncGraph = async () => {
    if (!selectedRepoId) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const res = await provenanceApi.syncGraph(
        selectedRepoId,
        activeWorkspace?.id,
      );
      setSyncResult({
        success: res.synced,
        message: res.message,
        telemetry: res,
      });
      // Refresh targets and timeline immediately after sync
      await Promise.all([
        loadTargets(selectedRepoId),
        loadTimeline(selectedRepoId, selectedFilePath, selectedDecisionId),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncResult({
        success: false,
        message: `Sync failed: ${msg}`,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleFilter = (type: ProvenanceNodeType) => {
    setActiveFilters((prev) => ({
      ...prev,
      [type]: !prev[type],
    }));
  };

  const handleResetQuery = () => {
    setSelectedFilePath("");
    setSelectedDecisionId("");
    setSelectedNode(null);
  };

  return (
    <div className={styles.pageContainer}>
      {/* Global Error Alert */}
      {error && (
        <div role="alert" className={styles.errorAlert}>
          {error}
        </div>
      )}

      {/* Sleek Toolbar Controls */}
      <ProvenanceControls
        repositories={repositories}
        selectedRepoId={selectedRepoId}
        onSelectRepo={(id) => {
          setSelectedRepoId(id);
          setSelectedFilePath("");
          setSelectedDecisionId("");
          setSelectedNode(null);
        }}
        files={targetFiles}
        decisions={targetDecisions}
        selectedFilePath={selectedFilePath}
        onSelectFilePath={(fp) => {
          setSelectedFilePath(fp);
          setSelectedDecisionId("");
        }}
        selectedDecisionId={selectedDecisionId}
        onSelectDecisionId={(did) => {
          setSelectedDecisionId(did);
          setSelectedFilePath("");
        }}
        activeFilters={activeFilters}
        onToggleFilter={handleToggleFilter}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        dataSource={timelineData?.dataSource || null}
        neo4jConnected={
          timelineData?.dataSource === "neo4j" &&
          Boolean(timelineData?.neo4jConnected)
        }
        onSync={handleSyncGraph}
        isSyncing={isSyncing}
        syncResult={syncResult}
        onDismissSyncResult={() => setSyncResult(null)}
        onResetQuery={handleResetQuery}
        countsByType={timelineData?.summary?.countsByType}
      />

      {/* RESPONSIVE SPLIT-PANE WORKSPACE */}
      <div className={styles.splitPane}>
        {/* Left: Interactive Dot-Grid Causal Canvas */}
        <div className={styles.canvasWrapper}>
          <ProvenanceGraphCanvas
            nodes={timelineData?.nodes || []}
            edges={timelineData?.edges || []}
            selectedNodeId={selectedNode?.id || null}
            onSelectNode={setSelectedNode}
            viewMode={viewMode}
            activeFilters={activeFilters}
            insufficientHistory={timelineData?.insufficientHistory || false}
            abstentionReason={timelineData?.abstentionReason}
            onClearFilters={handleResetQuery}
            isLoading={isLoadingRepos || isLoadingTimeline}
          />
        </div>

        {/* Right: Docked Inspector Panel */}
        <div className={styles.inspectorWrapper}>
          <ProvenanceInspectorDrawer
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onSelectTargetFile={(fp) => {
              setSelectedFilePath(fp);
              setSelectedDecisionId("");
            }}
            allNodes={timelineData?.nodes || []}
            edges={timelineData?.edges || []}
            onSelectNode={setSelectedNode}
            repositoryId={selectedRepoId}
            summary={timelineData?.summary}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProvenancePage() {
  return (
    <Suspense
      fallback={
        <div className={styles.pageContainer}>
          <div className={styles.loadingText}>Loading Provenance Graph...</div>
        </div>
      }
    >
      <ProvenanceContent />
    </Suspense>
  );
}
