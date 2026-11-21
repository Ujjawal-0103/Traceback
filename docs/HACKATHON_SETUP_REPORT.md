# Traceback — Complete Hackathon Environment Setup & Verification Report

**Date & Time:** November 20, 2026  
**Operating System:** Windows 11  
**Repository Path:** `C:\Users\Asus\Videos\VScodefiles\Pro\Traceback`  
**Git Branch:** `main` (Clean working tree, up to date with `origin/main`)  
**Setup Status:** **READY**  

---

## 1. Project Architecture Discovered

Traceback is a human-supervised verification system for AI-generated code explanations (Problem Statement: **T1.1 — Why The Code Is Like This**). It is architected as a high-performance **Turborepo monorepo** with npm workspaces:

```text
Traceback/
├── apps/
│   ├── web/                    # Next.js 14 App Router frontend (React 18, Tailwind CSS, TypeScript)
│   └── api/                    # NestJS backend service (REST API, Prisma ORM, BullMQ, Guards)
├── packages/
│   ├── shared-types/           # Shared domain models (claims, verdicts, envelopes, TypeScript project reference)
│   └── mcp-server/             # Model Context Protocol server (@modelcontextprotocol/sdk, Zod schema validation)
├── tools/
│   └── benchmark/              # Claim verification benchmarking suite
├── docs/                       # Project specifications, ADRs, UX specifications, threat models
├── docker-compose.yml          # Container configuration for PostgreSQL 16, Redis 7, Neo4j 5
├── package.json                # Root scripts and workspace definitions
├── turbo.json                  # Turborepo task pipeline configuration
└── .env.example                # Canonical environment variable specification
```

---

## 2. Environment & Software Versions

| Component | Detected Version | Minimum Required | Status |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v24.20.0` | `>= 20.0.0` | **MATCH / SATISFIED** |
| **npm** | `11.19.0` | `>= 10.0.0` | **MATCH / SATISFIED** |
| **Turborepo** | `v2.11.7` | `^2.4.4` | **MATCH / SATISFIED** |
| **TypeScript** | `v5.7.3` | `^5.7.3` | **MATCH / SATISFIED** |
| **Prisma CLI / Client** | `v6.19.3` / `v6.4.1` | `^6.4.1` | **MATCH / SATISFIED** |
| **Docker Desktop** | `v29.8.2` | Any Docker Desktop | **MATCH / RUNNING** |
| **Docker Compose** | `v5.5.1` | Compose v2+ | **MATCH / SATISFIED** |
| **PostgreSQL** | `16-alpine` | `16` | **HEALTHY (`localhost:5434`)** |
| **Redis** | `7-alpine` | `7` | **HEALTHY (`localhost:6379`)** |

---

## 3. Dependencies Installed & Verified

- **Monorepo Packages:** All root and workspace npm dependencies are installed and locked via `package-lock.json`.
- **Shared Contracts:** `@traceback/shared-types` was built using `tsc -b`, emitting declarations (`dist/index.d.ts`) and CommonJS binaries (`dist/index.js`) required by all dependent workspaces.
- **MCP Server:** `@traceback/mcp-server` built and linked with executable binary `./dist/bin/cli.js`.
- **Prisma Client:** Prisma Client code and Windows query engine binary (`query_engine.dll.node`) were generated into `node_modules/@prisma/client`.

---

## 4. Environment Configuration Status

The following environment configuration files were generated from canonical templates without overwriting any pre-existing files or inventing credentials:

1. **Root `.env`** (Created from `.env.example`):
   - `PORT=3001`
   - `API_URL=http://127.0.0.1:3001`
   - `NEXT_PUBLIC_API_URL=http://127.0.0.1:3001/api`
   - `WEB_URL=http://localhost:3000`
   - `DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5434/traceback_dev?schema=public"`
   - `REDIS_HOST=localhost`
   - `REDIS_PORT=6379`
   - `DEFAULT_THEME=light`
2. **Backend API `apps/api/.env`** (Created from `apps/api/.env.example`):
   - Configures backend database connection string and server ports.
3. **Frontend Web `apps/web/.env.local`** (Created from `apps/web/.env.example`):
   - Configures `NEXT_PUBLIC_API_URL=http://127.0.0.1:3001/api`.

**Git Secret Protection Verification:**
- Verified `.gitignore` contains rules for `.env`, `.env.local`, `*.pem`, `*.key`.
- Ran `git status`: Working tree is clean and none of the created environment files or secrets are tracked or exposed.

---

## 5. Database & Prisma Status

- **Container Status:** `traceback-postgres` container is running and healthy on host port `5434` (mapped to container port `5432`).
- **Prisma Schema Validation:** Validated via `npm run prisma:validate`. Schema at `apps/api/prisma/schema.prisma` is valid.
- **Migration History:** 6 migrations discovered in `apps/api/prisma/migrations`:
  1. `20261009184048_init`
  2. `20261011033600_sprint_3_ingestion`
  3. `20261013123136_sprint_4_evidence_store`
  4. `20261015141036_sprint_6_auth_and_history`
  5. `20261025102134_sprint_9_password_reset` (Applied during setup)
  6. `20261025110205_sprint_10_decision_memory_and_intent` (Applied during setup)
- **Migration Application:** Executed non-destructive `npm run prisma:migrate:deploy`. All migrations applied safely with zero schema destruction or table dropping.
- **Migration Status Check:** `npm run prisma:migrate:status` confirms **"Database schema is up to date!"**
- **Database Connectivity & Health Check:** `PrismaService` live integration test passed:
  - Database connectivity verified.
  - Read query verified against public schema.
  - Health checks verified with zero credential leakage.

---

## 6. Frontend Startup URL

- **URL:** [http://localhost:3000](http://localhost:3000)
- **Status:** **RUNNING** (Compiled successfully, returns HTTP 200 OK)
- **Health Check Endpoint:** `http://localhost:3000/api/health` (Returns HTTP 200 `{"status":"ok","service":"@traceback/web"}`)
- **Default Theming:** Light mode active by default (`data-theme="light"`).

---

## 7. Backend Startup URL

- **URL:** [http://localhost:3001/api](http://localhost:3001/api) / [http://127.0.0.1:3001/api](http://127.0.0.1:3001/api)
- **Status:** **RUNNING** (NestJS application successfully started, returns HTTP 200 OK)
- **Liveness Probe:** `http://127.0.0.1:3001/api/health`
  - Output: `{"status":"ok","service":"@traceback/api","version":"0.1.0","uptimeSeconds":74}`
- **Readiness Probe:** `http://127.0.0.1:3001/api/ready`
  - Output: `{"status":"ready","service":"@traceback/api","checks":{"config":{"ready":true,"message":"Configuration validated successfully"},"database":{"ready":true,"message":"PostgreSQL database responsive"}}}`

---

## 8. Test Results Matrix

| Workspace / Target | Check Type | Command Executed | Result | Details |
| :--- | :--- | :--- | :--- | :--- |
| **All Workspaces** | TypeScript Typecheck | `turbo run typecheck` | **PASS** | 5/5 tasks successful across all 4 packages |
| **All Workspaces** | ESLint Code Quality | `turbo run lint` | **PASS** | 0 errors, 0 warnings |
| **All Workspaces** | Production Build | `turbo run build` | **PASS** | 5/5 tasks successful; 15/15 static pages optimized |
| **`@traceback/api`** | Unit Test Suites | `npm run test:unit --workspace=@traceback/api` | **PASS** | All unit suites passed |
| **`@traceback/api`** | DB Integration Tests | `npm run test:integration --workspace=@traceback/api` | **PASS** | 5/5 live database tests passed |
| **`@traceback/api`** | Full API Test Suite | `npm test --workspace=@traceback/api` | **PASS** | 44/44 test suites passed (416/416 tests passed) |
| **`@traceback/web`** | Frontend Test Suite | `npm test --workspace=@traceback/web` | **PASS** | 13/13 test suites passed (65/65 tests passed) |
| **`@traceback/mcp-server`** | Protocol & Adversarial Tests | `npm test --workspace=@traceback/mcp-server` | **PASS** | 1/1 test suite passed (24/24 tests passed) |
| **Monorepo Total** | All Tests | `turbo run test` | **PASS** | **58/58 test suites passed (505/505 tests passed, 0 failures)** |

---

## 9. Errors Encountered & Safe Fixes Applied

1. **Error: Missing `DATABASE_URL` during Prisma schema validation**
   - *Cause:* Local `.env` files had not yet been created from `.env.example`.
   - *Fix:* Created root `.env`, `apps/api/.env`, and `apps/web/.env.local` based on canonical development templates without fabricating credentials.
2. **Error: Prisma engine download blocked (`binaries.prisma.sh getaddrinfo ENOTFOUND`)**
   - *Cause:* npm install-scripts for Prisma require query engine binary download for Windows.
   - *Fix:* Executed `npm run prisma:generate` with network approval to download and place `query_engine.dll.node` into `node_modules/@prisma/client`.
3. **Error: TypeScript typecheck failure (`Cannot find module '@traceback/shared-types'`)**
   - *Cause:* Workspaces `@traceback/web`, `@traceback/api`, and `@traceback/mcp-server` import domain contracts from `@traceback/shared-types/dist`, which had not yet been compiled.
   - *Fix:* Ran `npm run build --workspace=@traceback/shared-types` (`tsc -b`). Subsequent typechecks passed with 0 errors across all workspaces.
4. **Error: Docker daemon unavailable (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`)**
   - *Cause:* Docker Desktop was installed but not running in memory.
   - *Fix:* Started `Docker Desktop.exe`. Verified `traceback-postgres` and `traceback-redis` containers reached `Up (healthy)` state.
5. **Error: Unapplied migrations (`sprint_9_password_reset`, `sprint_10_decision_memory_and_intent`)**
   - *Cause:* Migrations were committed in the repository but pending deployment on the development database.
   - *Fix:* Executed non-destructive `npm run prisma:migrate:deploy`. Both migrations were applied cleanly. Database schema is now fully synchronized.

---

## 10. Remaining Manual Actions

The project is **100% operational in development and sandbox mode** out-of-the-box. The following actions are strictly optional and only needed if connecting live third-party services:

1. **LLM Provider API Keys (Optional):**
   - If you want live LLM claim extraction instead of the built-in deterministic baseline, add one of the following to `.env`:
     - `GEMINI_API_KEY=your_key_here`
     - `OPENAI_API_KEY=your_key_here`
     - `ANTHROPIC_API_KEY=your_key_here`
2. **Live GitHub App Credentials (Optional):**
   - When no credentials are provided, the system operates seamlessly in sandbox mode using `MockGitHubClient`.
   - To connect live private/public repositories:
     - Register a GitHub App with read-only permissions for Contents, Issues, and Pull Requests.
     - Save the private key to `secrets/github-app-private-key.pem`.
     - Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_WEBHOOK_SECRET` in `.env`.

---

## 11. Exact Commands to Start the Project During the Hackathon

### Step 1: Ensure Docker Desktop & Database Containers are Running
```powershell
# Open Docker Desktop if it is not open, then start the containers:
docker compose up -d postgres redis
```

### Step 2: Start Full Stack Concurrently (Frontend + Backend)
From the project root (`C:\Users\Asus\Videos\VScodefiles\Pro\Traceback`):
```powershell
npm run dev
```
- **Web UI:** [http://localhost:3000](http://localhost:3000)
- **API Server:** [http://localhost:3001/api](http://localhost:3001/api)

### Alternative: Start Individual Services in Separate Terminals
```powershell
# Terminal 1 — Backend API
npm run dev --workspace=@traceback/api

# Terminal 2 — Frontend Next.js Web
npm run dev --workspace=@traceback/web

# Terminal 3 — MCP Server (for Cursor / Claude Code integration)
npm run start --workspace=@traceback/mcp-server
```

### Verification & Testing Commands
```powershell
# Run all tests across the entire repository
npm test

# Check Prisma schema and database migration status
npm run prisma:validate
npm run prisma:migrate:status

# Verify types and linting
npm run typecheck
npm run lint

# Run production build
npm run build
```

---

## 12. Git Branch & Working Tree Status

- **Branch:** `main`
- **Remote Status:** Up to date with `origin/main`
- **Working Tree:** Clean (no untracked source files; `.env`, `.env.local`, and build artifacts are properly protected by `.gitignore`)
- **Preservation:** All original commits, branches, and application files remain untouched and preserved.

