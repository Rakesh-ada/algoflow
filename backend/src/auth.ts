import { Hono } from "hono";
import { sign, verify } from "hono/jwt";

export const authRouter = new Hono();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "w3deploy-super-secret-key-change-me";

// 1. Redirect to GitHub
authRouter.get("/github", (c) => {
  const redirectUri = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo,user`;
  return c.redirect(redirectUri);
});

// 2. Handle GitHub Callback
authRouter.get("/github/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.json({ error: "No code provided" }, 400);

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    
    if (!accessToken) {
      return c.json({ error: "Failed to get access token from GitHub" }, 400);
    }

    // Fetch user details from GitHub
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "W3DEPLOY-Backend",
      },
    });
    
    const userData = await userRes.json();

    // Create JWT containing user data
    const payload = {
      sub: userData.id.toString(),
      provider: "github",
      login: userData.login,
      name: userData.name || userData.login,
      email: userData.email || "",
      avatar: userData.avatar_url,
      accessToken, // Storing accessToken in JWT to use for IPFS/repo actions later
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 1 week expiration
    };
    
    const token = await sign(payload, JWT_SECRET);

    // Redirect back to frontend
    return c.redirect(`${FRONTEND_URL}/login?token=${token}`);
  } catch (error) {
    console.error("OAuth Error:", error);
    return c.json({ error: "OAuth failed" }, 500);
  }
});

// 3. Get Current User (Me)
authRouter.get("/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized. Missing token." }, 401);
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = await verify(token, JWT_SECRET, "HS256");
    return c.json({ user: decoded });
  } catch (error) {
    return c.json({ error: "Invalid token" }, 401);
  }
});

// 4. Logout (Stateless, just return success)
authRouter.post("/logout", (c) => {
  return c.json({ success: true, message: "Logged out" });
});
