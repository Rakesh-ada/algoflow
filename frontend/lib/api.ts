const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "https://api.d3ploy.xyz";
const AUTH_BASE: string =
  process.env.NEXT_PUBLIC_AUTH_API_URL ?? API_BASE;
const WALLET_STORAGE_KEY = "d3ploy_wallet_address";

declare global {
  interface Window {
    ethereum?: {
      request?: (args: { method: string }) => Promise<unknown>;
    };
  }
}

const ALGORAND_ADDRESS_REGEX = /^[A-Z2-7]{58}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function normalizeWalletAddress(address: string): string {
  const raw = address.trim();
  if (isLikelyAlgorandAddress(raw)) {
    return raw.toUpperCase();
  }
  if (isLikelyEvmAddress(raw)) {
    return raw.toLowerCase();
  }
  return raw;
}

export function isLikelyAlgorandAddress(address: string): boolean {
  return ALGORAND_ADDRESS_REGEX.test(address.trim().toUpperCase());
}

export function isLikelyEvmAddress(address: string): boolean {
  return EVM_ADDRESS_REGEX.test(address.trim());
}

export function getWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(WALLET_STORAGE_KEY);
  if (!raw) return null;

  const normalized = normalizeWalletAddress(raw);
  if (!isLikelyAlgorandAddress(normalized) && !isLikelyEvmAddress(normalized)) {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    return null;
  }

  return normalized;
}

export function saveWalletAddress(address: string): string {
  const normalized = normalizeWalletAddress(address);
  if (!isLikelyAlgorandAddress(normalized) && !isLikelyEvmAddress(normalized)) {
    throw new Error("Invalid wallet address.");
  }

  localStorage.setItem(WALLET_STORAGE_KEY, normalized);
  return normalized;
}

export function clearWalletAddress() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(WALLET_STORAGE_KEY);
}

export async function connectWallet(): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Wallet connection is only available in the browser.");
  }

  const provider = window.ethereum;
  if (provider?.request) {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as
      | string[]
      | undefined;
    const account = accounts?.[0];
    if (!account) {
      throw new Error("No wallet account was returned by your wallet provider.");
    }
    return saveWalletAddress(String(account));
  }

  throw new Error("No compatible wallet provider found.");
}

export async function disconnectWallet() {
  clearWalletAddress();
}

// Token helpers
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("d3ploy_token");
}

export function saveToken(token: string) {
  localStorage.setItem("d3ploy_token", token);
}

export function clearToken() {
  localStorage.removeItem("d3ploy_token");
}

export function getTokenExpiryMs(token?: string | null): number | null {
  const raw = token ?? getToken();
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = atob(payloadB64);
    const payload = JSON.parse(payloadJson) as { exp?: number };
    if (!payload.exp) return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

export function isTokenExpired(token?: string | null): boolean {
  const expiry = getTokenExpiryMs(token);
  if (!expiry) return false;
  return Date.now() >= expiry;
}

// Core fetch wrapper
async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  return apiFetchFrom(API_BASE, path, opts);
}

async function apiFetchFrom<T = unknown>(
  baseUrl: string,
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const walletAddress = getWalletAddress();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (walletAddress) headers["X-Wallet-Address"] = walletAddress;

  const res = await fetch(`${baseUrl}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(`HTTP ${res.status}: ${err.error || "Request failed"}`);
  }
  return res.json() as Promise<T>;
}

function isMissingEndpointError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("HTTP 404");
}

function normalizeLabel(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";
  if (!trimmed.includes(".")) return trimmed;
  return trimmed.split(".")[0];
}

// Auth
export interface User {
  sub: string;
  provider: string;
  login: string;
  name: string;
  email: string;
  avatar: string;
  iat: number;
  exp: number;
}

export async function getMe(): Promise<{ user: User }> {
  return apiFetch("/api/auth/me");
}

export async function logout() {
  await apiFetchFrom(AUTH_BASE, "/api/auth/logout", { method: "POST" }).catch(() => {});
  clearToken();
}

export function getLoginUrl(): string {
  return `${AUTH_BASE}/api/auth/github`;
}

export function getGoogleLoginUrl(): string {
  return `${AUTH_BASE}/api/auth/google`;
}

export interface AuthProvider {
  id: string;
  name: string;
  url: string;
  available: boolean;
  note: string;
}

export async function getAuthProviders(): Promise<{ providers: AuthProvider[] }> {
  return apiFetchFrom(AUTH_BASE, "/api/auth/providers");
}

// Sites
export interface Deploy {
  cid: string;
  deployer: string;
  env: string;
  meta: string;
  timestamp: number;
  url: string;
  txId?: string | null;
  txExplorerUrl?: string | null;
}

export interface SiteDetail {
  domain: string;
  count: number;
  latest: Deploy | null;
  history: Deploy[];
}

export async function getSites(): Promise<{ domains: string[] }> {
  try {
    return await apiFetch("/api/sites");
  } catch (err: unknown) {
    if (isMissingEndpointError(err)) {
      return { domains: [] };
    }
    throw err;
  }
}

export async function getSite(domain: string): Promise<SiteDetail> {
  try {
    return await apiFetch(`/api/sites/${encodeURIComponent(domain)}`);
  } catch (err: unknown) {
    if (isMissingEndpointError(err)) {
      return { domain, count: 0, latest: null, history: [] };
    }
    throw err;
  }
}

export async function deleteSite(domain: string): Promise<{
  ok: boolean;
  domain: string;
  deletedDeployments: number;
  unpinned: number;
  unpinErrors: string[];
}> {
  return apiFetch(`/api/sites/${encodeURIComponent(domain)}`, {
    method: "DELETE",
  });
}

// Deploy
export interface DeployStatus {
  active: number;
  max: number;
}

export async function getDeployStatus(): Promise<DeployStatus> {
  return apiFetch("/api/deploy/status");
}

export interface DeployReceipt {
  domain: string;
  cid: string;
  url?: string;
  gatewayUrl?: string;
  rawGatewayUrl?: string;
  txId?: string | null;
  txExplorerUrl?: string | null;
  [key: string]: unknown;
}

/** Start a deploy, streaming SSE log lines back to the caller.
 *  Returns an abort function to cancel the deploy stream. */
export function deployStream(
  data: { repoUrl: string; domain: string; env?: string; meta?: string },
  onLog: (line: string) => void,
  onDone: (receipt: DeployReceipt) => void,
  onError: (message: string) => void
): () => void {
  const token = getToken();
  const walletAddress = getWalletAddress();
  const controller = new AbortController();

  (async () => {
    try {
      const label = normalizeLabel(data.domain);
      if (!label) {
        onError("Domain/label is required");
        return;
      }

      const res = await fetch(`${API_BASE}/api/deploy/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(walletAddress ? { "X-Wallet-Address": walletAddress } : {}),
        },
        body: JSON.stringify({
          repoUrl: data.repoUrl,
          label,
          meta: data.meta,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Deploy failed" }));
        onError(err.error || "Deploy failed");
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processSseBlock = (block: string) => {
        const lines = block.split(/\r?\n/);
        let event = "";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
            continue;
          }

          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        if (!event || dataLines.length === 0) return;

        const dataStr = dataLines.join("\n");
        try {
          const parsed = JSON.parse(dataStr);
          if (event === "log") onLog(parsed.line);
          else if (event === "done") {
            onDone({
              ...(parsed as DeployReceipt),
              domain: (parsed as DeployReceipt).domain ?? (parsed as { label?: string }).label ?? label,
              cid: (parsed as DeployReceipt).cid ?? (parsed as { CID?: string }).CID ?? "",
            });
          } else if (event === "error") {
            onError(parsed.message);
          }
        } catch {
          // Ignore malformed SSE payload chunks.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          processSseBlock(chunk);
        }
      }

      // Process any trailing fully-formed block if present when stream closes.
      if (buffer.trim()) {
        processSseBlock(buffer);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        onError(err.message);
      }
    }
  })();

  return () => controller.abort();
}

// GitHub
export interface Repo {
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  htmlUrl: string;
  connected: boolean;
}

export interface ConnectedRepo {
  repoFullName: string;
  owner: string;
  repo: string;
  branch: string;
  domain: string;
  domainMode: "auto";
  env: string;
  webhookId: number | null;
  connectedBy: string;
  recentDeploys: Deploy[];
}

export async function getRepos(): Promise<{ repos: Repo[] }> {
  return apiFetch("/api/github/repos");
}

export async function getBranches(
  owner: string,
  repo: string
): Promise<{ branches: string[] }> {
  return apiFetch(`/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`);
}

export async function connectRepo(data: {
  repoFullName: string;
  branch: string;
  domain?: string;
  env: string;
}): Promise<{ ok: boolean; key: string; webhookId: number | null; message: string; domain: string; domainMode: "auto" | "custom" }> {
  return apiFetch("/api/github/connect", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getConnectedRepos(): Promise<{ repos: ConnectedRepo[] }> {
  return apiFetch("/api/github/connected");
}

export async function disconnectRepo(
  owner: string,
  repo: string,
  branch: string
) {
  return apiFetch(
    `/api/github/connected/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}`,
    { method: "DELETE" }
  );
}
