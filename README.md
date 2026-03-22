
# Algoflow
AI-assisted decentralized deployment platform for static apps and frontend builds, with wallet-linked ownership, IPFS publishing, and Algorand-backed deployment records.

## Overview
W3Deploy helps developers ship frontend projects from GitHub or MCP-driven agent workflows to IPFS with minimal setup. It combines practical AI automation (repo stack classification), reliable build/deploy pipelines, and verifiable blockchain-linked deployment history.

This is not only an AI demo. It is a production-style full workflow:
1. Detect stack
2. Build safely
3. Publish to IPFS
4. Store project and deployment metadata
5. Attach on-chain transaction references

## Problem We Solve
Frontend and dApp deployment to decentralized storage is often error-prone:
1. Wrong root directory selection in mono-repos
2. Wrong output directory assumptions between frameworks
3. Broken asset paths after IPFS upload
4. Weak ownership verification for agent-triggered deploys
5. No trusted audit trail for deployment history

algoflow addresses each of these with AI-assisted defaults, deterministic deployment steps, wallet challenge verification, and blockchain persistence.

## Core Use Cases
1. One-click GitHub deployment for React, Vite, Next static output, and plain HTML sites.
2. Vibe coding and agentic IDE deployment through MCP without leaving the coding environment.
3. Team/internal tools where deploy ownership must be linked to a wallet identity.
4. Hackathon dApps that need fast iteration and public, verifiable deployment history.

## Applied Hackathon Tracks
1. Smolify AI Track
2. Algorand / Web3 Infrastructure Track
3. Developer Tools / Productivity Track
4. Open Innovation Track

## How Smolify AI Is Used
algoflow applies Smolify in a practical deployment decision step, not only for content generation:
1. Repository top-level structure is analyzed.
2. Smolify classifier predicts project tech stack (React vs HTML/static).
3. The deploy flow auto-suggests root directory, build command, and output directory defaults.
4. Fallback heuristics maintain reliability if model response is unavailable.

Implementation reference:
github.ts

This directly reduces failed deployments due to misconfiguration and improves first-time success rate.

## How Algorand Is Used
Algorand is used as a persistence and trust layer for deployment/project events:
1. Project updates and deployment events are encoded as chain events.
2. Events are pushed with an admin account to Algorand-compatible infrastructure.
3. Deployment records can include transaction IDs and explorer links.
4. The app reconstructs state from chain/event data where applicable.

Implementation reference:
db.ts

This gives a stronger audit trail than local-only state and supports verifiable history for users and judges.

## MCP Agent + Vibe Coding Flow
algoflow includes an MCP server so coding agents can deploy generated code directly:
1. Agent connects to MCP endpoint.
2. User requests deploy challenge.
3. User signs challenge with wallet.
4. Agent submits signed payload and files.
5. Backend builds (if needed), publishes to IPFS, records deployment.

Implementation references:
README.md
mcp.ts

This is ideal for vibe coding workflows where an agent generates, iterates, and ships quickly.

## IPFS Deployment Design
algoflow performs framework-aware packaging and publishing:
1. Detect project type and build output
2. Gather output files
3. Rewrite problematic root-absolute asset links where needed
4. Upload artifacts to IPFS
5. Return canonical gateway URL and CID

Implementation reference:
deploy.ts

Recent reliability improvements include root-level CID publishing and safer asset-path handling to avoid blank-page outcomes.

## Architecture
1. Frontend: Next.js app for auth, repository selection, deploy controls, and deployment history.
2. Backend: Hono API for auth, GitHub integration, build/deploy orchestration, MCP APIs, and sites/history APIs.
3. Storage/Distribution: Pinata + IPFS gateways.
4. Trust Layer: Algorand event persistence and tx references.
5. AI Layer: Smolify classifier for repo stack detection and deploy defaults.

Entry references:
page.tsx
index.ts

## Security Model
1. JWT-based API auth
2. Wallet address validation for project/deploy actions
3. Challenge-signature verification for MCP deploy authorization
4. Public-env filtering for static output safety
5. Optional webhook signature verification for GitHub events

References:
mcp.ts
github.ts
deploy.ts

## Key APIs
1. Auth APIs for login/session
2. GitHub APIs for repo listing, branch listing, stack classification, and repo connection
3. Deploy stream API for live logs + result
4. MCP APIs for connect, challenge, and deploy-code
5. Sites APIs for deployment history and latest status

Router registration:
index.ts

## Why This Project Is Strong for Smolify Hackathon
1. AI is integrated into a measurable product outcome: better deploy success.
2. The project is full-stack and demo-ready.
3. It solves a real developer pain point with a clear before/after value.
4. It combines AI + Web3 + DevTools into one cohesive workflow.
5. It includes both user-facing UX and deep backend engineering.

## Demo Flow for Judges
1. Connect wallet and authenticate.
2. Select GitHub repo.
3. Run stack classification (Smolify-assisted).
4. Start deploy with live logs.
5. Open IPFS URL and show app.
6. Show deployment history with tx reference.
7. Trigger MCP deploy from agent workflow to show vibe coding integration.

## Future Roadmap
1. Multi-framework deep detection (SSR vs static export modes).
2. Build cache and parallelized deploy workers.
3. On-chain verification explorer view in frontend.
4. Team workspaces and role-based deploy permissions.
5. Quality gates: lint/test/build checks before publish.
