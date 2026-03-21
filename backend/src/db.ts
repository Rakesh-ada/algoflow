import crypto from "crypto";
import algosdk from "algosdk";

// Types

export interface Project {
  id: string;
  domain: string;
  repoFullName: string;
  branch: string;
  rootDirectory: string;
  buildCommand: string;
  installCommand: string;
  outputDirectory: string;
  appPreset: string;
  envVars: { key: string; value: string }[];
  env: string;
  webhookId: number | null;
  createdAt: number;
  updatedAt: number;
  userId: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  domain: string;
  cid: string;
  env: string;
  meta: string;
  commitHash: string;
  deployer: string;
  timestamp: number;
  url: string;
  txId?: string;
}

interface Database {
  projects: Project[];
  deployments: Deployment[];
}

type StoredProject = Omit<Project, "envVars"> & {
  envVarKeys: string[];
};

type ChainEvent =
  | {
      v: 1;
      type: "project_upsert";
      wallet: string;
      timestamp: number;
      project: StoredProject;
    }
  | {
      v: 1;
      type: "deployment_add";
      wallet: string;
      timestamp: number;
      deployment: Deployment;
    }
  | {
      v: 1;
      type: "project_delete";
      wallet: string;
      timestamp: number;
      domain: string;
    };

export type RemoveProjectResult = {
  project: Project;
  deployments: Deployment[];
  cids: string[];
};

// Algorand configuration

const ALGO_NOTE_PREFIX = (process.env.ALGO_NOTE_PREFIX || "w3deploy:v1").trim();
const NOTE_PREFIX = `${ALGO_NOTE_PREFIX}:`;
const MAX_NOTE_BYTES = 1024;
const CACHE_TTL_MS = 15_000;

const ALGOD_SERVER = process.env.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
const ALGOD_PORT = process.env.ALGOD_PORT || "";
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || "";

const INDEXER_SERVER = process.env.INDEXER_SERVER || "https://testnet-idx.algonode.cloud";
const INDEXER_PORT = process.env.INDEXER_PORT || "";
const INDEXER_TOKEN = process.env.INDEXER_TOKEN || "";

const ADMIN_ALGO_MNEMONIC = (process.env.ADMIN_ALGO_MNEMONIC || "").trim();

const algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
const indexerClient = new algosdk.Indexer(INDEXER_TOKEN, INDEXER_SERVER, INDEXER_PORT);

const EMPTY_DB: Database = { projects: [], deployments: [] };

let adminAccount: algosdk.Account | null = null;
let cachedDb: Database = cloneDb(EMPTY_DB);
let cachedAt = 0;
let loadPromise: Promise<Database> | null = null;
let indexerWarningShown = false;

const activeDeployState = {
  active: 0,
  max: 3,
};

initAdminAccount();

function initAdminAccount(): void {
  if (!isMnemonicConfigured(ADMIN_ALGO_MNEMONIC)) {
    return;
  }

  try {
    adminAccount = algosdk.mnemonicToSecretKey(ADMIN_ALGO_MNEMONIC);
  } catch (error) {
    adminAccount = null;
    console.warn("Failed to parse ADMIN_ALGO_MNEMONIC:", error);
  }
}

function isMnemonicConfigured(mnemonic: string): boolean {
  if (!mnemonic) return false;
  if (mnemonic.includes("word1") && mnemonic.includes("word2")) return false;
  const words = mnemonic.split(/\s+/).filter(Boolean);
  return words.length >= 25;
}

function getAdminAddress(): string {
  if (!adminAccount) {
    throw new Error(
      "Algorand persistence is not configured. Set ADMIN_ALGO_MNEMONIC to a valid wallet mnemonic."
    );
  }

  const addr = (adminAccount as { addr: unknown }).addr;
  if (typeof addr === "string") return addr;
  if (addr && typeof (addr as { toString?: () => string }).toString === "function") {
    return (addr as { toString: () => string }).toString();
  }
  throw new Error("Unable to resolve Algorand admin address from mnemonic.");
}

function generateId(): string {
  return crypto.randomUUID();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function normalizeOwner(owner: string): string {
  return owner.trim().toUpperCase();
}

function cloneDb(db: Database): Database {
  return {
    projects: db.projects.map((project) => ({
      ...project,
      envVars: project.envVars.map((envVar) => ({ ...envVar })),
    })),
    deployments: db.deployments.map((deployment) => ({ ...deployment })),
  };
}

function sortDb(db: Database): void {
  db.projects.sort((a, b) => b.updatedAt - a.updatedAt);
  db.deployments.sort((a, b) => b.timestamp - a.timestamp);
}

function toStoredProject(project: Project): StoredProject {
  return {
    ...project,
    envVarKeys: project.envVars.map((envVar) => envVar.key).filter(Boolean),
  };
}

function fromStoredProject(stored: StoredProject): Project {
  return {
    ...stored,
    envVars: (stored.envVarKeys || []).map((key) => ({ key, value: "" })),
  };
}

function isChainEvent(value: unknown): value is ChainEvent {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ChainEvent> & { type?: unknown; v?: unknown };
  if (candidate.v !== 1 || typeof candidate.type !== "string") return false;

  if (candidate.type === "project_upsert") {
    return Boolean((candidate as { project?: unknown }).project);
  }

  if (candidate.type === "deployment_add") {
    return Boolean((candidate as { deployment?: unknown }).deployment);
  }

  if (candidate.type === "project_delete") {
    return typeof (candidate as { domain?: unknown }).domain === "string";
  }

  return false;
}

function applyEvent(db: Database, event: ChainEvent): void {
  const owner = normalizeOwner(event.wallet);

  if (event.type === "project_upsert") {
    const project = fromStoredProject(event.project);
    project.domain = normalizeDomain(project.domain);
    project.userId = owner;
    project.envVars = project.envVars.map((envVar) => ({ key: envVar.key, value: "" }));

    const existingIndex = db.projects.findIndex(
      (candidate) =>
        normalizeDomain(candidate.domain) === project.domain && normalizeOwner(candidate.userId) === owner
    );

    if (existingIndex === -1) {
      db.projects.push(project);
      return;
    }

    db.projects[existingIndex] = {
      ...db.projects[existingIndex],
      ...project,
      userId: owner,
      domain: project.domain,
    };
    return;
  }

  if (event.type === "deployment_add") {
    const deployment = {
      ...event.deployment,
      domain: normalizeDomain(event.deployment.domain),
      deployer: owner,
    };

    const existingIndex = db.deployments.findIndex((candidate) => candidate.id === deployment.id);
    if (existingIndex === -1) {
      db.deployments.push(deployment);
      return;
    }

    db.deployments[existingIndex] = deployment;
    return;
  }

  const domain = normalizeDomain(event.domain);
  const removedProjectIds = new Set(
    db.projects
      .filter(
        (project) => normalizeDomain(project.domain) === domain && normalizeOwner(project.userId) === owner
      )
      .map((project) => project.id)
  );

  db.projects = db.projects.filter(
    (project) => !(normalizeDomain(project.domain) === domain && normalizeOwner(project.userId) === owner)
  );

  db.deployments = db.deployments.filter(
    (deployment) =>
      !(
        normalizeDomain(deployment.domain) === domain &&
        normalizeOwner(deployment.deployer) === owner
      ) && !removedProjectIds.has(deployment.projectId)
  );
}

function trimEventToFitNote(event: ChainEvent): ChainEvent {
  if (event.type === "deployment_add") {
    const maxMetaLength = 220;
    if (event.deployment.meta.length > maxMetaLength) {
      return {
        ...event,
        deployment: {
          ...event.deployment,
          meta: `${event.deployment.meta.slice(0, maxMetaLength - 3)}...`,
        },
      };
    }
  }

  return event;
}

function encodeEvent(event: ChainEvent): Uint8Array {
  const payload = `${NOTE_PREFIX}${JSON.stringify(event)}`;
  return new TextEncoder().encode(payload);
}

function decodeTransactionNote(note: unknown): string | null {
  if (!note) return null;

  if (typeof note === "string") {
    return Buffer.from(note, "base64").toString("utf-8");
  }

  if (note instanceof Uint8Array) {
    return new TextDecoder().decode(note);
  }

  if (Array.isArray(note)) {
    return new TextDecoder().decode(Uint8Array.from(note));
  }

  return null;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

async function fetchChainEvents(): Promise<ChainEvent[]> {
  if (!adminAccount) {
    return [];
  }

  const events: ChainEvent[] = [];
  const adminAddress = getAdminAddress();
  const notePrefixBytes = new TextEncoder().encode(NOTE_PREFIX);

  let nextToken: string | undefined;

  do {
    let request: any = indexerClient
      .searchForTransactions()
      .address(adminAddress)
      .txType("pay")
      .limit(1000);

    if (typeof request.notePrefix === "function") {
      request = request.notePrefix(notePrefixBytes);
    }

    if (nextToken) {
      request = request.nextToken(nextToken);
    }

    const response = await request.do();
    const transactions = Array.isArray(response.transactions) ? response.transactions : [];

    for (const transaction of transactions) {
      const decoded = decodeTransactionNote(transaction.note);
      if (!decoded) continue;

      try {
        if (!decoded.startsWith(NOTE_PREFIX)) continue;

        const eventPayload = decoded.slice(NOTE_PREFIX.length);
        const parsed = JSON.parse(eventPayload) as unknown;

        if (isChainEvent(parsed)) {
          let event = parsed;
          if (
            event.type === "deployment_add" &&
            !(event.deployment as { txId?: string }).txId &&
            typeof (transaction as { id?: unknown }).id === "string"
          ) {
            event = {
              ...event,
              deployment: {
                ...event.deployment,
                txId: (transaction as { id: string }).id,
              },
            };
          }

          events.push(event);
        }
      } catch {
        // Ignore malformed notes.
      }
    }

    nextToken =
      typeof response["next-token"] === "string" && response["next-token"].length > 0
        ? response["next-token"]
        : undefined;
  } while (nextToken);

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

async function loadDb(force = false): Promise<Database> {
  const isCacheFresh = cachedAt > 0 && Date.now() - cachedAt < CACHE_TTL_MS;
  if (!force && isCacheFresh) {
    return cloneDb(cachedDb);
  }

  if (loadPromise && !force) {
    const db = await loadPromise;
    return cloneDb(db);
  }

  loadPromise = (async () => {
    const nextDb = cloneDb(EMPTY_DB);
    let events: ChainEvent[] = [];

    try {
      events = await fetchChainEvents();
    } catch (error) {
      const errorMessage = describeError(error);

      // Keep API reads available even if the indexer is temporarily unreachable.
      if (cachedAt > 0) {
        if (!indexerWarningShown) {
          console.warn(
            `Algorand indexer unreachable (${errorMessage}). Serving last known cache until connectivity recovers.`
          );
          indexerWarningShown = true;
        }
        return cloneDb(cachedDb);
      }

      if (!indexerWarningShown) {
        console.warn(
          `Algorand indexer unreachable (${errorMessage}). Using empty cache until connectivity recovers.`
        );
        indexerWarningShown = true;
      }

      cachedDb = cloneDb(EMPTY_DB);
      cachedAt = Date.now();
      return cloneDb(cachedDb);
    }

    indexerWarningShown = false;

    for (const event of events) {
      applyEvent(nextDb, event);
    }

    sortDb(nextDb);
    cachedDb = nextDb;
    cachedAt = Date.now();

    return cloneDb(nextDb);
  })();

  try {
    const db = await loadPromise;
    return cloneDb(db);
  } finally {
    loadPromise = null;
  }
}

async function appendEvent(event: ChainEvent): Promise<string> {
  if (!adminAccount) {
    throw new Error(
      "Algorand persistence is not configured. Set ADMIN_ALGO_MNEMONIC so project history can be written to chain."
    );
  }

  await loadDb();

  let normalizedEvent = trimEventToFitNote(event);
  let encoded = encodeEvent(normalizedEvent);

  if (encoded.length > MAX_NOTE_BYTES) {
    throw new Error(
      `Event payload is too large for Algorand note field (${encoded.length} bytes > ${MAX_NOTE_BYTES}).`
    );
  }

  const sender = getAdminAddress();
  const suggestedParams = await algodClient.getTransactionParams().do();

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: sender,
    amount: 0,
    note: encoded,
    suggestedParams,
  });

  const signedTxn = txn.signTxn(adminAccount.sk);
  const sendResult = await algodClient.sendRawTransaction(signedTxn).do();
  const txId =
    typeof (sendResult as { txId?: unknown }).txId === "string"
      ? (sendResult as { txId: string }).txId
      : txn.txID();

  if (event.type === "deployment_add") {
    normalizedEvent = {
      ...normalizedEvent,
      deployment: {
        ...normalizedEvent.deployment,
        txId,
      },
    };
  }

  applyEvent(cachedDb, normalizedEvent);
  sortDb(cachedDb);
  cachedAt = Date.now();
  return txId;
}

// Database bootstrap

export async function ensureDatabase(): Promise<void> {
  if (!adminAccount) {
    console.warn(
      "Algorand persistence is not configured. Data reads will return empty and writes will fail until ADMIN_ALGO_MNEMONIC is set."
    );
    return;
  }

  try {
    await loadDb(true);
    console.log(`Algorand storage connected via ${INDEXER_SERVER}`);
  } catch (error) {
    console.warn(`Failed to hydrate cache from Algorand indexer: ${describeError(error)}`);
  }
}

// Wallet helpers

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidWalletAddress(walletAddress: string): boolean {
  const normalized = walletAddress.trim();
  return algosdk.isValidAddress(normalized) || EVM_ADDRESS_REGEX.test(normalized);
}

// Project CRUD

export async function addProject(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
  const now = nowSeconds();
  const owner = normalizeOwner(data.userId);

  const project: Project = {
    ...data,
    id: generateId(),
    domain: normalizeDomain(data.domain),
    envVars: (data.envVars || []).map((envVar) => ({ key: envVar.key, value: "" })),
    createdAt: now,
    updatedAt: now,
    userId: owner,
  };

  await appendEvent({
    v: 1,
    type: "project_upsert",
    wallet: owner,
    timestamp: now,
    project: toStoredProject(project),
  });

  return project;
}

export async function getProjectById(id: string): Promise<Project | null> {
  const db = await loadDb();
  return db.projects.find((project) => project.id === id) ?? null;
}

export async function getProjectByDomain(domain: string, userId?: string): Promise<Project | null> {
  const db = await loadDb();
  const normalizedDomain = normalizeDomain(domain);

  if (userId) {
    const owner = normalizeOwner(userId);
    return (
      db.projects.find(
        (project) =>
          normalizeDomain(project.domain) === normalizedDomain && normalizeOwner(project.userId) === owner
      ) ?? null
    );
  }

  return db.projects.find((project) => normalizeDomain(project.domain) === normalizedDomain) ?? null;
}

export async function getProjectByRepo(repoFullName: string, userId: string): Promise<Project | null> {
  const db = await loadDb();
  const owner = normalizeOwner(userId);
  return (
    db.projects.find(
      (project) =>
        project.repoFullName === repoFullName && normalizeOwner(project.userId) === owner
    ) ?? null
  );
}

export async function listProjectsByUser(userId: string): Promise<Project[]> {
  const db = await loadDb();
  const owner = normalizeOwner(userId);
  return db.projects
    .filter((project) => normalizeOwner(project.userId) === owner)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateProject(
  id: string,
  data: Partial<Omit<Project, "id" | "createdAt">>
): Promise<Project | null> {
  const db = await loadDb();
  const existing = db.projects.find((project) => project.id === id);
  if (!existing) return null;

  const updatedAt = nowSeconds();
  const owner = normalizeOwner(data.userId || existing.userId);

  const project: Project = {
    ...existing,
    ...data,
    domain: normalizeDomain(data.domain || existing.domain),
    envVars: (data.envVars || existing.envVars || []).map((envVar) => ({ key: envVar.key, value: "" })),
    userId: owner,
    updatedAt,
  };

  await appendEvent({
    v: 1,
    type: "project_upsert",
    wallet: owner,
    timestamp: updatedAt,
    project: toStoredProject(project),
  });

  return project;
}

export async function upsertProject(
  domain: string,
  userId: string,
  data: Omit<Project, "id" | "createdAt" | "updatedAt" | "domain" | "userId">
): Promise<Project> {
  const existing = await getProjectByDomain(domain, userId);

  if (existing) {
    const updated = await updateProject(existing.id, data);
    if (updated) return updated;
  }

  return addProject({ ...data, domain, userId });
}

// Deployment CRUD

export async function addDeployment(data: Omit<Deployment, "id">): Promise<Deployment> {
  const owner = normalizeOwner(data.deployer);
  const deployment: Deployment = {
    ...data,
    id: generateId(),
    domain: normalizeDomain(data.domain),
    deployer: owner,
  };

  const txId = await appendEvent({
    v: 1,
    type: "deployment_add",
    wallet: owner,
    timestamp: deployment.timestamp || nowSeconds(),
    deployment,
  });

  deployment.txId = txId;

  return deployment;
}

export async function listDeploymentsByProject(projectId: string): Promise<Deployment[]> {
  const db = await loadDb();
  return db.deployments
    .filter((deployment) => deployment.projectId === projectId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function listDeploymentsByDomain(domain: string, userId?: string): Promise<Deployment[]> {
  const db = await loadDb();
  const normalizedDomain = normalizeDomain(domain);

  const filtered = db.deployments.filter(
    (deployment) => normalizeDomain(deployment.domain) === normalizedDomain
  );

  if (!userId) {
    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }

  const owner = normalizeOwner(userId);
  return filtered
    .filter((deployment) => normalizeOwner(deployment.deployer) === owner)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function getLatestDeployment(domain: string, userId?: string): Promise<Deployment | null> {
  const deployments = await listDeploymentsByDomain(domain, userId);
  return deployments[0] ?? null;
}

export async function listAllDomainsByUser(userId: string): Promise<string[]> {
  const projects = await listProjectsByUser(userId);
  return projects.map((project) => project.domain);
}

export async function removeProjectByDomainForUser(
  domain: string,
  userId: string
): Promise<RemoveProjectResult | null> {
  const normalizedDomain = normalizeDomain(domain);
  const owner = normalizeOwner(userId);

  const db = await loadDb();
  const project =
    db.projects.find(
      (candidate) =>
        normalizeDomain(candidate.domain) === normalizedDomain &&
        normalizeOwner(candidate.userId) === owner
    ) ?? null;

  if (!project) return null;

  const deployments = db.deployments
    .filter(
      (deployment) =>
        deployment.projectId === project.id ||
        (normalizeDomain(deployment.domain) === normalizedDomain &&
          normalizeOwner(deployment.deployer) === owner)
    )
    .sort((a, b) => b.timestamp - a.timestamp);

  await appendEvent({
    v: 1,
    type: "project_delete",
    wallet: owner,
    timestamp: nowSeconds(),
    domain: normalizedDomain,
  });

  return {
    project,
    deployments,
    cids: Array.from(new Set(deployments.map((deployment) => deployment.cid).filter(Boolean))),
  };
}

// Active deploy tracking (in-memory)

export function canStartDeploy(): boolean {
  return activeDeployState.active < activeDeployState.max;
}

export function incrementActiveDeploys(): void {
  activeDeployState.active += 1;
}

export function decrementActiveDeploys(): void {
  if (activeDeployState.active > 0) {
    activeDeployState.active -= 1;
  }
}

export function getActiveDeployCount(): number {
  return activeDeployState.active;
}

export function getMaxConcurrent(): number {
  return activeDeployState.max;
}

// Lookup helpers for webhook flow

export async function getProjectsByRepo(repoFullName: string): Promise<Project[]> {
  const db = await loadDb();
  return db.projects.filter((project) => project.repoFullName === repoFullName);
}

export async function listAllProjects(): Promise<Project[]> {
  const db = await loadDb();
  return db.projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

