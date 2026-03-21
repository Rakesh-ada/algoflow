import { Hono } from "hono";
import { verify } from "hono/jwt";
import { PinataSDK } from "pinata-web3";
import {
  listProjectsByUser,
  getProjectByDomain,
  listDeploymentsByDomain,
  getLatestDeployment,
  getActiveDeployCount,
  getMaxConcurrent,
  removeProjectByDomainForUser,
  isValidWalletAddress,
  type Deployment,
} from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "w3deploy-super-secret-key-change-me";
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
const PINATA_JWT = process.env.PINATA_JWT || "";
const DIRECT_GATEWAY_BASE = (process.env.DIRECT_GATEWAY_BASE || `https://${PINATA_GATEWAY}/ipfs`).trim();
const ALGO_EXPLORER_TX_BASE = (
  process.env.ALGO_EXPLORER_TX_BASE || "https://testnet.explorer.perawallet.app/tx"
).trim();

export const sitesRouter = new Hono();

const pinata = new PinataSDK({
  pinataJwt: PINATA_JWT,
  pinataGateway: PINATA_GATEWAY,
});

function normalizeWalletAddress(value: string): string {
  return value.trim().toUpperCase();
}

function getWalletFromRequest(c: any): string | null {
  const wallet = c.req.header("x-wallet-address") || "";
  if (!wallet) return null;
  if (!isValidWalletAddress(wallet)) return null;
  return normalizeWalletAddress(wallet);
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function isPublicPinataGatewayUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "gateway.pinata.cloud";
  } catch {
    return false;
  }
}

function preferredGatewayBase(): string {
  const configured = stripTrailingSlashes(DIRECT_GATEWAY_BASE);
  if (configured && !isPublicPinataGatewayUrl(configured)) {
    return configured;
  }
  return "https://ipfs.io/ipfs";
}

function pinataGatewayUrl(cid: string): string {
  return `${preferredGatewayBase()}/${cid}/`;
}

function rewritePublicPinataUrl(value: string, fallbackCid: string): string {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^\/ipfs\/([^/]+)(\/.*)?$/i);
    const cid = match?.[1] || fallbackCid;
    const suffix = match?.[2] || "/";
    return `${preferredGatewayBase()}/${cid}${suffix}`;
  } catch {
    return pinataGatewayUrl(fallbackCid);
  }
}

function deploymentUrlForRecord(deployment: Deployment): string {
  const persisted = (deployment.url || "").trim();
  if (!persisted || persisted.includes("/deployments/")) {
    return pinataGatewayUrl(deployment.cid);
  }
  if (isPublicPinataGatewayUrl(persisted)) {
    return rewritePublicPinataUrl(persisted, deployment.cid);
  }
  return persisted;
}

function deploymentTxExplorerUrl(txId?: string): string | null {
  if (!txId) return null;
  const base = ALGO_EXPLORER_TX_BASE.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(txId)}`;
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

sitesRouter.get("/", authMiddleware, async (c) => {
  const wallet = getWalletFromRequest(c);
  if (!wallet) {
    return c.json({ error: "Connect your wallet to load projects." }, 400);
  }

  const projects = await listProjectsByUser(wallet);
  const domains = projects.map((project) => project.domain);
  return c.json({ domains });
});

sitesRouter.get("/:domain", authMiddleware, async (c) => {
  const wallet = getWalletFromRequest(c);
  if (!wallet) {
    return c.json({ error: "Connect your wallet to load projects." }, 400);
  }

  const domain = decodeURIComponent(c.req.param("domain"));
  const project = await getProjectByDomain(domain, wallet);

  if (!project) {
    return c.json({ domain, count: 0, latest: null, history: [] });
  }

  const deployments = await listDeploymentsByDomain(domain, wallet);
  const latest = deployments[0] ?? null;

  return c.json({
    domain,
    count: deployments.length,
    latest: latest
      ? {
          cid: latest.cid,
          deployer: latest.deployer,
          env: latest.env,
          meta: latest.meta,
          timestamp: latest.timestamp,
          url: deploymentUrlForRecord(latest),
          txId: latest.txId || null,
          txExplorerUrl: deploymentTxExplorerUrl(latest.txId),
        }
      : null,
    history: deployments.map((deployment) => ({
      cid: deployment.cid,
      deployer: deployment.deployer,
      env: deployment.env,
      meta: deployment.meta,
      timestamp: deployment.timestamp,
      url: deploymentUrlForRecord(deployment),
      txId: deployment.txId || null,
      txExplorerUrl: deploymentTxExplorerUrl(deployment.txId),
    })),
  });
});

sitesRouter.delete("/:domain", authMiddleware, async (c) => {
  const wallet = getWalletFromRequest(c);
  if (!wallet) {
    return c.json({ error: "Connect your wallet to manage projects." }, 400);
  }

  const domain = decodeURIComponent(c.req.param("domain"));
  const removed = await removeProjectByDomainForUser(domain, wallet);

  if (!removed) {
    return c.json({ error: "Project not found" }, 404);
  }

  const unpinErrors: string[] = [];

  if (removed.cids.length > 0) {
    if (!PINATA_JWT) {
      unpinErrors.push(...removed.cids);
    } else {
      try {
        const unpinned = await pinata.unpin(removed.cids);
        const failed = unpinned
          .filter((item) => item.status !== "success")
          .map((item) => item.hash);
        unpinErrors.push(...failed);
      } catch {
        unpinErrors.push(...removed.cids);
      }
    }
  }

  return c.json({
    ok: true,
    domain,
    deletedDeployments: removed.deployments.length,
    unpinned: removed.cids.length - unpinErrors.length,
    unpinErrors,
  });
});

sitesRouter.get("/:domain/ipns", authMiddleware, async (c) => {
  const wallet = getWalletFromRequest(c);
  if (!wallet) {
    return c.json({ error: "Connect your wallet to load project metadata." }, 400);
  }

  const domain = decodeURIComponent(c.req.param("domain"));
  const project = await getProjectByDomain(domain, wallet);
  const latest = await getLatestDeployment(domain, wallet);

  if (!project || !latest) {
    return c.json({ error: "No deployments found for this domain" }, 404);
  }

  const siteUrl = deploymentUrlForRecord(latest);
  const gatewayUrl = pinataGatewayUrl(latest.cid);
  const deployments = await listDeploymentsByDomain(domain, wallet);

  return c.json({
    domain,
    ipnsKey: `k51-${project.id.slice(0, 20)}`,
    latestCid: latest.cid,
    latestSeq: deployments.length,
    registeredAt: project.createdAt,
    updatedAt: latest.timestamp,
    active: true,
    gateways: Array.from(new Set([siteUrl, gatewayUrl])),
    url: siteUrl,
  });
});

export function deployStatusHandler(c: any) {
  return c.json({
    active: getActiveDeployCount(),
    max: getMaxConcurrent(),
  });
}
