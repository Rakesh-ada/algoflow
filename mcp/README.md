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

## Run

```bash
npm install
npm run start
```

On Windows PowerShell where execution policy blocks npm scripts, run:

```powershell
npm.cmd install
npm.cmd run start
```

## Environment

- `W3DEPLOY_API_BASE` (optional, default `http://localhost:8080`)
- `W3DEPLOY_WALLET_ADDRESS` (recommended, current user Algorand wallet address)

## Example MCP client config

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
  "env": "production"
}
```
