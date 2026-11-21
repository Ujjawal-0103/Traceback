# Feature 4: One-Click "Evidence-to-Decision" Loop + Bidirectional ADR Sync

> **Module:** Architecture Governance & Decision Memory  
> **Status:** Production Ready & Hardened  
> **Last Verified:** 2026-11-22

---

## 1. Overview & Architectural Goals

In fast-moving codebases, developers frequently encounter architectural constraints that are critical to system stability (e.g. cache eviction policies, thread-locking invariants, data replica routing) but are poorly documented or buried in Git history. When an AI assistant explains "why the code is like this" and Traceback validates that claim against concrete Git artifacts, developers need a one-click mechanism to convert that verified historical truth into a permanent, enforceable **Engineering Decision Record** without manual copy-pasting.

Furthermore, engineering teams require decisions to live where code lives: as Git-native Markdown Architecture Decision Records (`/docs/adr/*.md`).

Feature 4 implements:

1. **One-Click Promotion:** Directly promote verified claims from `/verify` into candidate decisions with prepopulated draft fields and attached evidence citations.
2. **Human Governance & Review Attribution:** Decouple AI assessment from human decisions; candidate decisions require explicit human review and mandatory review notes before transition to `ACCEPTED`.
3. **Bidirectional `/docs/adr/*.md` Sync:** Automatically export accepted/candidate decisions to standard ADR Markdown format and import repository ADR files into PostgreSQL with duplicate prevention.
4. **Conflict Resolution & Overwrite Safety:** Timestamp-based conflict resolution preserves newer changes on disk or database, preventing accidental data loss during bidirectional sync.
5. **Multi-Tenant Workspace Security & Path Safety:** Strict role-based access control (blocking `VIEWER` users from approving decisions) and directory traversal sanitization.

---

## 2. End-to-End Architecture

```
                                      ┌──────────────────────────────────────────────┐
                                      │             /verify (Frontend)               │
                                      │  Claim: "LFU eviction prevents thrashing"    │
                                      │  Supporting Evidence: Commit 7a8b9c, PR #42  │
                                      └──────────────────────┬───────────────────────┘
                                                             │
                                                 [Promote to Decision]
                                                             │
                                                             ▼
                                      ┌──────────────────────────────────────────────┐
                                      │      Interactive Promotion Dialog            │
                                      │  - Draft title, context, rationale, target   │
                                      │  - Candidate vs. Immediate Acceptance        │
                                      │  - Mandatory review notes                    │
                                      └──────────────────────┬───────────────────────┘
                                                             │
                                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ NestJS Decisions Module (`apps/api/src/decisions`)                                                                 │
│                                                                                                                    │
│  1. proposeFromClaim(workspaceId, repoId, dto)                                                                     │
│     - Validates repository and workspace boundary                                                                  │
│     - Verifies reviewer role (blocks VIEWER from immediate acceptance)                                             │
│     - Converts Claim.evidence into EvidenceReference items (Commit, PR, Issue)                                     │
│     - Preserves createdFromClaimId and sets status (CANDIDATE | ACCEPTED)                                          │
│                                                                                                                    │
│  2. syncAdrsBidirectional(workspaceId, repoId, { direction, adrDirectory })                                        │
│     - Validates ADR directory (strictly within repository root; directory traversal blocked)                       │
│     - IMPORT: Reads *.md, sanitizes markup, checks timestamps to prevent overwriting newer DB decisions           │
│     - EXPORT: Serializes decisions to Markdown, checks file mtime to prevent overwriting newer manual disk edits   │
│     - SourceRecord Projection: Upserts ADR files into SourceRecords for evidence retrieval                         │
└────────────────────────────────────────┬───────────────────────────────────────────┬───────────────────────────────┘
                                         │                                           │
                                         ▼                                           ▼
                      ┌────────────────────────────────────┐       ┌───────────────────────────────────┐
                      │    PostgreSQL Database (Prisma)    │       │     Local Git Filesystem          │
                      │  - EngineeringDecision table       │       │   docs/adr/                       │
                      │  - SourceRecord (sourceType: ADR)  │       │     ADR-001-lfu-cache.md          │
                      │  - Append-only audit history       │       │     ADR-002-read-replicas.md      │
                      └────────────────────────────────────┘       └───────────────────────────────────┘
```

---

## 3. Evidence Promotion Workflow

1. **Claim Decomposition:**
   - In `/verify`, an explanation is decomposed into atomic claims (e.g., `"The cache eviction algorithm was changed to LFU in src/cache.ts to prevent memory thrashing under high concurrency"`).
   - Traceback searches commits, PRs, issues, and docs to validate the claim.
2. **One-Click Promotion Dialog:**
   - The user clicks **Promote to Decision** on any reviewable claim card.
   - An interactive modal opens with prepopulated draft fields:
     - `title`: Extracted symbol constraint (e.g., `Architectural Constraint for evictCache`) or claim summary.
     - `summary`: Explanation of the original problem and context.
     - `decision`: Statement preserving the architectural constraint.
     - `rationale`: Grounded rationale citing verified historical evidence.
     - `targetFilePath` & `targetSymbol`: Exact repository code coordinates.
     - `severity`: Defaults to `HIGH`.
     - Attached provenance: Preserves commit SHAs, PR numbers, authors, and GitHub URLs.
3. **Candidate vs. Immediate Acceptance:**
   - **Candidate Mode (Default):** Creates decision with `status: "CANDIDATE"`. Requires team review before enforcement.
   - **Immediate Acceptance Mode:** Requires non-empty review notes. If user holds `OWNER`, `ADMIN`, or `MEMBER` privileges, sets `status: "ACCEPTED"`, attributes reviewer (`reviewerName`, `reviewerId`), and records `reviewedAt` timestamp.

---

## 4. Human Approval Process & Governance

Per Traceback Core Operating Principles (`AGENTS.md`), **AI suggestions must strictly remain distinguishable from human verdicts**:

- An AI assessment (even with high preliminary confidence) does not automatically accept a decision.
- Only authenticated users with workspace memberships (`OWNER`, `ADMIN`, `MEMBER`) can accept or reject candidate decisions.
- Users with the `VIEWER` role are strictly blocked from decision state modifications (`HTTP 403 Forbidden`).
- When a decision is accepted, `reviewNotes` are mandatory to provide an audit trail explaining _why_ the human approved the constraint.
- Reviewer attribution (`reviewerName`, `reviewerId`, `reviewedAt`) is permanently stamped onto the decision record and serialized into the ADR Markdown file.

---

## 5. Bidirectional ADR Sync Architecture

### Markdown Specification

ADR files conform to standard Markdown structure with front-matter bullets:

```markdown
# ADR-001: Enforce LFU Cache Eviction

- **Identifier:** ADR-001
- **Title:** Enforce LFU Cache Eviction
- **Status:** Accepted
- **Date:** 2026-11-22
- **Severity:** HIGH
- **Target File:** `src/cache.ts`
- **Target Symbol:** `evictCache`
- **Reviewer:** Lead Maintainer
- **Reviewed At:** 2026-11-22T01:13:00.000Z
- **Derived From Claim ID:** `9a8406cf-2276-4936-81f3-e8764801a0fc`

## Context

Prepopulated context from verified historical rationale.

## Decision & Consequences

Maintain LFU cache eviction algorithm in src/cache.ts to avoid thrashing.

## Rationale

Verified historical evidence confirms LRU caused severe memory thrashing under high concurrency.

## Supporting Evidence & Provenance

- **[COMMIT]** [`7a8b9c`](https://github.com/org/repo/commit/7a8b9c) — _fix(cache): switch to LFU_ by Lead (2026-10-10)
  - File: `src/cache.ts#L10-L45`

## Review Notes & Audit Trail

> Explicit human sign-off confirming LFU constraint is an invariant.
```

### Conflict Resolution & Overwrite Protection

Bidirectional synchronization implements timestamp-based two-way conflict protection:

1. **Import Conflict Check:**
   When scanning ADR files from disk, if an existing database decision matches by `{ title }` or `{ createdFromClaimId }`:
   - If `new Date(existing.updatedAt).getTime() > fileStat.mtimeMs + 1000`, the database has newer human updates. The file does **not** overwrite the database record.
   - If the file is newer, the database record is updated in place with the file's contents.
2. **Export Conflict Check:**
   When exporting decisions to disk:
   - If `fileStat.mtimeMs > new Date(decision.updatedAt).getTime() + 1000`, the file has newer manual developer edits. The database decision does **not** overwrite the newer disk file.
   - If the database decision is newer, the file is overwritten with latest database state.
3. **Duplicate Prevention:**
   Repeated imports match existing decisions and update them idempotently, maintaining a 1:1 mapping.

---

## 6. REST API Endpoints

All endpoints are scoped under:  
`/api/workspaces/:workspaceId/repositories/:repositoryId/decisions`  
Guarded by `AuthGuard` (JWT Bearer) and `WorkspaceGuard` (multi-tenant boundary).

| Method | Endpoint              | Description                                                  | Role Required          |
| ------ | --------------------- | ------------------------------------------------------------ | ---------------------- |
| `GET`  | `/`                   | List all decisions with optional `?status=` filter           | Member / Viewer        |
| `GET`  | `/:id`                | Get single decision details                                  | Member / Viewer        |
| `POST` | `/`                   | Create manual decision draft                                 | Member / Admin / Owner |
| `POST` | `/propose-from-claim` | Promote verified claim into candidate/accepted decision      | Member / Admin / Owner |
| `GET`  | `/:id/adr`            | Generate ADR Markdown preview for a decision                 | Member / Viewer        |
| `POST` | `/:id/export-adr`     | Export individual decision to `/docs/adr/*.md`               | Member / Admin / Owner |
| `POST` | `/:id/accept`         | Accept candidate decision with mandatory review notes        | Member / Admin / Owner |
| `POST` | `/:id/reject`         | Reject candidate decision and archive                        | Member / Admin / Owner |
| `POST` | `/:id/dispute`        | Dispute existing decision                                    | Member / Admin / Owner |
| `POST` | `/:id/supersede`      | Supersede old decision with new decision                     | Member / Admin / Owner |
| `POST` | `/sync-adrs`          | Run bidirectional sync (`BIDIRECTIONAL`, `IMPORT`, `EXPORT`) | Member / Admin / Owner |
| `POST` | `/import-adrs`        | Ingest Markdown files from disk into PostgreSQL              | Member / Admin / Owner |
| `POST` | `/export-all-adrs`    | Export all decisions to Markdown files on disk               | Member / Admin / Owner |

---

## 7. Local Testing & Verification Instructions

### 1. Automated Integration Test Script

To run the automated 11-step end-to-end integration test against the live running API:

```bash
node <appDataDir>/brain/49908301-fc85-4a58-8f18-b377d02c757c/scratch/e2e-feature4-verify.js
```

### 2. Unit & Integration Test Suites

```bash
# Backend unit tests (Decisions, ADR parser, Verification)
npm run test --prefix apps/api

# Frontend component & modal tests
npm run test --prefix apps/web

# Monorepo typechecking
npm run typecheck

# Full production build
npm run build
```

### 3. Manual Interactive UI Walkthrough

1. Start dev servers: `npm run dev`
2. Navigate to `http://localhost:3000/verify`.
3. Submit an explanation:
   - Explanation: `"The cache eviction algorithm was changed to LFU in src/cache.ts to prevent memory thrashing under high concurrency."`
   - Target File: `src/cache.ts`
   - Target Symbol: `evictCache`
4. On the verified claim card, click **Promote to Decision**.
5. In the promotion dialog, confirm prepopulated fields. Select **Save as Candidate** or **Accept Immediately**. Click submit.
6. Navigate to `http://localhost:3000/decisions`.
7. Click **📄 View ADR** on the newly created decision card:
   - Verify formatted Markdown preview.
   - Click **📋 Copy Markdown** to copy to clipboard.
   - Click **💾 Save to docs/adr/...** to write file to disk.
8. Click **🔄 Sync /docs/adr/** in the header:
   - Select **Bidirectional Sync**.
   - Click **Run ADR Sync**. Verify that files are scanned and synchronized with zero errors.
