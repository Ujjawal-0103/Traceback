#!/usr/bin/env node

import { runCli } from "../index";

runCli(process.argv.slice(2)).catch((err) => {
  console.error("[traceback-cli] Execution notice:", err?.message || err);
  process.exitCode = 0; // Strictly non-blocking invariant
});
