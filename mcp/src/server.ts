#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Wallet } from "ethers";
import { z } from "zod";

const DEFAULT_API_BASE = process.env.W3DEPLOY_API_BASE || "http://localhost:8080";
const DEFAULT_WALLET_ADDRESS = process.env.W3DEPLOY_WALLET_ADDRESS || "";
const DEFAULT_JWT_TOKEN = process.env.W3DEPLOY_API_TOKEN || "";
const DEFAULT_EVM_PRIVATE_KEY = process.env.W3DEPLOY_EVM_PRIVATE_KEY || "";

const fileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => !value.includes(".."), "Path cannot include '..' segments."),
  content: z.string(),
});

const server = new McpServer({
  name: "w3deploy-mcp",
  version: "1.0.0",
});

type ChallengePayload = {
  challengeId: string;
  message: string;
};

type DeploymentHistoryItem = {
  cid: string;
  deployer: string;
  env: string;
  meta: string;
  timestamp: number;
  url: string;
  txId?: string | null;
  txExplorerUrl?: string | null;
};

function normalizePrivateKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

async function requestChallenge(
  baseUrl: string,
  resolvedJwtToken: string,
  resolvedWalletAddress: string
): Promise<ChallengePayload> {
  const challengeRes = await fetch(`${baseUrl}/api/mcp/challenge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedJwtToken}`,
      "X-Wallet-Address": resolvedWalletAddress,
    },
  });

  if (!challengeRes.ok) {
    const err = (await challengeRes.json().catch(() => ({ error: "Challenge request failed" }))) as {
      error?: string;
    };
    throw new Error(`Challenge request failed (${challengeRes.status}): ${err.error || "unknown error"}`);
  }

  const payload = (await challengeRes.json()) as Partial<ChallengePayload>;
  if (!payload.challengeId || !payload.message) {
    throw new Error("Challenge response missing challengeId/message.");
  }

  return {
    challengeId: payload.challengeId,
    message: payload.message,
  };
}

async function resolveChallengeAuth(
  baseUrl: string,
  resolvedJwtToken: string,
  resolvedWalletAddress: string,
  challengeId: string | undefined,
  challengeSignature: string | undefined,
  evmPrivateKey: string | undefined
): Promise<{ challengeId: string; challengeSignature: string }> {
  const explicitChallengeId = (challengeId || "").trim();
  const explicitChallengeSignature = (challengeSignature || "").trim();

  if (explicitChallengeId && explicitChallengeSignature) {
    return {
      challengeId: explicitChallengeId,
      challengeSignature: explicitChallengeSignature,
    };
  }

  const privateKey = normalizePrivateKey(evmPrivateKey || DEFAULT_EVM_PRIVATE_KEY);
  if (!privateKey) {
    throw new Error(
      "challengeId/challengeSignature are required unless W3DEPLOY_EVM_PRIVATE_KEY (or evmPrivateKey input) is set for auto-signing."
    );
  }

  const signer = new Wallet(privateKey);
  if (signer.address.toLowerCase() !== resolvedWalletAddress.toLowerCase()) {
    throw new Error(
      `Auto-sign wallet mismatch. Wallet header is ${resolvedWalletAddress}, but private key resolves to ${signer.address}.`
    );
  }

  const challenge = await requestChallenge(baseUrl, resolvedJwtToken, resolvedWalletAddress);
  const signature = await signer.signMessage(challenge.message);

  return {
    challengeId: challenge.challengeId,
    challengeSignature: signature,
  };
}

server.registerTool(
  "request_deploy_challenge",
  {
    title: "Request Deploy Challenge",
    description: "Requests a one-time challenge message to be signed by the user's wallet.",
    inputSchema: {
      apiBaseUrl: z
        .string()
        .url()
        .optional()
        .describe("W3DEPLOY backend base URL. Defaults to W3DEPLOY_API_BASE env or http://localhost:8080"),
      jwtToken: z
        .string()
        .optional()
        .describe("JWT from /api/auth (used as Authorization: Bearer <token>). Defaults to W3DEPLOY_API_TOKEN if omitted."),
      walletAddress: z
        .string()
        .optional()
        .describe("Current user wallet address. Defaults to W3DEPLOY_WALLET_ADDRESS if omitted."),
    },
  },
  async ({ apiBaseUrl, jwtToken, walletAddress }) => {
    const baseUrl = (apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
    const resolvedWalletAddress = (walletAddress || DEFAULT_WALLET_ADDRESS).trim();
    const resolvedJwtToken = (jwtToken || DEFAULT_JWT_TOKEN).trim();

    if (!resolvedWalletAddress) {
      throw new Error("walletAddress is required (or set W3DEPLOY_WALLET_ADDRESS in MCP env).");
    }
    if (!resolvedJwtToken) {
      throw new Error("jwtToken is required (or set W3DEPLOY_API_TOKEN in MCP env).");
    }

    const res = await fetch(`${baseUrl}/api/mcp/challenge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolvedJwtToken}`,
        "X-Wallet-Address": resolvedWalletAddress,
      },
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: "Challenge request failed" }))) as {
        error?: string;
      };
      throw new Error(`Challenge request failed (${res.status}): ${err.error || "unknown error"}`);
    }

    const payload = await res.json();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "deploy_code_to_ipfs",
  {
    title: "Deploy Code To IPFS",
    description:
      "Deploys agent-generated files directly through W3DEPLOY backend MCP and pins encrypted output to Pinata/IPFS.",
    inputSchema: {
      apiBaseUrl: z
        .string()
        .url()
        .optional()
        .describe("W3DEPLOY backend base URL. Defaults to W3DEPLOY_API_BASE env or http://localhost:8080"),
      jwtToken: z
        .string()
        .optional()
        .describe("JWT from /api/auth (used as Authorization: Bearer <token>). Defaults to W3DEPLOY_API_TOKEN if omitted."),
      walletAddress: z
        .string()
        .optional()
        .describe("Current user wallet address. Defaults to W3DEPLOY_WALLET_ADDRESS if omitted."),
      challengeId: z.string().optional().describe("Challenge ID returned by request_deploy_challenge."),
      challengeSignature: z.string().optional().describe("Wallet signature over the challenge message."),
      evmPrivateKey: z
        .string()
        .optional()
        .describe(
          "Optional EVM private key for automatic challenge signing. Defaults to W3DEPLOY_EVM_PRIVATE_KEY env if omitted."
        ),
      label: z
        .string()
        .min(1)
        .describe("Project label/domain prefix. Example: my-agent-preview"),
      files: z.array(fileSchema).min(1).max(1000),
      notes: z.string().optional().describe("Optional deployment notes saved in deployment metadata"),
      env: z.string().optional().describe("Optional deployment environment, default: production"),
      projectName: z.string().optional().describe("Optional project name used for deployment metadata."),
      appPreset: z.string().optional().describe("Optional app preset hint: static, react, next, etc."),
      rootDirectory: z.string().optional().describe("Optional root directory inside provided files."),
      installCommand: z.string().optional().describe("Optional install command override."),
      buildCommand: z.string().optional().describe("Optional build command override."),
      outputDirectory: z.string().optional().describe("Optional output directory override."),
      envVars: z
        .array(
          z.object({
            key: z.string(),
            value: z.string(),
          })
        )
        .optional()
        .describe("Optional environment variables to inject during build."),
    },
  },
  async ({
    apiBaseUrl,
    jwtToken,
    walletAddress,
    challengeId,
    challengeSignature,
    evmPrivateKey,
    label,
    files,
    notes,
    env,
    projectName,
    appPreset,
    rootDirectory,
    installCommand,
    buildCommand,
    outputDirectory,
    envVars,
  }) => {
    const baseUrl = (apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
    const resolvedWalletAddress = (walletAddress || DEFAULT_WALLET_ADDRESS).trim();
    const resolvedJwtToken = (jwtToken || DEFAULT_JWT_TOKEN).trim();

    if (!resolvedWalletAddress) {
      throw new Error("walletAddress is required (or set W3DEPLOY_WALLET_ADDRESS in MCP env).");
    }
    if (!resolvedJwtToken) {
      throw new Error("jwtToken is required (or set W3DEPLOY_API_TOKEN in MCP env).");
    }

    const resolvedChallenge = await resolveChallengeAuth(
      baseUrl,
      resolvedJwtToken,
      resolvedWalletAddress,
      challengeId,
      challengeSignature,
      evmPrivateKey
    );

    const res = await fetch(`${baseUrl}/api/mcp/deploy-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolvedJwtToken}`,
        "X-Wallet-Address": resolvedWalletAddress,
      },
      body: JSON.stringify({
        label,
        files,
        challengeId: resolvedChallenge.challengeId,
        challengeSignature: resolvedChallenge.challengeSignature,
        meta: {
          notes,
          env,
          projectName,
          appPreset,
          rootDirectory,
          installCommand,
          buildCommand,
          outputDirectory,
          envVars,
        },
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: "Deployment request failed" }))) as {
        error?: string;
      };
      throw new Error(`W3DEPLOY MCP deploy failed (${res.status}): ${err.error || "unknown error"}`);
    }

    const payload = (await res.json()) as {
      domain: string;
      cid: string;
      url: string;
      rawGatewayUrl?: string;
      files: number;
      txId?: string;
      txExplorerUrl?: string;
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              domain: payload.domain,
              cid: payload.cid,
              url: payload.url,
              rawGatewayUrl: payload.rawGatewayUrl,
              files: payload.files,
              txId: payload.txId,
              txExplorerUrl: payload.txExplorerUrl,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "get_deployment_history",
  {
    title: "Get Deployment History",
    description: "Fetches deployment history (including chain transaction IDs) for a project domain.",
    inputSchema: {
      apiBaseUrl: z
        .string()
        .url()
        .optional()
        .describe("W3DEPLOY backend base URL. Defaults to W3DEPLOY_API_BASE env or http://localhost:8080"),
      jwtToken: z
        .string()
        .optional()
        .describe("JWT from /api/auth (used as Authorization: Bearer <token>). Defaults to W3DEPLOY_API_TOKEN if omitted."),
      walletAddress: z
        .string()
        .optional()
        .describe("Current user wallet address. Defaults to W3DEPLOY_WALLET_ADDRESS if omitted."),
      domain: z.string().min(1).describe("Project domain/label to fetch history for."),
      limit: z.number().int().min(1).max(100).optional().describe("Max number of history rows to return. Default: 20"),
    },
  },
  async ({ apiBaseUrl, jwtToken, walletAddress, domain, limit }) => {
    const baseUrl = (apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
    const resolvedWalletAddress = (walletAddress || DEFAULT_WALLET_ADDRESS).trim();
    const resolvedJwtToken = (jwtToken || DEFAULT_JWT_TOKEN).trim();

    if (!resolvedWalletAddress) {
      throw new Error("walletAddress is required (or set W3DEPLOY_WALLET_ADDRESS in MCP env).");
    }
    if (!resolvedJwtToken) {
      throw new Error("jwtToken is required (or set W3DEPLOY_API_TOKEN in MCP env).");
    }

    const encodedDomain = encodeURIComponent(domain.trim());
    const res = await fetch(`${baseUrl}/api/sites/${encodedDomain}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolvedJwtToken}`,
        "X-Wallet-Address": resolvedWalletAddress,
      },
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: "History request failed" }))) as {
        error?: string;
      };
      throw new Error(`Deployment history request failed (${res.status}): ${err.error || "unknown error"}`);
    }

    const payload = (await res.json()) as {
      domain: string;
      count: number;
      latest: DeploymentHistoryItem | null;
      history: DeploymentHistoryItem[];
    };

    const maxRows = limit ?? 20;
    const history = (payload.history || []).slice(0, maxRows);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              domain: payload.domain,
              count: payload.count,
              latest: payload.latest,
              history,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "connect_w3deploy_mcp",
  {
    title: "Connect W3DEPLOY MCP",
    description: "Returns backend MCP connection metadata.",
    inputSchema: {
      apiBaseUrl: z.string().url().optional(),
      ide: z.string().default("agentic-ide"),
      workspace: z.string().default("unknown"),
    },
  },
  async ({ apiBaseUrl, ide, workspace }) => {
    const baseUrl = (apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/api/mcp/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ide, workspace }),
    });

    if (!res.ok) {
      throw new Error(`MCP connect failed with status ${res.status}`);
    }

    const payload = await res.json();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start w3deploy MCP server:", error);
  process.exit(1);
});
