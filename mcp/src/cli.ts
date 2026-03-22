#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import process from "process";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { Wallet } from "ethers";

type DeployFile = {
  path: string;
  content: string;
};

type WizardConfig = {
  apiBaseUrl: string;
  walletAddress: string;
  jwtToken: string;
  evmPrivateKey: string;
  frontendUrl: string;
};

type ChallengeResponse = {
  challengeId: string;
  message: string;
  challengeType?: string;
  expiresAt?: number;
};

type DeployResponse = {
  ok?: boolean;
  domain?: string;
  cid?: string;
  url?: string;
  txId?: string | null;
  txExplorerUrl?: string | null;
  error?: string;
};

type HistoryResponse = {
  domain: string;
  count: number;
  latest: {
    cid: string;
    env: string;
    timestamp: number;
    url: string;
    txId?: string | null;
  } | null;
  history: Array<{
    cid: string;
    env: string;
    timestamp: number;
    url: string;
    txId?: string | null;
  }>;
};

const DEFAULT_API_BASE = process.env.W3DEPLOY_API_BASE || "http://localhost:8080";
const DEFAULT_WALLET_ADDRESS = process.env.W3DEPLOY_WALLET_ADDRESS || "";
const DEFAULT_JWT_TOKEN = process.env.W3DEPLOY_API_TOKEN || "";
const DEFAULT_EVM_PRIVATE_KEY = process.env.W3DEPLOY_EVM_PRIVATE_KEY || "";
const DEFAULT_FRONTEND_URL = process.env.W3DEPLOY_FRONTEND_URL || "https://www.web3deploy.me";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  ".vercel",
  ".idea",
  ".vscode",
]);

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "") || DEFAULT_API_BASE;
}

function normalizePrivateKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function maskValue(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 10) return "********";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
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

function isProbablyBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 8000);
  if (sampleSize === 0) return false;

  let suspicious = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const byte = buffer[i];
    if (byte === 0) return true;

    // Accept common whitespace and printable ranges.
    const isText =
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      (byte >= 32 && byte <= 126) ||
      (byte >= 160 && byte <= 255);

    if (!isText) suspicious += 1;
  }

  return suspicious / sampleSize > 0.2;
}

async function prompt(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue = ""
): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function pressEnter(rl: ReturnType<typeof createInterface>): Promise<void> {
  await rl.question("\nPress Enter to continue...");
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid JSON response from ${url}: ${text.slice(0, 240)}`);
    }
  }

  if (!response.ok) {
    const maybeError = payload && typeof payload === "object" ? (payload as { error?: unknown }).error : null;
    const errorText = typeof maybeError === "string" ? maybeError : `${response.status} ${response.statusText}`;
    throw new Error(`Request failed: ${errorText}`);
  }

  return payload as T;
}

function authHeaders(config: WizardConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.jwtToken}`,
    "X-Wallet-Address": config.walletAddress,
  };
}

async function ensureAuthConfig(rl: ReturnType<typeof createInterface>, config: WizardConfig): Promise<boolean> {
  if (!config.walletAddress) {
    config.walletAddress = await prompt(rl, "Wallet address");
  }

  if (!config.jwtToken) {
    config.jwtToken = await prompt(rl, "JWT token");
  }

  if (!config.walletAddress || !config.jwtToken) {
    console.log("\nWallet address and JWT token are required for deployment actions.");
    return false;
  }

  return true;
}

async function collectDeployFiles(rootDir: string): Promise<{ files: DeployFile[]; skipped: string[] }> {
  const files: DeployFile[] = [];
  const skipped: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      const rel = toPosixPath(path.relative(rootDir, abs));

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          skipped.push(`${rel}/ (ignored directory)`);
          continue;
        }
        await walk(abs);
        continue;
      }

      if (!entry.isFile()) {
        skipped.push(`${rel} (not a file)`);
        continue;
      }

      const content = await fs.readFile(abs);
      if (content.byteLength > MAX_FILE_BYTES) {
        skipped.push(`${rel} (larger than 2MB)`);
        continue;
      }

      if (isProbablyBinary(content)) {
        skipped.push(`${rel} (binary file)`);
        continue;
      }

      files.push({
        path: rel,
        content: content.toString("utf-8"),
      });

      if (files.length > MAX_FILES) {
        throw new Error(`Too many files. Maximum allowed is ${MAX_FILES}.`);
      }
    }
  }

  await walk(rootDir);
  return { files, skipped };
}

async function runConnectCheck(config: WizardConfig): Promise<void> {
  const url = `${config.apiBaseUrl}/api/mcp/connect`;
  const result = await fetchJson<{ status?: string; message?: string }>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ide: "w3deploy-cli", workspace: process.cwd() }),
  });

  console.log("\nMCP connect response:");
  console.log(`status: ${result.status || "unknown"}`);
  console.log(`message: ${result.message || "(no message)"}`);
}

async function runStatusCheck(config: WizardConfig): Promise<void> {
  const url = `${config.apiBaseUrl}/api/mcp/status`;
  const result = await fetchJson<{ active: number; max: number; ready?: boolean }>(url, {
    method: "GET",
  });

  console.log("\nDeploy queue status:");
  console.log(`ready: ${result.ready ? "yes" : "unknown"}`);
  console.log(`active: ${result.active}`);
  console.log(`max: ${result.max}`);
}

async function runHistoryFlow(
  rl: ReturnType<typeof createInterface>,
  config: WizardConfig
): Promise<void> {
  if (!(await ensureAuthConfig(rl, config))) return;

  const domain = normalizeProjectLabel(await prompt(rl, "Domain / label to inspect"));
  const url = `${config.apiBaseUrl}/api/sites/${encodeURIComponent(domain)}`;

  const response = await fetchJson<HistoryResponse>(url, {
    method: "GET",
    headers: authHeaders(config),
  });

  console.log(`\nDeployment history for ${response.domain}`);
  console.log(`total deployments: ${response.count}`);

  if (!response.latest) {
    console.log("No deployments found for this domain.");
    return;
  }

  console.log("\nLatest:");
  console.log(`cid: ${response.latest.cid}`);
  console.log(`env: ${response.latest.env}`);
  console.log(`url: ${response.latest.url}`);
  console.log(`timestamp: ${new Date(response.latest.timestamp * 1000).toISOString()}`);
  if (response.latest.txId) {
    console.log(`txId: ${response.latest.txId}`);
  }

  const list = response.history.slice(0, 5);
  if (list.length > 0) {
    console.log("\nRecent deployments:");
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      const when = new Date(item.timestamp * 1000).toISOString();
      console.log(`${i + 1}. ${item.cid} | ${item.env} | ${when}`);
    }
  }
}

async function resolveChallengeSignature(
  rl: ReturnType<typeof createInterface>,
  config: WizardConfig,
  challenge: ChallengeResponse
): Promise<string> {
  const privateKey = normalizePrivateKey(config.evmPrivateKey);

  if (privateKey) {
    const wallet = new Wallet(privateKey);
    if (wallet.address.toLowerCase() !== config.walletAddress.toLowerCase()) {
      throw new Error(
        `Private key wallet mismatch. Header wallet is ${config.walletAddress}, private key resolves to ${wallet.address}.`
      );
    }

    return wallet.signMessage(challenge.message);
  }

  console.log("\nNo EVM private key was provided, manual signature is required.");
  console.log("Copy and sign this challenge message in your wallet app:\n");
  console.log(challenge.message);
  console.log("");

  const signature = await prompt(rl, "Paste challenge signature");
  if (!signature) {
    throw new Error("Challenge signature is required.");
  }

  return signature;
}

async function runDeployFlow(
  rl: ReturnType<typeof createInterface>,
  config: WizardConfig
): Promise<void> {
  if (!(await ensureAuthConfig(rl, config))) return;

  const folderInput = await prompt(rl, "Project folder path", process.cwd());
  const resolvedFolder = path.resolve(folderInput);

  const folderStat = await fs.stat(resolvedFolder).catch(() => null);
  if (!folderStat || !folderStat.isDirectory()) {
    throw new Error(`Directory not found: ${resolvedFolder}`);
  }

  const defaultLabel = normalizeProjectLabel(path.basename(resolvedFolder));
  const label = normalizeProjectLabel(await prompt(rl, "Deployment label/domain", defaultLabel));
  const env = (await prompt(rl, "Environment", "production")).trim() || "production";
  const appPreset = (await prompt(rl, "App preset (optional: static/react/next)", "")).trim();
  const rootDirectory = (await prompt(rl, "Root directory inside payload (optional)", "")).trim();
  const notes = (await prompt(rl, "Notes (optional)", "")).trim();

  console.log("\nCollecting deployable files...");
  const { files, skipped } = await collectDeployFiles(resolvedFolder);

  if (files.length === 0) {
    throw new Error("No deployable text files found. Binary-only folders are not supported by deploy-code API.");
  }

  console.log(`Collected ${files.length} file(s).`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} file(s)/folders.`);
    const sample = skipped.slice(0, 6);
    for (const item of sample) {
      console.log(`- ${item}`);
    }
    if (skipped.length > sample.length) {
      console.log(`...and ${skipped.length - sample.length} more`);
    }
  }

  console.log("\nRequesting deploy challenge...");
  const challenge = await fetchJson<ChallengeResponse>(`${config.apiBaseUrl}/api/mcp/challenge`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({}),
  });

  const signature = await resolveChallengeSignature(rl, config, challenge);

  console.log("Submitting deployment...");
  const deployPayload = {
    label,
    files,
    challengeId: challenge.challengeId,
    challengeSignature: signature,
    meta: {
      notes,
      env,
      appPreset: appPreset || undefined,
      rootDirectory: rootDirectory || undefined,
    },
  };

  const response = await fetchJson<DeployResponse>(`${config.apiBaseUrl}/api/mcp/deploy-code`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(deployPayload),
  });

  console.log("\nDeployment complete.");
  console.log(`domain: ${response.domain || label}`);
  console.log(`cid: ${response.cid || "(unknown)"}`);
  if (response.url) {
    console.log(`url: ${response.url}`);
  }
  if (response.txId) {
    console.log(`txId: ${response.txId}`);
  }
  if (response.txExplorerUrl) {
    console.log(`explorer: ${response.txExplorerUrl}`);
  }
}

function showConfigSummary(config: WizardConfig): void {
  console.log("\nCurrent CLI configuration:");
  console.log(`API Base URL   : ${config.apiBaseUrl}`);
  console.log(`Wallet Address : ${config.walletAddress || "(empty)"}`);
  console.log(`JWT Token      : ${maskValue(config.jwtToken)}`);
  console.log(`EVM Priv Key   : ${config.evmPrivateKey ? "configured" : "(empty)"}`);
  console.log(`Frontend URL   : ${config.frontendUrl}`);
}

function showClaudeConfig(config: WizardConfig): void {
  const snippet = {
    mcpServers: {
      w3deploy: {
        command: "w3deploy-mcp",
        env: {
          W3DEPLOY_API_BASE: config.apiBaseUrl,
          W3DEPLOY_WALLET_ADDRESS: config.walletAddress || "<YOUR_WALLET_ADDRESS>",
          W3DEPLOY_API_TOKEN: config.jwtToken || "<YOUR_PRODUCTION_JWT>",
          W3DEPLOY_EVM_PRIVATE_KEY: config.evmPrivateKey || "<YOUR_PRIVATE_KEY_IF_AUTOSIGN>",
        },
      },
    },
  };

  console.log("\nClaude MCP config snippet:\n");
  console.log(JSON.stringify(snippet, null, 2));
}

async function runSetupFlow(rl: ReturnType<typeof createInterface>, config: WizardConfig): Promise<void> {
  config.apiBaseUrl = normalizeApiBaseUrl(await prompt(rl, "API base URL", config.apiBaseUrl));
  config.walletAddress = (await prompt(rl, "Wallet address", config.walletAddress)).trim();
  config.jwtToken = (await prompt(rl, "JWT token", config.jwtToken)).trim();
  config.evmPrivateKey = (await prompt(rl, "EVM private key (optional)", config.evmPrivateKey)).trim();
  config.frontendUrl = (await prompt(rl, "Frontend URL", config.frontendUrl)).trim() || config.frontendUrl;

  showConfigSummary(config);
}

function printBanner(): void {
  console.log("\nW3DEPLOY CLI Wizard");
  console.log("Navigate deployment with Web + MCP in one flow.\n");
}

function printMenu(): void {
  console.log("Choose an action:");
  console.log("1) Setup credentials and URLs");
  console.log("2) MCP connect health check");
  console.log("3) Deploy project folder");
  console.log("4) View deployment history");
  console.log("5) Show Claude MCP config snippet");
  console.log("6) Check deploy queue status");
  console.log("7) Show current configuration");
  console.log("0) Exit");
}

async function main(): Promise<void> {
  const rl = createInterface({ input, output });

  const config: WizardConfig = {
    apiBaseUrl: normalizeApiBaseUrl(DEFAULT_API_BASE),
    walletAddress: DEFAULT_WALLET_ADDRESS.trim(),
    jwtToken: DEFAULT_JWT_TOKEN.trim(),
    evmPrivateKey: DEFAULT_EVM_PRIVATE_KEY.trim(),
    frontendUrl: DEFAULT_FRONTEND_URL.trim(),
  };

  printBanner();

  while (true) {
    try {
      printMenu();
      const choice = (await rl.question("\nSelect option: ")).trim();

      if (choice === "0") {
        break;
      }

      if (choice === "1") {
        await runSetupFlow(rl, config);
      } else if (choice === "2") {
        await runConnectCheck(config);
      } else if (choice === "3") {
        await runDeployFlow(rl, config);
      } else if (choice === "4") {
        await runHistoryFlow(rl, config);
      } else if (choice === "5") {
        showClaudeConfig(config);
      } else if (choice === "6") {
        await runStatusCheck(config);
      } else if (choice === "7") {
        showConfigSummary(config);
      } else {
        console.log("Unknown option. Enter a number from the menu.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`\nError: ${message}`);
    }

    await pressEnter(rl);
    console.log("");
  }

  rl.close();
  console.log("\nBye.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${message}`);
  process.exitCode = 1;
});
