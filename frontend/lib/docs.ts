export type DocsCodeBlock = {
  label?: string;
  language: string;
  code: string;
};

export type DocsSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: string[];
  codeBlocks?: DocsCodeBlock[];
  callout?: string;
};

export type DocsPage = {
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  sections: DocsSection[];
};

export const docsPages: DocsPage[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    description:
      "Set up ALGOFLOW locally, connect your wallet, and ship your first static dApp deployment to IPFS.",
    updatedAt: "2026-03-22",
    sections: [
      {
        id: "requirements",
        title: "Requirements",
        bullets: [
          "Node.js 20+ and npm installed on your machine.",
          "A wallet such as MetaMask for transaction signing.",
          "A running ALGOFLOW backend API (local or hosted).",
          "A valid JWT token from your ALGOFLOW auth flow.",
        ],
      },
      {
        id: "local-setup",
        title: "Local Setup",
        steps: [
          "Clone the repository and install dependencies.",
          "Start backend services and verify the API is reachable.",
          "Run frontend in development mode and sign in.",
          "Open Deploy page and complete your first upload.",
        ],
        codeBlocks: [
          {
            label: "Install dependencies",
            language: "bash",
            code: "cd frontend\nnpm install\n\ncd ../backend\nnpm install",
          },
          {
            label: "Run frontend",
            language: "bash",
            code: "cd frontend\nnpm run dev",
          },
        ],
      },
      {
        id: "first-deploy",
        title: "Your First Deployment",
        paragraphs: [
          "Use the Deploy page to select a repository, define build commands, and push artifacts to IPFS.",
          "ALGOFLOW stores immutable deployment metadata so you can inspect every release in project history.",
        ],
        bullets: [
          "Project name becomes the deployment label/domain key.",
          "Root directory controls where build commands run.",
          "Output directory is uploaded and pinned to IPFS.",
          "Deployment logs show build, upload, and chain status.",
        ],
      },
    ],
  },
  {
    slug: "architecture",
    title: "Architecture",
    description:
      "Understand how frontend assets, smart contracts, RPC providers, and indexing services fit together.",
    updatedAt: "2026-03-22",
    sections: [
      {
        id: "frontend-storage",
        title: "Frontend Storage Layer",
        paragraphs: [
          "ALGOFLOW deploys static HTML/CSS/JS assets to IPFS using content addressing (CID).",
          "For production durability, keep content pinned on at least one reliable pinning provider.",
        ],
        bullets: [
          "IPFS is decentralized content distribution.",
          "CID changes whenever file content changes.",
          "Gateway URLs are easy to share but not ownership by themselves.",
        ],
      },
      {
        id: "contract-layer",
        title: "Smart Contract Layer",
        paragraphs: [
          "Business logic lives on-chain in deployed contracts. Frontend clients interact through ABI + address.",
          "Contract state is persisted in blockchain storage and transaction writes require gas.",
        ],
        bullets: [
          "Bytecode is immutable at a contract address.",
          "Upgradeable systems use proxy patterns.",
          "ABI definitions are required for typed contract calls.",
        ],
      },
      {
        id: "api-layer",
        title: "API Layer",
        paragraphs: [
          "Your frontend interacts with blockchain nodes through JSON-RPC providers such as MetaMask, Alchemy, or Infura.",
          "Indexing APIs are optional but useful for fast history queries and analytics views.",
        ],
        codeBlocks: [
          {
            label: "High-level request flow",
            language: "text",
            code: "Browser -> Static Site (IPFS)\nBrowser -> RPC Provider -> Blockchain\nBrowser -> Optional Indexer API",
          },
        ],
      },
    ],
  },
  {
    slug: "mcp-setup",
    title: "MCP Setup",
    description:
      "Configure Claude Desktop or other MCP clients to call ALGOFLOW deployment tools from your coding assistant.",
    updatedAt: "2026-03-22",
    sections: [
      {
        id: "client-config",
        title: "Client Configuration",
        paragraphs: [
          "ALGOFLOW exposes MCP tools for challenge signing, deployment, and deployment history retrieval.",
          "Use one shared MCP profile per machine and keep secret values only in local config.",
        ],
        codeBlocks: [
          {
            label: "Claude Desktop MCP config",
            language: "json",
            code: `{
  "preferences": {
    "coworkWebSearchEnabled": true,
    "coworkScheduledTasksEnabled": false,
    "ccdScheduledTasksEnabled": false
  },
  "mcpServers": {
    "w3deploy": {
      "command": "w3deploy-mcp",
      "env": {
        "W3DEPLOY_API_BASE": "https://api.yourdomain.com",
        "W3DEPLOY_WALLET_ADDRESS": "<YOUR_WALLET_ADDRESS>",
        "W3DEPLOY_API_TOKEN": "<YOUR_PRODUCTION_JWT>",
        "W3DEPLOY_EVM_PRIVATE_KEY": "<YOUR_PRIVATE_KEY_IF_AUTOSIGN>"
      }
    }
  }
}`,
          },
        ],
      },
      {
        id: "tooling",
        title: "Available Tools",
        bullets: [
          "connect_w3deploy_mcp: validates backend connectivity.",
          "request_deploy_challenge: returns message to sign.",
          "deploy_code_to_ipfs: uploads files and creates deployment.",
          "get_deployment_history: returns latest and historical releases.",
        ],
      },
      {
        id: "best-practices",
        title: "Best Practices",
        bullets: [
          "Use production API URL, not localhost, for shared environments.",
          "Rotate API tokens regularly and scope by user/workspace.",
          "Never commit private keys to repository files.",
          "Prefer challenge signing over long-lived signing keys when possible.",
        ],
      },
    ],
  },
  {
    slug: "deploying-static-dapps",
    title: "Deploying Static dApps",
    description:
      "Structure static dApp projects for predictable builds, easy IPFS publishing, and reproducible releases.",
    updatedAt: "2026-03-22",
    sections: [
      {
        id: "project-shape",
        title: "Recommended Project Structure",
        codeBlocks: [
          {
            language: "text",
            code: `my-dapp/
  index.html
  app.js
  styles.css
  assets/
    logo.svg`,
          },
        ],
        paragraphs: [
          "Keep output deterministic so every deployment can be traced by commit + CID.",
        ],
      },
      {
        id: "deployment-inputs",
        title: "Deployment Inputs",
        bullets: [
          "Label/domain key for project identity.",
          "Build command and output directory for generated assets.",
          "Optional environment variables for compile-time config.",
          "Root directory when deploying from a monorepo.",
        ],
      },
      {
        id: "versioning",
        title: "Release Versioning",
        paragraphs: [
          "Each deployment produces a new CID and appears in deployment history.",
          "Use notes and commit references in metadata for quick rollback analysis.",
        ],
        callout:
          "Tip: Pin production builds in two places (primary pinning provider + backup node) for stronger availability.",
      },
    ],
  },
  {
    slug: "wallet-and-contracts",
    title: "Wallet and Contracts",
    description:
      "Implement MetaMask connect, network checks, and multi-contract interaction from static frontend code.",
    updatedAt: "2026-03-22",
    sections: [
      {
        id: "connect-wallet",
        title: "Connect Wallet",
        paragraphs: [
          "Use browser-injected provider (window.ethereum) and request account access on user action.",
          "Always validate chainId before contract calls to avoid sending transactions on wrong network.",
        ],
        codeBlocks: [
          {
            language: "javascript",
            code: `import { BrowserProvider } from "ethers";

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask is not installed");
  }

  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();

  return {
    address: await signer.getAddress(),
    chainId: Number(network.chainId),
    provider,
    signer,
  };
}`,
          },
        ],
      },
      {
        id: "multiple-contracts",
        title: "Multiple Contracts by Chain",
        codeBlocks: [
          {
            language: "javascript",
            code: `export const CONTRACTS = {
  11155111: {
    token: "0xTokenAddressOnSepolia",
    app: "0xAppAddressOnSepolia"
  },
  137: {
    token: "0xTokenAddressOnPolygon",
    app: "0xAppAddressOnPolygon"
  }
};`,
          },
        ],
        bullets: [
          "Keep ABI files versioned in source control.",
          "Resolve addresses dynamically from active chainId.",
          "Show clear UI errors for unsupported networks.",
        ],
      },
      {
        id: "transaction-ux",
        title: "Transaction UX",
        bullets: [
          "Show pending state immediately after wallet confirmation.",
          "Display transaction hash and explorer URL.",
          "Handle reject/cancel and RPC errors separately.",
          "Confirm mined transaction before optimistic UI finalization.",
        ],
      },
    ],
  },
  {
    slug: "security-and-ops",
    title: "Security and Operations",
    description:
      "Protect secrets, keep deployments reliable, and troubleshoot common Web3 deployment and wallet issues.",
    updatedAt: "2026-03-22",
    sections: [
      {
        id: "secrets",
        title: "Secrets Handling",
        bullets: [
          "Never store private keys in frontend code.",
          "Do not commit JWT tokens or sensitive env files.",
          "Use per-user tokens and short expiration windows.",
          "Prefer challenge-sign flow over reusable wallet secrets.",
        ],
      },
      {
        id: "reliability",
        title: "Reliability Checklist",
        steps: [
          "Verify build command and output directory before deploy.",
          "Pin the resulting CID in at least one persistent pinning service.",
          "Track deploy metadata (commit, notes, txId, environment).",
          "Continuously monitor gateway and RPC provider health.",
        ],
      },
      {
        id: "troubleshooting",
        title: "Troubleshooting",
        bullets: [
          "Wallet connection fails: confirm browser wallet extension is unlocked.",
          "Wrong network: prompt user to switch chain before sending tx.",
          "Deploy build fails: inspect logs and rerun locally with same commands.",
          "CID inaccessible: verify pin status and test alternate IPFS gateways.",
          "MCP auth errors: refresh JWT and ensure wallet address header matches user.",
        ],
      },
    ],
  },
];

export function getDocsPage(slug: string): DocsPage | undefined {
  return docsPages.find((page) => page.slug === slug);
}

