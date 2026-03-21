import crypto from "crypto";
import { Hono } from "hono";
import { verify } from "hono/jwt";
import {
  upsertProject,
  getProjectsByRepo,
  listProjectsByUser,
  listDeploymentsByDomain,
  listAllProjects,
  updateProject,
  isValidWalletAddress,
  type Project,
} from "./db.js";
import { triggerDeploy } from "./deploy.js";

export const githubRouter = new Hono();

const JWT_SECRET = process.env.JWT_SECRET || "w3deploy-super-secret-key-change-me";
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const BACKEND_URL = process.env.BACKEND_URL || "";
const WEBHOOK_SIGNATURE_PREFIX = "sha256=";

function normalizeWalletAddress(value: string): string {
  return value.trim().toUpperCase();
}

function getWalletFromRequest(c: any): string | null {
  const wallet = c.req.header("x-wallet-address") || "";
  if (!wallet) return null;
  if (!isValidWalletAddress(wallet)) return null;
  return normalizeWalletAddress(wallet);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function verifyWebhookSignature(rawBody: string, signatureHeader?: string | null): boolean {
  if (!WEBHOOK_SECRET) {
    return true;
  }

  const signature = (signatureHeader || "").trim();
  if (!signature.startsWith(WEBHOOK_SIGNATURE_PREFIX)) {
    return false;
  }

  const receivedDigest = signature.slice(WEBHOOK_SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/i.test(receivedDigest)) {
    return false;
  }

  const expectedDigest = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedDigest.toLowerCase(), "hex"),
      Buffer.from(expectedDigest.toLowerCase(), "hex")
    );
  } catch {
    return false;
  }
}

// ── Auth Middleware ──────────────────────────────────────────────────────────

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

// ── GET /repos — Fetch user repositories from GitHub ─────────────────────────

githubRouter.get("/repos", authMiddleware, async (c) => {
  const user = c.get("jwtPayload") as any;
  const wallet = getWalletFromRequest(c);
  try {
    const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", {
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        "User-Agent": "W3DEPLOY",
        Accept: "application/vnd.github.v3+json",
      },
    });
    const data = await res.json();

    if (!Array.isArray(data)) {
      return c.json({ repos: [] });
    }

    // Get user's connected projects to mark them
    const userProjects = wallet ? await listProjectsByUser(wallet) : [];
    const connectedRepos = new Set(userProjects.map((p) => p.repoFullName));

    const repos = data.map((r: any) => ({
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      description: r.description,
      defaultBranch: r.default_branch,
      htmlUrl: r.html_url,
      connected: connectedRepos.has(r.full_name),
    }));
    return c.json({ repos });
  } catch {
    return c.json({ error: "Failed to fetch repositories" }, 500);
  }
});

// ── GET /repos/:owner/:repo/branches — Fetch branches ────────────────────────

githubRouter.get("/repos/:owner/:repo/branches", authMiddleware, async (c) => {
  const user = c.get("jwtPayload") as any;
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, {
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        "User-Agent": "W3DEPLOY",
        Accept: "application/vnd.github.v3+json",
      },
    });
    const data = await res.json();

    if (!Array.isArray(data)) {
      return c.json({ branches: ["main"] });
    }

    const branches = data.map((b: any) => b.name);
    return c.json({ branches });
  } catch {
    return c.json({ branches: ["main"] });
  }
});

// ── POST /connect — Connect a repo and optionally setup webhook ──────────────

githubRouter.post("/connect", authMiddleware, async (c) => {
  const user = c.get("jwtPayload") as any;
  const wallet = getWalletFromRequest(c);
  if (!wallet) {
    return c.json({ error: "Connect your wallet before linking repositories." }, 400);
  }

  const body = await c.req.json();

  const repoFullName = body.repoFullName || "";
  const branch = body.branch || "main";
  const domain = body.domain || repoFullName.split("/")[1] || "default";
  const domainMode = body.domainMode || "auto";

  // Save to database
  const project = await upsertProject(domain, wallet, {
    repoFullName,
    branch,
    rootDirectory: body.rootDirectory || "./",
    buildCommand: body.buildCommand || "npm run build",
    installCommand: body.installCommand || "npm install",
    outputDirectory: body.outputDirectory || "",
    appPreset: body.appPreset || "auto",
    envVars: body.envVars || [],
    env: body.env || "production",
    webhookId: null,
  });

  // Try to create a real GitHub webhook if a public backend URL is configured
  let webhookId: number | null = null;

  if (BACKEND_URL && user.accessToken) {
    try {
      const webhookUrl = `${BACKEND_URL}/api/github/webhook`;
      const [owner, repo] = repoFullName.split("/");

      const webhookRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          "User-Agent": "W3DEPLOY",
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push"],
          config: {
            url: webhookUrl,
            content_type: "json",
            secret: WEBHOOK_SECRET || undefined,
            insecure_ssl: "0",
          },
        }),
      });

      if (webhookRes.ok) {
        const hookData = await webhookRes.json();
        webhookId = hookData.id;
        console.log(`✓ GitHub webhook created for ${repoFullName} (ID: ${webhookId})`);
      } else {
        const errData = await webhookRes.json().catch(() => ({}));
        console.warn(`⚠ Failed to create webhook for ${repoFullName}:`, errData);
      }
    } catch (err) {
      console.warn(`⚠ Webhook creation failed for ${repoFullName}:`, err);
    }
  } else {
    console.log(`ℹ No BACKEND_URL configured — skipping webhook creation for ${repoFullName}. Polling mode active.`);
  }

  // Update webhook ID if we managed to create one
  if (webhookId) {
    await updateProject(project.id, { webhookId });
  }

  return c.json({
    ok: true,
    key: project.id,
    webhookId,
    message: webhookId
      ? "Repository connected with auto-deploy webhook!"
      : "Repository connected! Set BACKEND_URL for auto-deploy webhooks.",
    domain,
    domainMode,
  });
});

// ── GET /connected — List connected repos for user ───────────────────────────

githubRouter.get("/connected", authMiddleware, async (c) => {
  const wallet = getWalletFromRequest(c);
  if (!wallet) {
    return c.json({ repos: [] });
  }

  const projects = await listProjectsByUser(wallet);

  const repos = await Promise.all(
    projects.map(async (p) => {
    const [owner, repo] = p.repoFullName.split("/");
    const deployments = await listDeploymentsByDomain(p.domain, wallet);

    return {
      repoFullName: p.repoFullName,
      owner: owner || "",
      repo: repo || "",
      branch: p.branch,
      domain: p.domain,
      domainMode: "auto" as const,
      ipnsKey: null,
      env: p.env,
      webhookId: p.webhookId,
      connectedBy: wallet,
      recentDeploys: deployments.slice(0, 5).map((d) => ({
        cid: d.cid,
        deployer: d.deployer,
        env: d.env,
        meta: d.meta,
        timestamp: d.timestamp,
        url: d.url,
      })),
    };
    })
  );

  return c.json({ repos });
});

// ── POST /webhook — GitHub webhook receiver ──────────────────────────────────

githubRouter.post("/webhook", async (c) => {
  const event = c.req.header("x-github-event") || "";
  const rawBody = await c.req.text();

  if (!verifyWebhookSignature(rawBody, c.req.header("x-hub-signature-256"))) {
    console.warn("⚠ GitHub webhook rejected due to invalid signature.");
    return c.json({ accepted: false, error: "Invalid webhook signature" }, 401);
  }

  let payload: any = {};
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ accepted: false, error: "Invalid JSON payload" }, 400);
    }
  }

  if (event === "push") {
    const repoFullName = payload.repository?.full_name;
    const branch = payload.ref?.replace("refs/heads/", "");
    const commitHash = payload.head_commit?.id;
    const commitMessage = payload.head_commit?.message;

    if (!repoFullName || !branch) {
      return c.json({ accepted: false, error: "Missing repository or branch info" }, 400);
    }

    console.log(`\n🔔 GitHub Push: ${repoFullName} @ ${branch}`);
    console.log(`   Commit: ${commitHash?.slice(0, 8)} — ${commitMessage}`);

    // Look up all projects connected to this repo
    const projects = await getProjectsByRepo(repoFullName);

    if (projects.length === 0) {
      console.log(`   ⚠ No projects found for ${repoFullName}`);
      return c.json({ accepted: true, message: "No projects connected to this repo." });
    }

    // Trigger deploy for each matching project
    for (const project of projects) {
      // Only deploy if the push is to the project's configured branch
      if (project.branch && project.branch !== branch) {
        console.log(`   ⏭ Skipping ${project.domain} (configured for branch ${project.branch}, push was to ${branch})`);
        continue;
      }

      console.log(`   🚀 Auto-deploying: ${project.domain}`);

      const repoUrl = `https://github.com/${repoFullName}.git`;

      // Fire and forget — deploy in background
      triggerDeploy(
        repoUrl,
        project.domain,
        project.userId,
        {
          rootDirectory: project.rootDirectory,
          buildCommand: project.buildCommand,
          installCommand: project.installCommand,
          outputDirectory: project.outputDirectory,
          appPreset: project.appPreset,
          envVars: project.envVars,
          env: project.env,
        },
        branch,
        (line) => console.log(`   [${project.domain}] ${line}`)
      ).then((result) => {
        if (result) {
          console.log(`   ✓ ${project.domain} deployed: CID=${result.cid}`);
        }
      }).catch((error) => {
        console.error(`   Auto-deploy failed for ${project.domain}: ${getErrorMessage(error)}`);
      });
    }

    return c.json({ accepted: true, message: "Push received. Deployment(s) triggered." });
  }

  if (event === "ping") {
    console.log("🏓 GitHub webhook ping received");
    return c.json({ accepted: true, message: "Pong!" });
  }

  return c.json({ accepted: true, event });
});

// ── Polling fallback for local dev ───────────────────────────────────────────
// When no BACKEND_URL is configured, we poll GitHub for new commits.

interface PollState {
  lastCheckedSha: string;
}

const pollStates = new Map<string, PollState>();
let pollIntervalId: ReturnType<typeof setInterval> | null = null;

async function pollForChanges() {
  // Poll GitHub for new commits on connected repos (public API, no auth needed for public repos)
  const projects: Project[] = await listAllProjects();
  if (projects.length === 0) return;

  for (const project of projects) {
    const repoFullName = project.repoFullName;
    if (!repoFullName) continue;

    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/commits?sha=${project.branch || "main"}&per_page=1`,
        {
          headers: {
            "User-Agent": "W3DEPLOY-Poller",
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (!res.ok) continue;

      const commits = await res.json();
      if (!Array.isArray(commits) || commits.length === 0) continue;

      const latestSha = commits[0].sha;
      const state = pollStates.get(project.id);

      if (!state) {
        // First check — just record the current SHA
        pollStates.set(project.id, { lastCheckedSha: latestSha });
        continue;
      }

      if (state.lastCheckedSha === latestSha) {
        continue; // No new commits
      }

      // New commit detected!
      console.log(`\n🔄 [Poller] New commit on ${repoFullName}: ${latestSha.slice(0, 8)}`);
      console.log(`   Previous: ${state.lastCheckedSha.slice(0, 8)}`);
      pollStates.set(project.id, { lastCheckedSha: latestSha });

      // Trigger deploy
      const repoUrl = `https://github.com/${repoFullName}.git`;
      triggerDeploy(
        repoUrl,
        project.domain,
        project.userId,
        {
          rootDirectory: project.rootDirectory,
          buildCommand: project.buildCommand,
          installCommand: project.installCommand,
          outputDirectory: project.outputDirectory,
          appPreset: project.appPreset,
          envVars: project.envVars,
          env: project.env,
        },
        project.branch || "main",
        (line) => console.log(`   [Poller:${project.domain}] ${line}`)
      ).then((result) => {
        if (result) {
          console.log(`   ✓ [Poller] ${project.domain} auto-deployed: CID=${result.cid}`);
        }
      }).catch((error) => {
        console.error(`   [Poller] Auto-deploy failed for ${project.domain}: ${getErrorMessage(error)}`);
      });
    } catch (err) {
      // Silently skip — don't spam logs with rate limit errors
    }
  }
}

/**
 * Start the polling fallback for auto-deploy.
 * Checks every 60 seconds for new commits on connected repos.
 */
export function startPolling(intervalMs = 60_000) {
  if (pollIntervalId) return; // Already running

  if (BACKEND_URL) {
    console.log("ℹ BACKEND_URL is configured — using webhooks for auto-deploy, polling disabled.");
    return;
  }

  console.log(`🔄 Starting GitHub polling (every ${intervalMs / 1000}s) for auto-deploy...`);
  pollIntervalId = setInterval(pollForChanges, intervalMs);
}
