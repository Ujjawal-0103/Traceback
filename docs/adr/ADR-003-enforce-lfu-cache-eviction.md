# ADR-003: Enforce LFU Cache Eviction

- **Identifier:** ADR-003
- **Title:** Enforce LFU Cache Eviction
- **Status:** Accepted
- **Date:** 2026-11-21
- **Severity:** HIGH
- **Target File:** `src/cache.ts`
- **Target Symbol:** `evictCache`
- **Reviewer:** Alex Maintainer
- **Reviewed At:** 2026-11-21T20:11:02.506Z
- **Derived From Claim ID:** `f930ddc2-f133-40ca-bec2-9eed13f7adbe`

## Context

Cache thrashing occurred under high concurrency when using LRU.

## Decision & Consequences

Maintain LFU cache eviction algorithm in src/cache.ts.

## Rationale

Historical load testing verified LFU prevents frequent thrashing.

## Supporting Evidence & Provenance

No explicit evidence attachments recorded.

## Review Notes & Audit Trail

> Reviewed and approved by Alex Maintainer during architecture review.
