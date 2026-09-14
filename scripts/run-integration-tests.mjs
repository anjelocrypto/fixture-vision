#!/usr/bin/env node
/**
 * Runs the Vitest suite against a protected staging backend and fails when any
 * test is skipped. Unexpected skips previously let "138 passed, 0 skipped" be
 * reported while 35 live cases never executed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const reportPath = "/tmp/ticket-ai-integration-report.json";
rmSync(reportPath, { force: true });

const run = spawnSync(
  "npx",
  ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile=${reportPath}`],
  { stdio: "inherit" },
);

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch {
  console.error("Integration run produced no machine-readable report.");
  process.exit(run.status === 0 ? 1 : run.status ?? 1);
}

const tests = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
const skipped = tests.filter((t) => t.status === "pending" || t.status === "skipped" || t.status === "todo");
const failed = tests.filter((t) => t.status === "failed");

console.log(`Integration results: ${tests.length} total, ${failed.length} failed, ${skipped.length} skipped.`);

if (skipped.length > 0) {
  console.error("Unexpected skips — integration coverage is not proven:");
  for (const t of skipped) console.error(`  - ${t.fullName ?? t.title}`);
  process.exit(1);
}

process.exit(failed.length > 0 || run.status !== 0 ? 1 : 0);
