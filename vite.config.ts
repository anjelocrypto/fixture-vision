import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";

function currentReleaseSha(): string {
  if (process.env.GITHUB_SHA?.trim()) return process.env.GITHUB_SHA.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const requiredEnvironment = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PROJECT_ID",
  ];
  const missingEnvironment = requiredEnvironment.filter((name) => !env[name]?.trim());

  if (missingEnvironment.length > 0) {
    throw new Error(
      `Missing required frontend environment variables: ${missingEnvironment.join(", ")}. ` +
      "Copy .env.example to an untracked .env and provide this environment's Supabase values.",
    );
  }

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [react()],
    define: {
      __TICKET_AI_RELEASE_SHA__: JSON.stringify(env.VITE_RELEASE_SHA?.trim() || currentReleaseSha()),
      __TICKET_AI_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    resolve: {
      alias: { "@": new URL("./src", import.meta.url).pathname },
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
  };
});
