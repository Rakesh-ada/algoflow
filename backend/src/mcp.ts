import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import algosdk from "algosdk";
import { Hono } from "hono";
import { verify } from "hono/jwt";
import { PinataSDK } from "pinata-web3";
import { verifyMessage } from "ethers";
import {
  addDeployment,
  canStartDeploy,
  decrementActiveDeploys,
  getActiveDeployCount,
  getMaxConcurrent,
  incrementActiveDeploys,
  isValidWalletAddress,
  upsertProject,
} from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "w3deploy-super-secret-key-change-me";
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
const DIRECT_GATEWAY_BASE = (process.env.DIRECT_GATEWAY_BASE || `https://${PINATA_GATEWAY}/ipfs`).trim();
const DIRECT_GATEWAY_BASES = (process.env.DIRECT_GATEWAY_BASES || "").trim();
const ALGO_EXPLORER_TX_BASE = (
  process.env.ALGO_EXPLORER_TX_BASE || "https://testnet.explorer.perawallet.app/tx"
).trim();
const TEMP_ROOT = path.join(os.tmpdir(), "w3deploy", "mcp");
const MAX_FILES = 1000;
const MAX_PATH_LENGTH = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const BUILD_OUTPUT_CANDIDATES = ["dist", "out", "build", ".next/static", ".next"] as const;

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type ChallengeRecord = {
  id: string;
  walletAddress: string;
  message: string;
  expiresAt: number;
};

const challengeStore = new Map<string, ChallengeRecord>();

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || "",
  pinataGateway: PINATA_GATEWAY,
});

type AgentFile = {
  path?: unknown;
  content?: unknown;
};

type DeployCodeBody = {
  label?: unknown;
  files?: unknown;
  meta?: unknown;
  challengeId?: unknown;
  challengeSignature?: unknown;
};

type FileWithWebkitPath = File & { webkitRelativePath?: string };

type DeployMeta = {
  notes?: string;
  env?: string;
  rootDirectory?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  projectName?: string;
  appPreset?: string;
  envVars?: { key: string; value: string }[];
};

export const mcpRouter = new Hono();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
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
  const trimmed = value.trim();
  if (EVM_ADDRESS_REGEX.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed.toUpperCase();
}

function getWalletFromRequest(c: any): string | null {
  const wallet = c.req.header("x-wallet-address") || "";
  if (!wallet) return null;
  if (!isValidWalletAddress(wallet)) return null;
  return normalizeWalletAddress(wallet);
}

function isAlgorandWalletAddress(value: string): boolean {
  return algosdk.isValidAddress(value.trim().toUpperCase());
}

function isEvmWalletAddress(value: string): boolean {
  return EVM_ADDRESS_REGEX.test(value.trim());
}

function pruneExpiredChallenges(): void {
  const now = Date.now();
  for (const [id, record] of challengeStore.entries()) {
    if (record.expiresAt <= now) {
      challengeStore.delete(id);
    }
  }
}

function buildChallengeMessage(walletAddress: string, challengeId: string, expiresAt: number): string {
  return [
    "W3DEPLOY MCP Deploy Challenge",
    `Challenge ID: ${challengeId}`,
    `Wallet: ${walletAddress}`,
    `Expires At: ${new Date(expiresAt).toISOString()}`,
    "Action: authorize deploy-code",
  ].join("\n");
}

function parseSignatureBytes(signature: string): Uint8Array | null {
  const raw = signature.trim();
  if (!raw) return null;

  if (raw.startsWith("0x") && raw.length > 2 && raw.length % 2 === 0) {
    try {
      return Uint8Array.from(Buffer.from(raw.slice(2), "hex"));
    } catch {
      return null;
    }
  }

  try {
    return Uint8Array.from(Buffer.from(raw, "base64"));
  } catch {
    return null;
  }
}

function verifyWalletSignature(walletAddress: string, message: string, signature: string): boolean {
  if (isEvmWalletAddress(walletAddress)) {
    try {
      const recovered = verifyMessage(message, signature);
      return recovered.toLowerCase() === walletAddress.toLowerCase();
    } catch {
      return false;
    }
  }

  if (isAlgorandWalletAddress(walletAddress)) {
    const signatureBytes = parseSignatureBytes(signature);
    if (!signatureBytes) {
      return false;
    }

    try {
      const messageBytes = new TextEncoder().encode(message);
      return algosdk.verifyBytes(messageBytes, signatureBytes, walletAddress);
    } catch {
      return false;
    }
  }

  return false;
}

function validateChallengeOwnership(
  walletAddress: string,
  challengeIdRaw: unknown,
  challengeSignatureRaw: unknown
): { ok: boolean; message?: string } {
  if (typeof challengeIdRaw !== "string" || !challengeIdRaw.trim()) {
    return { ok: false, message: "challengeId is required." };
  }
  if (typeof challengeSignatureRaw !== "string" || !challengeSignatureRaw.trim()) {
    return { ok: false, message: "challengeSignature is required." };
  }

  pruneExpiredChallenges();

  const challengeId = challengeIdRaw.trim();
  const challenge = challengeStore.get(challengeId);
  if (!challenge) {
    return { ok: false, message: "Challenge not found or expired." };
  }

  if (challenge.walletAddress !== walletAddress) {
    challengeStore.delete(challengeId);
    return { ok: false, message: "Challenge wallet mismatch." };
  }

  if (challenge.expiresAt <= Date.now()) {
    challengeStore.delete(challengeId);
    return { ok: false, message: "Challenge expired." };
  }

  const verified = verifyWalletSignature(walletAddress, challenge.message, challengeSignatureRaw.trim());
  if (!verified) {
    return { ok: false, message: "Invalid challenge signature." };
  }

  challengeStore.delete(challengeId);
  return { ok: true };
}

function parseMetaSafe(raw: unknown): DeployMeta {
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw) as DeployMeta;
    } catch {
      return { notes: raw };
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
      env: typeof obj.env === "string" ? obj.env : undefined,
      rootDirectory: typeof obj.rootDirectory === "string"
        ? obj.rootDirectory
        : undefined,
      installCommand: typeof obj.installCommand === "string"
        ? obj.installCommand
        : undefined,
      buildCommand: typeof obj.buildCommand === "string"
        ? obj.buildCommand
        : undefined,
      outputDirectory: typeof obj.outputDirectory === "string"
        ? obj.outputDirectory
        : undefined,
      projectName: typeof obj.projectName === "string" ? obj.projectName : undefined,
      appPreset: typeof obj.appPreset === "string" ? obj.appPreset : undefined,
      envVars: parsedEnvVars,
    };
  }

  return {};
}

function commandExistsInPath(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const check = process.platform === "win32" ? `where ${command}` : `command -v ${command}`;
    const child = spawn(check, { shell: true, stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function runShellCommand(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
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

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await fs.stat(pathname);
    return true;
  } catch {
    return false;
  }
}

async function resolveProjectDirectory(baseDir: string, rootDirectory?: string): Promise<string> {
  const rootDir = (rootDirectory || "").trim().replace(/^\.?\/?/, "").replace(/\/+$/, "");

  if (rootDir && rootDir !== ".") {
    const explicitDir = path.join(baseDir, rootDir);
    if (!(await pathExists(explicitDir))) {
      throw new Error(`Root directory "${rootDirectory}" not found in deploy payload.`);
    }
    return explicitDir;
  }

  if (await pathExists(path.join(baseDir, "package.json"))) {
    return baseDir;
  }

  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const candidateDir = path.join(baseDir, entry.name);
    if (await pathExists(path.join(candidateDir, "package.json"))) {
      candidates.push(candidateDir);
    }
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  return baseDir;
}

async function detectBuildOutputDirectory(projectDir: string, customOutput?: string): Promise<string> {
  if (customOutput && customOutput.trim()) {
    const customPath = path.join(projectDir, customOutput.trim());
    try {
      const stats = await fs.stat(customPath);
      if (stats.isDirectory()) return customPath;
    } catch {
      // Fall through to auto-detect candidates.
    }
  }

  for (const candidate of BUILD_OUTPUT_CANDIDATES) {
    const candidatePath = path.join(projectDir, candidate);
    try {
      const stats = await fs.stat(candidatePath);
      if (stats.isDirectory()) return candidatePath;
    } catch {
      // Keep scanning.
    }
  }

  return projectDir;
}

async function detectPackageManager(projectDir: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  try {
    await fs.stat(path.join(projectDir, "pnpm-lock.yaml"));
    if (await commandExistsInPath("pnpm")) return "pnpm";
  } catch {}

  try {
    await fs.stat(path.join(projectDir, "yarn.lock"));
    if (await commandExistsInPath("yarn")) return "yarn";
  } catch {}

  try {
    await fs.stat(path.join(projectDir, "bun.lockb"));
    if (await commandExistsInPath("bun")) return "bun";
  } catch {}

  try {
    await fs.stat(path.join(projectDir, "bun.lock"));
    if (await commandExistsInPath("bun")) return "bun";
  } catch {}

  return "npm";
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

function hasAnyDependency(packageJson: Record<string, unknown>, names: string[]): boolean {
  const dependencies = (packageJson.dependencies || {}) as Record<string, unknown>;
  const devDependencies = (packageJson.devDependencies || {}) as Record<string, unknown>;
  return names.some((name) => Boolean(dependencies[name] || devDependencies[name]));
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

async function detectProjectKind(projectDir: string, packageJson: Record<string, unknown> | null, meta: DeployMeta): Promise<"react" | "html"> {
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

async function prepareStaticOutput(projectDir: string, meta: DeployMeta): Promise<{ outputDir: string; projectKind: "react" | "html"; installCommand?: string; buildCommand?: string }> {
  const packageJson = await readPackageJson(projectDir);
  const projectKind = await detectProjectKind(projectDir, packageJson, meta);

  if (projectKind === "html") {
    const outputDir = await detectBuildOutputDirectory(projectDir, meta.outputDirectory);
    return { outputDir, projectKind };
  }

  const packageManager = await detectPackageManager(projectDir);
  const defaultInstallCommand =
    packageManager === "pnpm"
      ? "pnpm install --frozen-lockfile"
      : packageManager === "yarn"
      ? "yarn install --frozen-lockfile"
      : packageManager === "bun"
      ? "bun install"
      : "npm install --no-fund --no-audit";

  const defaultBuildCommand =
    packageManager === "pnpm"
      ? "pnpm run build"
      : packageManager === "yarn"
      ? "yarn build"
      : packageManager === "bun"
      ? "bun run build"
      : "npm run build";

  const installCommand = (meta.installCommand || defaultInstallCommand).trim();
  const buildCommand = (meta.buildCommand || defaultBuildCommand).trim();

  await runShellCommand(installCommand, projectDir);
  await runShellCommand(buildCommand, projectDir);

  const outputDir = await detectBuildOutputDirectory(projectDir, meta.outputDirectory);
  return {
    outputDir,
    projectKind,
    installCommand,
    buildCommand,
  };
}

function deploymentTxExplorerUrl(txId?: string): string | null {
  if (!txId) return null;
  const base = ALGO_EXPLORER_TX_BASE.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(txId)}`;
}

function validateAndNormalizeFiles(input: unknown): Array<{ path: string; content: string }> {
  if (!Array.isArray(input)) {
    throw new Error("files must be an array");
  }

  if (input.length === 0) {
    throw new Error("files cannot be empty");
  }

  if (input.length > MAX_FILES) {
    throw new Error(`Too many files. Maximum allowed is ${MAX_FILES}.`);
  }

  const normalized: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  for (const raw of input) {
    const item = raw as AgentFile;
    if (typeof item.path !== "string" || typeof item.content !== "string") {
      throw new Error("Each file must have string path and content fields.");
    }

    const filePath = item.path.replace(/\\/g, "/").trim().replace(/^\/+/, "");
    if (!filePath || filePath.length > MAX_PATH_LENGTH) {
      throw new Error(`Invalid file path: ${item.path}`);
    }

    if (filePath.includes("..") || path.posix.isAbsolute(filePath)) {
      throw new Error(`File path is not allowed: ${item.path}`);
    }

    if (Buffer.byteLength(item.content, "utf-8") > MAX_FILE_BYTES) {
      throw new Error(`File is too large: ${item.path}`);
    }

    if (seen.has(filePath)) {
      throw new Error(`Duplicate file path detected: ${filePath}`);
    }

    seen.add(filePath);
    normalized.push({ path: filePath, content: item.content });
  }

  return normalized;
}

async function writeAgentFiles(rootDir: string, files: Array<{ path: string; content: string }>): Promise<void> {
  for (const file of files) {
    const outputPath = path.join(rootDir, file.path);
    const resolved = path.resolve(outputPath);
    if (!resolved.startsWith(path.resolve(rootDir))) {
      throw new Error(`Unsafe output path: ${file.path}`);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, file.content, "utf-8");
  }
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
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
    throw new Error("No files found in deploy payload.");
  }

  return files;
}

function buildDirectGatewayFolderUrl(cid: string, folderPath = ""): string {
  const base = stripTrailingSlashes(DIRECT_GATEWAY_BASE);
  const suffix = folderPath ? `${folderPath.replace(/^\/+|\/+$/g, "")}/` : "";
  return `${base}/${cid}/${suffix}`;
}

function isPublicPinataGateway(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "gateway.pinata.cloud";
  } catch {
    return false;
  }
}

function buildGatewayBaseCandidates(): string[] {
  const configuredList = DIRECT_GATEWAY_BASES
    ? DIRECT_GATEWAY_BASES.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  const defaults = ["https://ipfs.io/ipfs", DIRECT_GATEWAY_BASE, "https://dweb.link/ipfs"];
  const unique = new Set<string>();

  for (const candidate of [...configuredList, ...defaults]) {
    const normalized = stripTrailingSlashes(candidate);
    if (!normalized) continue;
    if (isPublicPinataGateway(normalized)) continue;
    unique.add(normalized);
  }

  return [...unique];
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
    candidates.push(`${base}/${cid}/`);
    candidates.push(`${base}/${cid}/${rootPath}/`);
  }

  for (const candidate of candidates) {
    if (await isGatewayPathReachable(candidate)) {
      return candidate;
    }
  }

  return `https://ipfs.io/ipfs/${cid}/`;
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

mcpRouter.post("/connect", async (c) => {
  const { ide, workspace } = await c.req.json().catch(() => ({ ide: "unknown", workspace: "unknown" }));
  return c.json({
    status: "ok",
    mcp_token: "mock-mcp-token-" + Date.now(),
    message: "MCP Connection established. AI Agents can now push to W3DEPLOY.",
    ide,
    workspace,
  });
});

mcpRouter.post("/challenge", authMiddleware, async (c) => {
  const walletAddress = getWalletFromRequest(c);
  if (!walletAddress) {
    return c.json({ error: "Connect your wallet before requesting a challenge." }, 400);
  }

  if (!isEvmWalletAddress(walletAddress) && !isAlgorandWalletAddress(walletAddress)) {
    return c.json({ error: "Unsupported wallet format." }, 400);
  }

  pruneExpiredChallenges();

  const challengeId = crypto.randomUUID();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const message = buildChallengeMessage(walletAddress, challengeId, expiresAt);

  challengeStore.set(challengeId, {
    id: challengeId,
    walletAddress,
    message,
    expiresAt,
  });

  return c.json({
    challengeId,
    walletAddress,
    message,
    expiresAt,
    challengeType: isEvmWalletAddress(walletAddress) ? "evm_personal_sign" : "algorand_sign_bytes",
  });
});

mcpRouter.post("/deploy-code", authMiddleware, async (c) => {
  const walletAddress = getWalletFromRequest(c);
  if (!walletAddress) {
    return c.json({ error: "Connect your wallet before deploying." }, 400);
  }

  if (!canStartDeploy()) {
    return c.json({ error: "Max concurrent deploys reached. Please wait." }, 429);
  }

  const body = await c.req.json<DeployCodeBody>().catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const ownership = validateChallengeOwnership(walletAddress, body.challengeId, body.challengeSignature);
  if (!ownership.ok) {
    return c.json({ error: ownership.message || "Wallet ownership verification failed." }, 401);
  }

  const labelInput = typeof body.label === "string" ? body.label : "";
  const label = normalizeProjectLabel(labelInput || "agent-site");

  let files: Array<{ path: string; content: string }>;
  try {
    files = validateAndNormalizeFiles(body.files);
  } catch (error) {
    return c.json({ error: getErrorMessage(error) }, 400);
  }

  const meta = parseMetaSafe(body.meta);
  const deploymentId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempDir = path.join(TEMP_ROOT, deploymentId);

  incrementActiveDeploys();

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await writeAgentFiles(tempDir, files);

    const projectDir = await resolveProjectDirectory(tempDir, meta.rootDirectory);

    const prepared = await prepareStaticOutput(projectDir, {
      installCommand: meta.installCommand,
      buildCommand: meta.buildCommand,
      outputDirectory: meta.outputDirectory,
      appPreset: meta.appPreset,
    });

    const outputDir = prepared.outputDir;

    const uploadRootFolder = normalizeProjectLabel(label || "site");
    const pinataFiles = await collectOutputFilesForPinata(outputDir, uploadRootFolder);
    const uploadResult = await pinata.upload.fileArray(pinataFiles, {
      metadata: {
        name: `w3deploy-${label}-${Date.now()}`,
      },
      cidVersion: 1,
    });

    const cid = uploadResult.IpfsHash;
    if (!cid) {
      throw new Error("Upload completed without an IPFS CID.");
    }

    const siteUrl = await resolveDirectSiteUrl(cid, uploadRootFolder);

    const project = await upsertProject(label, walletAddress, {
      repoFullName: "agent://mcp",
      branch: "main",
      rootDirectory: meta.rootDirectory || "./",
      buildCommand: prepared.buildCommand || meta.buildCommand || "none",
      installCommand: prepared.installCommand || meta.installCommand || "none",
      outputDirectory: meta.outputDirectory || "",
      appPreset: meta.appPreset || prepared.projectKind,
      envVars: meta.envVars || [],
      env: meta.env || "production",
      webhookId: null,
    });

    const deployment = await addDeployment({
      projectId: project.id,
      domain: label,
      cid,
      env: meta.env || "production",
      meta: meta.notes || `Agent MCP deploy (${files.length} file(s))`,
      commitHash: "agent-direct",
      deployer: walletAddress,
      timestamp: Math.floor(Date.now() / 1000),
      url: siteUrl,
    });

    return c.json({
      ok: true,
      domain: label,
      cid,
      url: siteUrl,
      gatewayUrl: siteUrl,
      rawGatewayUrl: siteUrl,
      files: files.length,
      txId: deployment.txId || null,
      txExplorerUrl: deploymentTxExplorerUrl(deployment.txId),
      activeDeploys: getActiveDeployCount(),
      maxDeploys: getMaxConcurrent(),
    });
  } catch (error) {
    console.error("MCP direct deploy failed:", error);
    return c.json({ error: getErrorMessage(error) }, 500);
  } finally {
    decrementActiveDeploys();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

mcpRouter.get("/status", (c) => {
  return c.json({
    active: getActiveDeployCount(),
    max: getMaxConcurrent(),
    ready: true,
  });
});

export default mcpRouter;
