import { Hono, type Context } from "hono";
import fs from "fs/promises";
import path from "path";
import os from "os";
import * as tar from "tar";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { decryptBuffer } from "./crypto.js";
import { getLatestDeployment, getProjectByDomain } from "./db.js";

export const proxyRouter = new Hono();

const PINATA_GATEWAY = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
const CACHE_DIR = path.join(os.tmpdir(), "w3deploy-cache");

// Ensure cache dir exists
fs.mkdir(CACHE_DIR, { recursive: true }).catch(console.error);

// Extended MIME type map for static site serving
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function normalizeIdentifier(rawIdentifier: string): string {
  let decoded = rawIdentifier || "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep raw identifier when URL decoding fails.
  }
  return decoded.trim().replace(/^\/+|\/+$/g, "");
}

function isLikelyCid(identifier: string): boolean {
  // CIDv1 (common base32 form like "bafy...") or CIDv0 ("Qm...")
  return /^b[a-z2-7]{20,}$/i.test(identifier) || /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(identifier);
}

type DeploymentTarget =
  | { cid: string; status: 200 }
  | { error: string; status: 404 };

async function resolveDeploymentTarget(rawIdentifier: string): Promise<DeploymentTarget> {
  const identifier = normalizeIdentifier(rawIdentifier);
  if (!identifier) {
    return { error: "Missing deployment identifier", status: 404 };
  }

  // Preserve existing behavior for direct CID access.
  if (isLikelyCid(identifier)) {
    return { cid: identifier, status: 200 };
  }

  const latest = await getLatestDeployment(identifier);
  if (latest) {
    return { cid: latest.cid, status: 200 };
  }

  // If project exists but has no deployments yet, return 404 immediately.
  const project = await getProjectByDomain(identifier);
  if (project) {
    return { error: `No deployment found yet for project "${identifier}"`, status: 404 };
  }

  // Fallback: treat unknown identifier as CID for backward compatibility.
  return { cid: identifier, status: 200 };
}

async function ensureCacheForCid(cid: string, siteCachePath: string): Promise<void> {
  try {
    // Check if the site is already decrypted and cached on local SSD (HOT LOAD)
    await fs.stat(siteCachePath);
  } catch {
    // COLD START: Not cached. Fetch from Pinata, decrypt, untar to cache.
    await coldStartFetch(cid, siteCachePath);
  }
}

export async function serveDeploymentByIdentifier(
  c: Context,
  rawIdentifier: string,
  rawSubpath: string
): Promise<Response> {
  const target = await resolveDeploymentTarget(rawIdentifier);
  if ("error" in target) {
    return c.text(target.error, target.status);
  }

  const cid = target.cid;
  const subpath = normalizeRequestSubpath(rawSubpath);
  const siteCachePath = path.join(CACHE_DIR, cid);

  try {
    await ensureCacheForCid(cid, siteCachePath);
  } catch (error) {
    console.error(`[Cold Start Failed] ${cid}:`, error);
    return c.text(`Failed to load deployment: ${error instanceof Error ? error.message : String(error)}`, 502);
  }

  // STREAM HOT LOAD: Serve files from local SSD cache
  const reqFilePath = path.join(siteCachePath, subpath);

  // Prevent directory traversal
  const resolved = path.resolve(reqFilePath);
  if (!resolved.startsWith(path.resolve(siteCachePath))) {
    return c.text("Forbidden", 403);
  }

  try {
    const fileContent = await fs.readFile(reqFilePath);
    const contentType = getMimeType(reqFilePath);

    return c.body(fileContent, 200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Served-By": "w3deploy-cache",
    });
  } catch {
    // Try serving index.html for SPA routing
    if (!path.extname(subpath)) {
      try {
        const indexPath = path.join(siteCachePath, "index.html");
        const indexContent = await fs.readFile(indexPath);
        return c.body(indexContent, 200, {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=3600",
          "X-Served-By": "w3deploy-cache",
        });
      } catch {
        // Fall through
      }
    }
    return c.text("404 Not Found", 404);
  }
}

function normalizeRequestSubpath(rawSubpath: string): string {
  let decoded = rawSubpath || "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep raw path when URL decoding fails.
  }
  const trimmed = decoded.trim();

  if (!trimmed || trimmed === "/") {
    return "index.html";
  }

  // Keep the path relative to the deployment root.
  return trimmed.replace(/^\/+/, "");
}

/**
 * Download the encrypted blob from Pinata, decrypt it, and extract to cache.
 */
async function coldStartFetch(cid: string, cachePath: string): Promise<void> {
  console.log(`[Cold Start] Fetching encrypted deployment ${cid} from Pinata...`);

  // Download from Pinata gateway
  const gatewayUrl = `https://${PINATA_GATEWAY}/ipfs/${cid}`;
  const response = await fetch(gatewayUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch from Pinata gateway: HTTP ${response.status} ${response.statusText}`);
  }

  // Read entire body as buffer
  const encryptedArrayBuffer = await response.arrayBuffer();
  const encryptedBuffer = Buffer.from(encryptedArrayBuffer);

  console.log(`[Cold Start] Downloaded ${(encryptedBuffer.length / 1024).toFixed(1)} KB, decrypting...`);

  // Decrypt
  const decryptedBuffer = decryptBuffer(encryptedBuffer);
  console.log(`[Cold Start] Decrypted to ${(decryptedBuffer.length / 1024).toFixed(1)} KB, extracting...`);

  // Create cache directory
  await fs.mkdir(cachePath, { recursive: true });

  // Write decrypted tarball to temp file and extract
  const tempTar = path.join(cachePath, "__temp_site.tar.gz");
  await fs.writeFile(tempTar, decryptedBuffer);

  await tar.x({
    cwd: cachePath,
    file: tempTar,
  });

  // Clean up temp tarball
  await fs.rm(tempTar, { force: true }).catch(() => {});

  console.log(`[Cold Start Complete] Decrypted and extracted ${cid} to local SSD cache.`);
}

// The Cache-Accelerated Proxy Route
proxyRouter.get("/:cid/*", async (c) => {
  const identifier = c.req.param("cid");
  const rawPath = c.req.path;

  // Extract the subpath after /:cid/
  const cidPrefix = `/deployments/${identifier}`;
  const rawSubpath = rawPath.startsWith(cidPrefix) ? rawPath.slice(cidPrefix.length) : "";
  return serveDeploymentByIdentifier(c, identifier, rawSubpath);
});

// Force a trailing slash so relative assets resolve under /deployments/:cid/
proxyRouter.get("/:cid", async (c) => {
  return c.redirect(`${c.req.path}/`, 308);
});

export default proxyRouter;
