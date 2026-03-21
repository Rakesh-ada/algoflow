import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { verify } from "hono/jwt";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { PinataSDK } from "pinata-web3";
import {
  upsertProject,
  addDeployment,
  incrementActiveDeploys,
  decrementActiveDeploys,
  canStartDeploy,
  getActiveDeployCount,
  getMaxConcurrent,
  isValidWalletAddress,
} from "./db.js";

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || "mock-jwt",
  pinataGateway: process.env.PINATA_GATEWAY || "gateway.pinata.cloud",
});

const JWT_SECRET = process.env.JWT_SECRET || "w3deploy-super-secret-key-change-me";
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
const TEMP_ROOT = path.join(os.tmpdir(), "w3deploy");
const STATIC_OUTPUT_CANDIDATES = ["dist", "out", "build"] as const;
const REACT_BUILD_OUTPUT_CANDIDATES = ["dist", "build", "out"] as const;
const BACKEND_DEPENDENCY_HINTS = [
  "express",
  "koa",
  "fastify",
  "@nestjs/core",
  "@nestjs/common",
  "hono",
  "socket.io",
  "prisma",
  "@prisma/client",
  "typeorm",
  "mongoose",
] as const;
const FRONTEND_DEPENDENCY_HINTS = [
  "react",
  "react-dom",
  "next",
  "vue",
  "svelte",
  "@vitejs/plugin-react",
  "@vitejs/plugin-react-swc",
  "@vitejs/plugin-vue",
  "vite",
] as const;

type DeployRequestBody = {
  repoUrl?: unknown;
  label?: unknown;
  meta?: unknown;
};

type DeployMeta = {
  notes?: string;
  projectName?: string;
  appPreset?: string;
  rootDirectory?: string;
  buildCommand?: string;
  installCommand?: string;
  outputDirectory?: string;
  envVars?: { key: string; value: string }[];
  env?: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type FileWithWebkitPath = File & { webkitRelativePath?: string };
type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
type ProjectKind = "react" | "html";
type DeployEnvVar = { key: string; value: string };

type ProjectPreparation = {
  projectKind: ProjectKind;
  outputDir: string;
  installCommand?: string;
  buildCommand?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: true });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const stderrTail = stderr.trim().slice(-500);
      const summary = `${command} ${args.join(" ")}`.trim();
      const details = stderrTail ? `: ${stderrTail}` : "";
      reject(new Error(`Command failed (${summary}) with exit code ${code}${details}`));
    });
  });
}

function runCommandStreaming(
  command: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: true });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      const lines = text.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        onLine(line.trim());
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      const lines = text.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        onLine(line.trim());
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const stderrTail = stderr.trim().slice(-500);
      const summary = `${command} ${args.join(" ")}`.trim();
      const details = stderrTail ? `: ${stderrTail}` : "";
      reject(new Error(`Command failed (${summary}) with exit code ${code}${details}`));
    });
  });
}

function runShellCommandStreaming(command: string, cwd: string, onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (!onLine) return;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (!onLine) return;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const tail = stderr.trim().slice(-500);
      reject(new Error(`Command failed (${command}) with exit code ${code}${tail ? `: ${tail}` : ""}`));
    });
  });
}

function hasAnyDependency(
  packageJson: Record<string, unknown>,
  names: string[]
): boolean {
  const dependencies = (packageJson.dependencies || {}) as Record<string, unknown>;
  const devDependencies = (packageJson.devDependencies || {}) as Record<string, unknown>;
  return names.some((name) => Boolean(dependencies[name] || devDependencies[name]));
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await fs.stat(pathname);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(projectDir: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function resolveProjectDirectory(baseDir: string, meta: DeployMeta): Promise<string> {
  const rootDir = (meta.rootDirectory || "").trim().replace(/^\.?\/?/, "").replace(/\/+$/, "");
  if (rootDir && rootDir !== ".") {
    return path.join(baseDir, rootDir);
  }

  const rootHasPackage = await pathExists(path.join(baseDir, "package.json"));
  if (rootHasPackage) {
    return baseDir;
  }

  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const candidates: Array<{ dir: string; name: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const candidateDir = path.join(baseDir, entry.name);
    if (await pathExists(path.join(candidateDir, "package.json"))) {
      candidates.push({ dir: candidateDir, name: entry.name });
    }
  }

  if (candidates.length === 1) {
    return candidates[0].dir;
  }

  if (candidates.length > 1) {
    const scoredCandidates: Array<{ dir: string; score: number }> = [];
    for (const candidate of candidates) {
      const packageJson = await readPackageJson(candidate.dir);
      const hasFrontendDependencies = packageJson
        ? hasAnyDependency(packageJson, [...FRONTEND_DEPENDENCY_HINTS])
        : false;
      const hasBackendDependencies = packageJson
        ? hasAnyDependency(packageJson, [...BACKEND_DEPENDENCY_HINTS])
        : false;
      const hasReactMarkers = await hasAnyReactFileMarkers(candidate.dir);
      const hasCandidateBuildScript = hasBuildScript(packageJson);
      const hasFrontendNameHint = /(front|client|web|site|app)/i.test(candidate.name);

      let score = 0;
      if (hasFrontendDependencies) score += 4;
      if (hasReactMarkers) score += 3;
      if (hasCandidateBuildScript) score += 1;
      if (hasFrontendNameHint) score += 2;
      if (hasBackendDependencies && !hasFrontendDependencies) score -= 4;

      scoredCandidates.push({ dir: candidate.dir, score });
    }

    const bestScore = Math.max(...scoredCandidates.map((item) => item.score));
    if (bestScore > 0) {
      const bestMatches = scoredCandidates.filter((item) => item.score === bestScore);
      if (bestMatches.length === 1) {
        return bestMatches[0].dir;
      }
    }
  }

  return baseDir;
}

async function hasAnyReactFileMarkers(projectDir: string): Promise<boolean> {
  const markers = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "src/main.tsx",
    "src/main.jsx",
    "src/App.tsx",
    "src/App.jsx",
    "app/layout.tsx",
    "app/page.tsx",
  ];

  for (const marker of markers) {
    if (await pathExists(path.join(projectDir, marker))) {
      return true;
    }
  }

  return false;
}

async function detectProjectKind(
  projectDir: string,
  packageJson: Record<string, unknown> | null,
  meta: DeployMeta
): Promise<ProjectKind> {
  const preset = (meta.appPreset || "").trim().toLowerCase();
  if (["react", "next", "nextjs", "vite", "react-vite"].includes(preset)) {
    return "react";
  }
  if (["html", "static", "static-html", "plain-html"].includes(preset)) {
    return "html";
  }

  if (!packageJson) {
    return (await hasAnyReactFileMarkers(projectDir)) ? "react" : "html";
  }

  const scripts = (packageJson.scripts || {}) as Record<string, unknown>;
  const hasBuildScript = typeof scripts.build === "string" && scripts.build.trim().length > 0;
  const hasReactDeps = hasAnyDependency(packageJson, [
    "react",
    "react-dom",
    "next",
    "@vitejs/plugin-react",
    "@vitejs/plugin-react-swc",
    "react-scripts",
  ]);

  return hasReactDeps || hasBuildScript ? "react" : "html";
}

async function commandExistsInPath(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const check = process.platform === "win32" ? `where ${command}` : `command -v ${command}`;
    const child = spawn(check, { shell: true, stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function detectPackageManager(projectDir: string): Promise<PackageManager> {
  if ((await pathExists(path.join(projectDir, "pnpm-lock.yaml"))) && (await commandExistsInPath("pnpm"))) {
    return "pnpm";
  }
  if ((await pathExists(path.join(projectDir, "yarn.lock"))) && (await commandExistsInPath("yarn"))) {
    return "yarn";
  }
  if ((await pathExists(path.join(projectDir, "bun.lockb"))) && (await commandExistsInPath("bun"))) {
    return "bun";
  }
  if ((await pathExists(path.join(projectDir, "bun.lock"))) && (await commandExistsInPath("bun"))) {
    return "bun";
  }
  return "npm";
}

function defaultInstallCommand(packageManager: PackageManager): string {
  if (packageManager === "pnpm") return "pnpm install --frozen-lockfile";
  if (packageManager === "yarn") return "yarn install --frozen-lockfile";
  if (packageManager === "bun") return "bun install";
  return "npm install --no-fund --no-audit";
}

function defaultBuildCommand(packageManager: PackageManager): string {
  if (packageManager === "pnpm") return "pnpm run build";
  if (packageManager === "yarn") return "yarn build";
  if (packageManager === "bun") return "bun run build";
  return "npm run build";
}

function hasBuildScript(packageJson: Record<string, unknown> | null): boolean {
  if (!packageJson) return false;
  const scripts = (packageJson.scripts || {}) as Record<string, unknown>;
  return typeof scripts.build === "string" && scripts.build.trim().length > 0;
}

function isLikelyBackendOnlyPackage(packageJson: Record<string, unknown> | null): boolean {
  if (!packageJson) return false;

  const hasBackendDependencies = hasAnyDependency(packageJson, [...BACKEND_DEPENDENCY_HINTS]);
  const hasFrontendDependencies = hasAnyDependency(packageJson, [...FRONTEND_DEPENDENCY_HINTS]);

  return hasBackendDependencies && !hasFrontendDependencies;
}

function isNpmInstallCommand(command: string): boolean {
  return /^npm\s+(install|ci)\b/i.test(command.trim());
}

function hasLegacyPeerDepsFlag(command: string): boolean {
  return /\s--legacy-peer-deps(\s|$)/i.test(command);
}

function isPeerDependencyConflictError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("eresolve") ||
    message.includes("upstream dependency conflict") ||
    message.includes("--legacy-peer-deps")
  );
}

async function runInstallWithFallback(
  installCommand: string,
  projectDir: string,
  onLog?: (line: string) => void
): Promise<string> {
  try {
    await runShellCommandStreaming(installCommand, projectDir, onLog);
    return installCommand;
  } catch (error) {
    if (
      isNpmInstallCommand(installCommand) &&
      !hasLegacyPeerDepsFlag(installCommand) &&
      isPeerDependencyConflictError(error)
    ) {
      const fallbackCommand = `${installCommand} --legacy-peer-deps`;
      onLog?.("npm install hit peer dependency conflict (ERESOLVE). Retrying with --legacy-peer-deps...");
      await runShellCommandStreaming(fallbackCommand, projectDir, onLog);
      return fallbackCommand;
    }

    throw error;
  }
}

async function prepareProjectForDeployment(
  projectDir: string,
  meta: DeployMeta,
  onLog?: (line: string) => void
): Promise<ProjectPreparation> {
  const packageJson = await readPackageJson(projectDir);

  if (packageJson) {
    onLog?.("package.json found in selected root. Treating as React build project.");

    let installCommand = "npm install --no-fund --no-audit";
    const buildCommand = "npm run build";

    onLog?.(`Running install: ${installCommand}`);
    installCommand = await runInstallWithFallback(installCommand, projectDir, onLog);
    onLog?.(`Running build: ${buildCommand}`);
    await runShellCommandStreaming(buildCommand, projectDir, onLog);

    const distOutput = path.join(projectDir, "dist");
    if (!(await pathExists(distOutput))) {
      throw new Error(
        'package.json was found, build ran, but "./dist" was not generated. ' +
          'This system expects React output at "./dist".'
      );
    }

    return {
      projectKind: "react",
      outputDir: distOutput,
      installCommand,
      buildCommand,
    };
  }

  onLog?.("No package.json in selected root. Treating as static HTML/CSS project.");
  const outputDir = await detectStaticOutputDirectory(projectDir, meta.outputDirectory);
  return { projectKind: "html", outputDir };
}

async function sendEvent(
  stream: SSEStreamingApi,
  event: "log" | "error" | "done",
  payload: Record<string, unknown>
): Promise<void> {
  await stream.writeSSE({
    event,
    data: JSON.stringify(payload),
  });
}

async function sendLog(stream: SSEStreamingApi, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  await sendEvent(stream, "log", { line: trimmed });
}

async function detectStaticOutputDirectory(projectDir: string, customOutput?: string): Promise<string> {
  if (customOutput && customOutput.trim()) {
    const customPath = path.join(projectDir, customOutput.trim());
    try {
      const stats = await fs.stat(customPath);
      if (stats.isDirectory()) return customPath;
    } catch {
      // Fall through to auto-detect candidates.
    }
  }

  for (const candidate of STATIC_OUTPUT_CANDIDATES) {
    const candidatePath = path.join(projectDir, candidate);
    try {
      const stats = await fs.stat(candidatePath);
      if (stats.isDirectory()) return candidatePath;
    } catch {
      // Keep scanning.
    }
  }

  if (await pathExists(path.join(projectDir, "index.html"))) {
    return projectDir;
  }

  throw new Error(
    "No frontend static output found in the selected root. " +
      'Use rootDirectory like "./frontend" or "./portfolio", or set outputDirectory like "dist".'
  );
}

async function detectReactBuildOutputDirectory(projectDir: string, customOutput?: string): Promise<string> {
  if (customOutput && customOutput.trim()) {
    const customPath = path.join(projectDir, customOutput.trim());
    try {
      const stats = await fs.stat(customPath);
      if (stats.isDirectory()) {
        return customPath;
      }
    } catch {
      throw new Error(
        `Configured outputDirectory "${customOutput}" was not found after build.`
      );
    }
  }

  for (const candidate of REACT_BUILD_OUTPUT_CANDIDATES) {
    const candidatePath = path.join(projectDir, candidate);
    try {
      const stats = await fs.stat(candidatePath);
      if (stats.isDirectory()) {
        return candidatePath;
      }
    } catch {
      // Keep scanning.
    }
  }

  throw new Error(
    "React build output not found. Expected one of: dist, build, out. " +
      "Do not deploy source files directly. Set outputDirectory if your framework uses a different folder."
  );
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeRuntimeEnvVars(envVars: DeployEnvVar[]): Record<string, string> {
  const runtimeVars: Record<string, string> = {};

  for (const envVar of envVars) {
    const key = (envVar.key || "").trim();
    if (!key) continue;
    runtimeVars[key] = envVar.value ?? "";
  }

  return runtimeVars;
}

async function listHtmlFiles(rootDir: string): Promise<string[]> {
  const htmlFiles: string[] = [];
  const skipDirs = new Set([".git", "node_modules"]);

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        htmlFiles.push(absolutePath);
      }
    }
  }

  await walk(rootDir);
  return htmlFiles;
}

function applyHtmlEnvPlaceholders(content: string, runtimeVars: Record<string, string>): string {
  let next = content;
  for (const [key, value] of Object.entries(runtimeVars)) {
    next = next.split(`{{${key}}}`).join(value);
  }
  return next;
}

function injectRuntimeEnvScriptTag(content: string, scriptSrc: string): string {
  if (content.includes(scriptSrc)) {
    return content;
  }

  const scriptTag = `<script src="${scriptSrc}"></script>`;

  if (/<\/head>/i.test(content)) {
    return content.replace(/<\/head>/i, `  ${scriptTag}\n</head>`);
  }

  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `  ${scriptTag}\n</body>`);
  }

  return `${scriptTag}\n${content}`;
}

function isLikelyStaticAssetPath(pathname: string): boolean {
  const ext = path.posix.extname(pathname.toLowerCase());
  return new Set([
    ".js",
    ".mjs",
    ".css",
    ".map",
    ".json",
    ".wasm",
    ".ico",
    ".png",
    ".jpg",
    ".jpeg",
    ".svg",
    ".gif",
    ".webp",
    ".avif",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".mp4",
    ".webm",
  ]).has(ext);
}

function splitPathAndSuffix(value: string): { pathOnly: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return {
    pathOnly: match?.[1] || value,
    suffix: match?.[2] || "",
  };
}

function rewriteRootAbsoluteAssetUrls(content: string, htmlRelativePath: string): { content: string; rewrites: number } {
  const htmlDir = path.posix.dirname(toPosixPath(htmlRelativePath));
  let rewrites = 0;

  const next = content.replace(
    /(\b(?:src|href)\s*=\s*["'])\/(?!\/|#)([^"']+)(["'])/gi,
    (full, prefix: string, target: string, suffixQuote: string) => {
      const { pathOnly, suffix } = splitPathAndSuffix(target);
      if (!isLikelyStaticAssetPath(pathOnly)) {
        return full;
      }

      const normalizedTarget = pathOnly.replace(/^\/+/, "");
      let relativeTarget = path.posix.relative(htmlDir, normalizedTarget);
      if (!relativeTarget || !relativeTarget.startsWith(".")) {
        relativeTarget = `./${relativeTarget}`;
      }
      rewrites += 1;
      return `${prefix}${relativeTarget}${suffix}${suffixQuote}`;
    }
  );

  return { content: next, rewrites };
}

async function injectRuntimeEnvForStaticOutput(
  outputDir: string,
  envVars: DeployEnvVar[]
): Promise<{ envCount: number; htmlUpdated: number; assetUrlRewrites: number }> {
  const runtimeVars = normalizeRuntimeEnvVars(envVars);
  const envCount = Object.keys(runtimeVars).length;
  let runtimeScriptPath: string | null = null;
  if (envCount > 0) {
    const runtimeScriptName = "w3deploy-env.js";
    runtimeScriptPath = path.join(outputDir, runtimeScriptName);
    const scriptBody = `window.__W3DEPLOY_ENV__ = Object.freeze(${JSON.stringify(runtimeVars, null, 2)});\n`;
    await fs.writeFile(runtimeScriptPath, scriptBody, "utf-8");
  }

  const htmlFiles = await listHtmlFiles(outputDir);
  let htmlUpdated = 0;
  let assetUrlRewrites = 0;

  for (const htmlFilePath of htmlFiles) {
    const originalContent = await fs.readFile(htmlFilePath, "utf-8");
    const htmlRelativePath = toPosixPath(path.relative(outputDir, htmlFilePath));
    const rewriteResult = rewriteRootAbsoluteAssetUrls(originalContent, htmlRelativePath);
    assetUrlRewrites += rewriteResult.rewrites;

    const withPlaceholders =
      envCount > 0 ? applyHtmlEnvPlaceholders(rewriteResult.content, runtimeVars) : rewriteResult.content;
    const withScript =
      envCount > 0 && runtimeScriptPath
        ? injectRuntimeEnvScriptTag(
            withPlaceholders,
            (() => {
              const relativeScriptPath = toPosixPath(path.relative(path.dirname(htmlFilePath), runtimeScriptPath));
              return relativeScriptPath.startsWith(".") ? relativeScriptPath : `./${relativeScriptPath}`;
            })()
          )
        : withPlaceholders;

    if (withScript !== originalContent) {
      await fs.writeFile(htmlFilePath, withScript, "utf-8");
      htmlUpdated += 1;
    }
  }

  return { envCount, htmlUpdated, assetUrlRewrites };
}

async function collectOutputFilesForPinata(outputDir: string, rootFolderName: string): Promise<File[]> {
  const files: File[] = [];
  const normalizedRootFolder = normalizeProjectLabel(rootFolderName || "site");

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toPosixPath(path.relative(outputDir, absolutePath));
      if (!relativePath || relativePath.startsWith("..")) {
        continue;
      }

      const content = await fs.readFile(absolutePath);
      const uploadPath = `${normalizedRootFolder}/${relativePath}`;
      const file = new File([new Uint8Array(content)], path.basename(relativePath), {
        type: "application/octet-stream",
      }) as FileWithWebkitPath;

      Object.defineProperty(file, "webkitRelativePath", {
        value: uploadPath,
        configurable: true,
      });

      files.push(file);
    }
  }

  await walk(outputDir);

  if (files.length === 0) {
    throw new Error("No files found in the output directory to upload.");
  }

  return files;
}

function buildCanonicalIpfsUrl(cid: string, suffix = ""): string {
  const cleanCid = cid.replace(/^\/+|\/+$/g, "");
  const cleanSuffix = suffix.replace(/^\/+|\/+$/g, "");
  if (!cleanSuffix) {
    return `https://ipfs.io/ipfs/${cleanCid}/`;
  }
  return `https://ipfs.io/ipfs/${cleanCid}/${cleanSuffix}/`;
}

function buildGatewayBaseCandidates(): string[] {
  // Always prefer canonical public gateway links in API responses.
  // We keep dweb.link as fallback reachability probe only.
  return ["https://ipfs.io/ipfs", "https://dweb.link/ipfs"];
}

async function isGatewayPathReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });

    if (headResponse.ok) {
      return true;
    }

    if (headResponse.status !== 405) {
      return false;
    }
  } catch {
    // Fall back to lightweight GET probe below.
  } finally {
    clearTimeout(timeout);
  }

  const getController = new AbortController();
  const getTimeout = setTimeout(() => getController.abort(), 7000);
  try {
    const getResponse = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-2048" },
      signal: getController.signal,
    });

    if (!getResponse.ok) {
      return false;
    }

    const contentType = (getResponse.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text") || contentType.includes("html") || contentType.includes("json")) {
      const sample = (await getResponse.text()).toLowerCase();
      if (
        sample.includes("html content cannot be served through the pinata public gateway") ||
        sample.includes("err_id:00023")
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(getTimeout);
  }
}

async function resolveDirectSiteUrl(cid: string, rootFolderName: string): Promise<string> {
  const rootPath = normalizeProjectLabel(rootFolderName || "site");
  const gatewayBases = buildGatewayBaseCandidates();
  const candidates: string[] = [];

  for (const base of gatewayBases) {
    candidates.push(`${base}/${cid}/${rootPath}/`);
    candidates.push(`${base}/${cid}/`);
  }

  for (const candidate of candidates) {
    if (await isGatewayPathReachable(candidate)) {
      try {
        const parsed = new URL(candidate);
        const match = parsed.pathname.match(/^\/ipfs\/([^/]+)(\/.*)?$/i);
        const urlCid = match?.[1] || cid;
        const suffix = (match?.[2] || "/").replace(/^\/+|\/+$/g, "");
        return buildCanonicalIpfsUrl(urlCid, suffix);
      } catch {
        return buildCanonicalIpfsUrl(cid, rootPath);
      }
    }
  }

  return buildCanonicalIpfsUrl(cid, rootPath);
}

async function getCommitHash(repoDir: string): Promise<string> {
  try {
    const { stdout } = await runCommand("git", ["rev-parse", "HEAD"], repoDir);
    const hash = stdout.trim();
    return hash || "unknown";
  } catch {
    return "unknown";
  }
}

function parseMetaSafe(raw: unknown): DeployMeta {
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw) as DeployMeta;
    } catch {
      return { notes: String(raw) };
    }
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const parsedEnvVars = Array.isArray(obj.envVars)
      ? obj.envVars
          .filter((item): item is { key?: unknown; value?: unknown } => Boolean(item && typeof item === "object"))
          .map((item) => ({
            key: typeof item.key === "string" ? item.key : "",
            value: typeof item.value === "string" ? item.value : "",
          }))
      : undefined;

    return {
      notes: typeof obj.notes === "string" ? obj.notes : undefined,
      projectName: typeof obj.projectName === "string" ? obj.projectName : undefined,
      appPreset: typeof obj.appPreset === "string" ? obj.appPreset : undefined,
      rootDirectory: typeof obj.rootDirectory === "string" ? obj.rootDirectory : undefined,
      buildCommand: typeof obj.buildCommand === "string" ? obj.buildCommand : undefined,
      installCommand: typeof obj.installCommand === "string" ? obj.installCommand : undefined,
      outputDirectory: typeof obj.outputDirectory === "string" ? obj.outputDirectory : undefined,
      envVars: parsedEnvVars,
      env: typeof obj.env === "string" ? obj.env : undefined,
    };
  }

  return {};
}

function normalizeProjectLabel(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "project";
}

function normalizeWalletAddress(value: string): string {
  return value.trim().toUpperCase();
}

function getWalletFromRequest(c: any): string | null {
  const wallet = c.req.header("x-wallet-address") || "";
  if (!wallet) return null;
  if (!isValidWalletAddress(wallet)) return null;
  return normalizeWalletAddress(wallet);
}

const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) return c.json({ error: "Unauthorized" }, 401);
  const token = authHeader.split(" ")[1];
  try {
    const decoded = await verify(token, JWT_SECRET, "HS256");
    c.set("jwtPayload", decoded);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
};

export const deployRouter = new Hono();

deployRouter.get("/status", (c) => {
  return c.json({
    active: getActiveDeployCount(),
    max: getMaxConcurrent(),
  });
});

deployRouter.post("/stream", authMiddleware, async (c) => {
  const walletAddress = getWalletFromRequest(c);
  if (!walletAddress) {
    return c.json({ error: "Connect your wallet before deploying." }, 400);
  }

  const userId = walletAddress;
  const body = await c.req.json<DeployRequestBody>().catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : "";
  const labelValue = typeof body.label === "string" ? body.label.trim() : "";
  const label = normalizeProjectLabel(labelValue || "default-domain");
  const meta = parseMetaSafe(body.meta);

  if (!repoUrl) {
    return c.json({ error: "repoUrl is required" }, 400);
  }

  if (!canStartDeploy()) {
    return c.json({ error: "Max concurrent deploys reached. Please wait." }, 429);
  }

  const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempDir = path.join(TEMP_ROOT, deploymentId);

  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return streamSSE(c, async (stream) => {
    incrementActiveDeploys();

    try {
      await sendLog(stream, "Starting deployment pipeline...");
      await sendLog(stream, `Project: ${meta.projectName || label}`);
      await sendLog(stream, `Repository: ${repoUrl}`);
      await fs.mkdir(TEMP_ROOT, { recursive: true });

      await sendLog(stream, "Cloning repository...");
      await runCommandStreaming("git", ["clone", "--depth", "1", repoUrl, tempDir], TEMP_ROOT, (line) => {
        sendLog(stream, `  ${line}`).catch(() => {});
      });
      await sendLog(stream, "Repository cloned successfully");

      const workDir = await resolveProjectDirectory(tempDir, meta);
      if (!(await pathExists(workDir))) {
        throw new Error(`Root directory "${meta.rootDirectory || "./"}" not found in the repository.`);
      }
      if (workDir !== tempDir) {
        await sendLog(stream, `Using root directory: ${path.relative(tempDir, workDir)}`);
      }

      const envVars = meta.envVars || [];
      if (envVars.length > 0) {
        await sendLog(stream, `Writing ${envVars.length} environment variable(s)...`);
        const envContent = envVars
          .filter((v) => v.key && v.key.trim())
          .map((v) => `${v.key.trim()}=${v.value}`)
          .join("\n");
        await fs.writeFile(path.join(workDir, ".env"), envContent + "\n", "utf-8");
        await sendLog(stream, "Environment variables written to .env");
      }

      const prepared = await prepareProjectForDeployment(workDir, meta, (line) => {
        sendLog(stream, `  ${line}`).catch(() => {});
      });
      if (prepared.projectKind === "html") {
        await sendLog(stream, "Detected HTML/static project. Skipping install/build.");
      }

      const outputDir = prepared.outputDir;
      await sendLog(stream, `Build output directory: ${path.relative(workDir, outputDir) || path.basename(outputDir)}`);

      if (prepared.projectKind === "html") {
        const runtimeEnvResult = await injectRuntimeEnvForStaticOutput(outputDir, envVars);
        if (runtimeEnvResult.assetUrlRewrites > 0) {
          await sendLog(stream, `Rewrote ${runtimeEnvResult.assetUrlRewrites} root-absolute asset URL(s) for IPFS.`);
        }
        if (runtimeEnvResult.envCount > 0) {
          await sendLog(stream, `Injected runtime env for static HTML (${runtimeEnvResult.envCount} key(s)).`);
        }
        if (runtimeEnvResult.htmlUpdated > 0) {
          await sendLog(stream, `Updated ${runtimeEnvResult.htmlUpdated} HTML file(s).`);
        }
      }

      await sendLog(stream, "Collecting static files for direct IPFS upload...");
      const uploadRootFolder = normalizeProjectLabel(meta.projectName || label || "site");
      const filesToUpload = await collectOutputFilesForPinata(outputDir, uploadRootFolder);
      await sendLog(stream, `Prepared files: ${filesToUpload.length}`);

      await sendLog(stream, "Uploading folder to IPFS via Pinata...");
      const safeLabel = label.replace(/[^a-zA-Z0-9.-]/g, "-");
      const uploadResult = await pinata.upload.fileArray(filesToUpload, {
        metadata: {
          name: `w3deploy-${safeLabel}-${Date.now()}`,
        },
        cidVersion: 1,
      });

      const cid = uploadResult.IpfsHash;
      if (!cid) {
        throw new Error("Upload completed without an IPFS CID.");
      }

      const siteUrl = await resolveDirectSiteUrl(cid, uploadRootFolder);
      await sendLog(stream, "IPFS upload complete");
      await sendLog(stream, `CID: ${cid}`);
      await sendLog(stream, `Site URL: ${siteUrl}`);

      const commitHash = await getCommitHash(tempDir);
      await sendLog(stream, `Commit: ${commitHash.slice(0, 8)}`);

      await sendLog(stream, "Saving deployment record...");

      const repoMatch = repoUrl.match(/github\.com\/([^/]+\/[^/.]+)/);
      const repoFullName = repoMatch ? repoMatch[1] : repoUrl;

      const project = await upsertProject(label, userId, {
        repoFullName,
        branch: "main",
        rootDirectory: meta.rootDirectory || "./",
        buildCommand: prepared.buildCommand || meta.buildCommand || "none",
        installCommand: prepared.installCommand || meta.installCommand || "none",
        outputDirectory: meta.outputDirectory || "",
        appPreset: meta.appPreset || prepared.projectKind,
        envVars,
        env: meta.env || "production",
        webhookId: null,
      });

      const deployment = await addDeployment({
        projectId: project.id,
        domain: label,
        cid,
        env: meta.env || "production",
        meta: meta.notes || "",
        commitHash,
        deployer: userId,
        timestamp: Math.floor(Date.now() / 1000),
        url: siteUrl,
      });

      await sendLog(stream, "Deployment record saved");
      await sendLog(stream, "Deployment successful");

      await sendEvent(stream, "done", {
        domain: label,
        cid,
        url: siteUrl,
        gatewayUrl: siteUrl,
        rawGatewayUrl: siteUrl,
        txId: deployment.txId || null,
      });
    } catch (error: unknown) {
      console.error("Deployment workflow failed:", error);
      await sendEvent(stream, "error", { message: getErrorMessage(error) });
    } finally {
      decrementActiveDeploys();
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("Failed to remove deployment temp directory:", cleanupError);
      }
    }
  });
});

export async function triggerDeploy(
  repoUrl: string,
  label: string,
  userId: string,
  projectMeta: DeployMeta,
  onLog?: (line: string) => void
): Promise<{ cid: string; url: string; commitHash: string } | null> {
  if (!canStartDeploy()) {
    onLog?.("Max concurrent deploys reached. Skipping.");
    return null;
  }

  incrementActiveDeploys();

  const deploymentId = `webhook-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempDir = path.join(TEMP_ROOT, deploymentId);
  const log = onLog || console.log;

  try {
    await fs.mkdir(TEMP_ROOT, { recursive: true });

    log("Cloning repository...");
    await runCommand("git", ["clone", "--depth", "1", repoUrl, tempDir], TEMP_ROOT);

    const workDir = await resolveProjectDirectory(tempDir, projectMeta);
    if (!(await pathExists(workDir))) {
      throw new Error(`Root directory "${projectMeta.rootDirectory || "./"}" not found in the repository.`);
    }
    if (workDir !== tempDir) {
      log(`Using root directory: ${path.relative(tempDir, workDir)}`);
    }

    const envVars = projectMeta.envVars || [];
    if (envVars.length > 0) {
      const envContent = envVars
        .filter((v) => v.key && v.key.trim())
        .map((v) => `${v.key.trim()}=${v.value}`)
        .join("\n");
      await fs.writeFile(path.join(workDir, ".env"), envContent + "\n", "utf-8");
    }

    const prepared = await prepareProjectForDeployment(workDir, projectMeta, (line) => {
      log(`  ${line}`);
    });
    if (prepared.projectKind === "html") {
      log("Detected HTML/static project. Skipping install/build.");
    }

    const outputDir = prepared.outputDir;
    log(`Output directory: ${path.basename(outputDir)}`);

    if (prepared.projectKind === "html") {
      const runtimeEnvResult = await injectRuntimeEnvForStaticOutput(outputDir, envVars);
      if (runtimeEnvResult.assetUrlRewrites > 0) {
        log(`Rewrote ${runtimeEnvResult.assetUrlRewrites} root-absolute asset URL(s) for IPFS.`);
      }
      if (runtimeEnvResult.envCount > 0) {
        log(`Injected runtime env for static HTML (${runtimeEnvResult.envCount} key(s)).`);
      }
      if (runtimeEnvResult.htmlUpdated > 0) {
        log(`Updated ${runtimeEnvResult.htmlUpdated} HTML file(s).`);
      }
    }

    const safeLabel = label.replace(/[^a-zA-Z0-9.-]/g, "-");
    const uploadRootFolder = normalizeProjectLabel(projectMeta.projectName || label || "site");
    const filesToUpload = await collectOutputFilesForPinata(outputDir, uploadRootFolder);
    const uploadResult = await pinata.upload.fileArray(filesToUpload, {
      metadata: {
        name: `w3deploy-${safeLabel}-${Date.now()}`,
      },
      cidVersion: 1,
    });

    const cid = uploadResult.IpfsHash;
    if (!cid) {
      throw new Error("Upload completed without an IPFS CID.");
    }

    const deploymentUrl = await resolveDirectSiteUrl(cid, uploadRootFolder);
    const commitHash = await getCommitHash(tempDir);

    log(`Deployed to IPFS: ${cid}`);

    const repoMatch = repoUrl.match(/github\.com\/([^/]+\/[^/.]+)/);
    const repoFullName = repoMatch ? repoMatch[1] : repoUrl;

    const project = await upsertProject(label, userId, {
      repoFullName,
      branch: "main",
      rootDirectory: projectMeta.rootDirectory || "./",
      buildCommand: prepared.buildCommand || projectMeta.buildCommand || "none",
      installCommand: prepared.installCommand || projectMeta.installCommand || "none",
      outputDirectory: projectMeta.outputDirectory || "",
      appPreset: projectMeta.appPreset || prepared.projectKind,
      envVars,
      env: projectMeta.env || "production",
      webhookId: null,
    });

    await addDeployment({
      projectId: project.id,
      domain: label,
      cid,
      env: projectMeta.env || "production",
      meta: "Auto-deploy from GitHub push",
      commitHash,
      deployer: userId,
      timestamp: Math.floor(Date.now() / 1000),
      url: deploymentUrl,
    });

    return { cid, url: deploymentUrl, commitHash };
  } catch (error) {
    log(`Deployment failed: ${getErrorMessage(error)}`);
    return null;
  } finally {
    decrementActiveDeploys();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
