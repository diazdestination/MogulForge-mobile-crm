#!/usr/bin/env node
/**
 * Production bundle smoke check for the Expo mobile app.
 *
 * Runs a real production export (`expo export`) for iOS and Android — the
 * same bundling step a release/publish would perform — and fails loudly
 * (non-zero exit) on any bundling error. Also verifies the export actually
 * produced a JS bundle per platform, so a silently-empty export still fails.
 *
 * A bundle can also build cleanly and still crash the moment the app
 * launches (e.g. a module that throws at import time), so this check then
 * runs the boot test (__tests__/boot.test.tsx), which evaluates every route
 * module and renders the app root via react-native-web/jsdom, failing if
 * module evaluation or first render throws.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-crm-smoke-"));

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: artifactDir,
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`)),
    );
    child.on("error", reject);
  });
}

function findBundles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findBundles(full));
    else if (/\.(js|hbc)$/.test(entry.name)) results.push(full);
  }
  return results;
}

async function main() {
  console.log(`[smoke] exporting mobile-crm production bundles (ios + android) to ${outputDir} ...`);
  await run(
    "pnpm",
    [
      "exec",
      "expo",
      "export",
      "--platform",
      "ios",
      "--platform",
      "android",
      "--output-dir",
      outputDir,
      "--clear",
    ],
    { NODE_ENV: "production", CI: "1" },
  );

  for (const platform of ["ios", "android"]) {
    const platformDir = path.join(outputDir, "_expo", "static", "js", platform);
    const bundles = findBundles(platformDir);
    if (bundles.length === 0) {
      throw new Error(
        `Export completed but no ${platform} JS bundle found under ${platformDir} — export output looks broken.`,
      );
    }
    const empty = bundles.filter((b) => fs.statSync(b).size === 0);
    if (empty.length > 0) {
      throw new Error(`Exported ${platform} bundle is empty: ${empty.join(", ")}`);
    }
    console.log(`[smoke] ${platform} bundle OK (${bundles.length} file(s))`);
  }

  console.log("[smoke] running startup boot check (route evaluation + first render) ...");
  await run("pnpm", ["exec", "vitest", "run", "__tests__/boot.test.tsx"], { CI: "1" });

  console.log(
    "[smoke] PASSED: mobile-crm exports production iOS and Android bundles without errors, and the app boots without crashing.",
  );
}

main()
  .catch((err) => {
    console.error(`[smoke] FAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
