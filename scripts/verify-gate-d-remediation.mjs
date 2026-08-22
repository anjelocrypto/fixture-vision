import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260822174500_gate_d_remediation.sql");

const requiredMigrationEvidence = [
  "JOIN public.ticket_outcomes",
  "fr.status = 'FT'",
  "tlo.line IS NOT NULL",
  "ORDER BY tlo.kickoff_at ASC, tlo.id ASC",
  "get_ticket_pipeline_health_metrics",
  "'x-cron-key', public.get_cron_internal_key()",
  "cron.alter_job(64, command := v_command, active := false)",
];
for (const evidence of requiredMigrationEvidence) {
  if (!migration.includes(evidence)) throw new Error(`Gate D migration missing: ${evidence}`);
}
if (/['"]Authorization['"]\s*,/i.test(migration)) {
  throw new Error("Gate D job 64 rewrite must not emit an Authorization credential");
}

const boundedProviderFunctions = [
  "supabase/functions/cron-fetch-fixtures/index.ts",
  "supabase/functions/stats-refresh/index.ts",
  "supabase/functions/sync-injuries/index.ts",
  "supabase/functions/sync-player-importance/index.ts",
  "supabase/functions/team-totals-refresh/index.ts",
];
for (const path of boundedProviderFunctions) {
  const source = read(path);
  if (!source.includes("MAX_PROVIDER_CALLS_PER_RUN")) {
    throw new Error(`${path} has no hard provider-call limit`);
  }
  if (!source.includes("ProviderCallBudget")) {
    throw new Error(`${path} does not use ProviderCallBudget`);
  }
}

const playerSync = read("supabase/functions/sync-player-importance/index.ts");
if (playerSync.includes("Object.fromEntries(req.headers.entries())")) {
  throw new Error("sync-player-importance still logs raw request headers");
}

console.log("Gate D remediation static invariants verified.");
