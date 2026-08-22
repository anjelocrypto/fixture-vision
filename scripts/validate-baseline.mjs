import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: node scripts/validate-baseline.mjs <baseline_schema.sql>");
}

const source = readFileSync(file, "utf8");
const findings = [];
const checks = [
  ["legacy TICKET AI project reference", /dutkpzrisvqgxadxbkxo/gi],
  ["Octopus project reference", /yjtsitqoghbimnnbtdjt/gi],
  ["Supabase project URL", /https:\/\/[a-z]{20}\.supabase\.co/gi],
  ["JWT-like literal", /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ["Stripe secret-like literal", /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["Stripe webhook secret-like literal", /\bwhsec_[A-Za-z0-9]{16,}\b/g],
  ["generic API key literal", /\b(?:api[_-]?key|secret)\s*[:=]\s*['"][^'"]{16,}['"]/gi],
  ["cron scheduling in schema baseline", /\bcron\.(?:schedule|unschedule)\s*\(/gi],
];

for (const [label, pattern] of checks) {
  const matches = source.match(pattern);
  if (matches?.length) findings.push(`${label}: ${matches.length}`);
}

for (const match of source.matchAll(
  /CREATE(?: OR REPLACE)? FUNCTION[\s\S]*?\$\$[\s\S]*?\$\$;/gi,
)) {
  if (/SECURITY DEFINER/i.test(match[0]) && !/SET\s+search_path\s*=/i.test(match[0])) {
    findings.push("SECURITY DEFINER function without explicit search_path");
  }
}

if (findings.length) {
  console.error("Candidate baseline rejected:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Candidate baseline passed automated literal and function checks.");
console.log("Manual SQL, RLS, grant, extension, trigger, and seed review is still required.");
