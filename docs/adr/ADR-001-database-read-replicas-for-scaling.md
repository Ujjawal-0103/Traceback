# ADR-001: Database Read Replicas For Scaling

- **Identifier:** ADR-001
- **Title:** Database Read Replicas For Scaling
- **Status:** Accepted
- **Date:** 2026-11-21
- **Severity:** HIGH
- **Target File:** `src/database/replica-pool.ts`
- **Target Symbol:** `ReplicaPool`
- **Reviewer:** Infrastructure Architect
- **Reviewed At:** 2026-11-21T19:41:42.875Z
- **Derived From Claim ID:** `claim_replica_scale_99`

## Context

Read traffic exceeds primary database capacity during peak usage.

## Decision & Consequences

Route all read queries to dedicated replica pool instances.

## Rationale

Prevents connection starvation on the primary write node.

## Supporting Evidence & Provenance

- **[COMMIT]** [`a1b2c3d4`](https://github.com/org/repo/commit/a1b2c3d4) — *feat: add replica pool* by **Maintainer** (2026-11-21)

## Review Notes & Audit Trail

> Approved in infrastructure review meeting.
