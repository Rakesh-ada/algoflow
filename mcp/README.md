# W3DEPLOY MCP Server

This MCP server lets agentic IDEs deploy generated code directly to your W3DEPLOY backend, which encrypts and pins artifacts to Pinata/IPFS.

## Tools

- `connect_w3deploy_mcp`
  - Calls backend `POST /api/mcp/connect`
- `request_deploy_challenge`
  - Calls backend `POST /api/mcp/challenge`
  - Returns challenge message to sign in-wallet
- `deploy_code_to_ipfs`
  - Calls backend `POST /api/mcp/deploy-code`
  - Requires JWT, wallet address, challenge ID and wallet signature
- `get_deployment_history`
  - Calls backend `GET /api/sites/:domain`
  - Returns deployment history with chain tx IDs and explorer URLs

## Run (local development)

```bash
npm install
npm run build
npm run start
```

On Windows PowerShell where execution policy blocks npm scripts, run:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run start
```

## Global command setup

This package now exposes a CLI command: `w3deploy-mcp`.
It also includes an interactive deployment wizard: `w3deploy-cli`.

After publishing to npm (or installing from a git source), install globally:

```bash
npm i -g w3deploy-mcp
```

Run the guided deployment wizard:

```bash
w3deploy-cli
```

Wizard menu includes:

- setup credentials and API base
- MCP connect/health checks
- deploy folder to `/api/mcp/deploy-code`
- deployment history lookup from `/api/sites/:domain`
- Claude MCP config snippet generator

Local development:

```bash
npm run dev:cli
```

Then any MCP client can use:

```json
{
  "mcpServers": {
    "w3deploy": {
      "command": "w3deploy-mcp",
      "env": {
        "W3DEPLOY_API_BASE": "https://api.yourdomain.com",
        "W3DEPLOY_WALLET_ADDRESS": "YOUR_WALLET_ADDRESS",
        "W3DEPLOY_API_TOKEN": "YOUR_PRODUCTION_JWT"
      }
    }
  }
}
```

## Environment

- `W3DEPLOY_API_BASE` (optional, default `http://localhost:8080`)
- `W3DEPLOY_WALLET_ADDRESS` (recommended, current user Algorand wallet address)
- `W3DEPLOY_API_TOKEN` (recommended for authenticated MCP calls)
- `W3DEPLOY_EVM_PRIVATE_KEY` (optional, enables automatic challenge signing for EVM wallets)

## Example MCP client config (portable via npx)

```json
{
  "mcpServers": {
    "w3deploy": {
      "command": "npx",
      "args": ["-y", "w3deploy-mcp@latest"],
      "env": {
        "W3DEPLOY_API_BASE": "https://api.yourdomain.com",
        "W3DEPLOY_WALLET_ADDRESS": "YOUR_WALLET_ADDRESS",
        "W3DEPLOY_API_TOKEN": "YOUR_PRODUCTION_JWT"
      }
    }
  }
}
```

## Example MCP client config (local repository)

```json
{
  "mcpServers": {
    "w3deploy": {
      "command": "npm",
      "args": ["run", "start"],
      "cwd": "d:/project/w3deploy/mcp",
      "env": {
        "W3DEPLOY_API_BASE": "http://localhost:8080",
        "W3DEPLOY_WALLET_ADDRESS": "YOUR_WALLET_ADDRESS"
      }
    }
  }
}
```

## Signing flow

1. Call `request_deploy_challenge` with `jwtToken` and `walletAddress`.
2. Sign the returned `message` with the wallet app (no mnemonic sharing).
3. Call `deploy_code_to_ipfs` with:
   - `challengeId`
   - `challengeSignature`
   - deploy payload (`label`, `files`, etc.)

## deploy_code_to_ipfs input example

```json
{
  "jwtToken": "<jwt>",
  "walletAddress": "<wallet>",
  "challengeId": "<challenge id>",
  "challengeSignature": "<wallet signature>",
  "label": "my-agent-site",
  "files": [
    { "path": "index.html", "content": "<h1>Hello</h1>" },
    { "path": "styles.css", "content": "h1 { color: teal; }" }
  ],
  "notes": "Agent deploy",
  "env": "production",
  "projectName": "my-agent-site",
  "appPreset": "static",
  "rootDirectory": ".",
  "installCommand": "npm install --no-fund --no-audit",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "envVars": [
    { "key": "API_BASE", "value": "https://example.com" }
  ]
}
```

## get_deployment_history input example

```json
{
  "jwtToken": "<jwt>",
  "walletAddress": "<wallet>",
  "domain": "my-agent-site",
  "limit": 10
}
```
