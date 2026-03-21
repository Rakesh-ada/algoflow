import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "dotenv/config";
import { authRouter } from "./auth.js";
import { mcpRouter } from "./mcp.js";
import { githubRouter, startPolling } from "./github.js";
import { deployRouter } from "./deploy.js";
import { sitesRouter } from "./sites.js";
import { ensureDatabase } from "./db.js";

const app = new Hono();

app.use("/*", cors());

app.onError((err, c) => {
  console.error("Global App Error:", err);
  return c.text("Internal Server Error", 500);
});

app.get("/", (c) => {
  return c.json({ message: "W3DEPLOY Backend API works!" });
});

app.route("/api/auth", authRouter);
app.route("/api/mcp", mcpRouter);
app.route("/api/github", githubRouter);
app.route("/api/deploy", deployRouter);
app.route("/api/sites", sitesRouter);

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

void ensureDatabase();

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

startPolling(60_000);
