import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const functionsRoot = join(root, "supabase/functions");
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const configured = new Set(
  [...config.matchAll(/^\[functions\.([^\]]+)\]$/gm)].map((match) => match[1]),
);
const directories = new Set(
  readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
    .map((entry) => entry.name),
);

const missing = [...directories].filter((name) => !configured.has(name)).sort();
const stale = [...configured].filter((name) => !directories.has(name)).sort();
if (missing.length || stale.length) {
  throw new Error(
    `Supabase function/config drift. Missing: ${missing.join(", ") || "none"}; stale: ${
      stale.join(", ") || "none"
    }`,
  );
}

const registryRows = readFileSync(
  join(root, "migration/function-registry.csv"),
  "utf8",
)
  .trim()
  .split(/\r?\n/)
  .slice(1);
const registered = new Set(registryRows.map((row) => row.split(",", 1)[0]));
const missingRegistry = [...directories].filter((name) => !registered.has(name)).sort();
const staleRegistry = [...registered].filter((name) => !directories.has(name)).sort();
if (
  registered.size !== registryRows.length ||
  missingRegistry.length ||
  staleRegistry.length
) {
  throw new Error(
    `Function registry drift. Missing: ${missingRegistry.join(", ") || "none"}; stale: ${
      staleRegistry.join(", ") || "none"
    }; duplicate rows: ${registryRows.length - registered.size}`,
  );
}

const currentFiles = [
  join(root, "supabase/config.toml"),
  join(root, "supabase/functions/_shared/auth.ts"),
  join(root, "supabase/functions/_shared/cors.ts"),
];
const forbiddenCurrentPatterns = [
  ["legacy project reference", /dutkpzrisvqgxadxbkxo/],
  ["wildcard fallback CORS", /allowedOrigin\s*\?\?\s*["']\*["']/],
];
for (const file of currentFiles) {
  const source = readFileSync(file, "utf8");
  for (const [label, pattern] of forbiddenCurrentPatterns) {
    if (pattern.test(source)) {
      throw new Error(`${label} found in ${file}`);
    }
  }
}

function sourceFiles(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

const credentialPatterns = [
  ["JWT-like literal", /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ["Stripe secret literal", /sk_(?:live|test)_[A-Za-z0-9]{16,}/],
  ["Stripe webhook secret literal", /whsec_[A-Za-z0-9]{16,}/],
  ["legacy cron credential literal", /crk_[A-Za-z0-9]{16,}/],
];
const credentialScanFiles = [
  ...sourceFiles(join(root, "src")),
  ...sourceFiles(join(root, "supabase/functions")),
  ...sourceFiles(join(root, "supabase/migrations")),
  join(root, ".env.example"),
].filter((file) => /\.(?:ts|tsx|js|mjs|sql|toml|example)$/.test(file));

for (const file of credentialScanFiles) {
  const source = readFileSync(file, "utf8");
  for (const [label, pattern] of credentialPatterns) {
    if (pattern.test(source)) throw new Error(`${label} found in ${file}`);
  }
}

const guard = readFileSync(
  join(root, "migration/DO_NOT_REPLAY_LEGACY.sql"),
  "utf8",
);
if (!guard.includes("TICKET_AI_LEGACY_REPLAY_BLOCKED")) {
  throw new Error("The legacy migration replay guard is missing or disabled");
}

const autoMigrationNames = new Set(readdirSync(join(root, "supabase/migrations")));
for (const forbiddenName of [
  "00000000000000_DO_NOT_REPLAY_LEGACY.sql",
  "20260728000100_rotate_exposed_cron_key.sql",
]) {
  if (autoMigrationNames.has(forbiddenName)) {
    throw new Error(`${forbiddenName} must remain outside the auto-apply directory`);
  }
}

console.log(
  `Verified ${directories.size} Edge Function directories, explicit config/registry coverage, and non-auto-applied legacy replay guard.`,
);
