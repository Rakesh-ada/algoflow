"use client";

import { useState } from "react";
import Navbar from "@/components/navbar";

const MCP_WALKTHROUGH_URL = "https://youtu.be/bf5vnTr1Sz0?si=qxrd3ytSfnMnMp_u";

const MCP_CONFIG_OBJECT = {
  preferences: {
    coworkWebSearchEnabled: true,
    coworkScheduledTasksEnabled: false,
    ccdScheduledTasksEnabled: false,
  },
  mcpServers: {
    w3deploy: {
      command: "w3deploy-mcp",
      env: {
        W3DEPLOY_API_BASE: "https://www.api.web3deploy.me/",
        W3DEPLOY_WALLET_ADDRESS: "<YOUR_WALLET_ADDRESS>",
        W3DEPLOY_API_TOKEN: "<YOUR_PRODUCTION_JWT>",
        W3DEPLOY_EVM_PRIVATE_KEY: "<YOUR_PRIVATE_KEY_IF_AUTOSIGN>",
      },
    },
  },
} as const;

const MCP_CONFIG = JSON.stringify(MCP_CONFIG_OBJECT, null, 2);

function CopyIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function SyntaxLine({ line }: { line: string }) {
  // Colorize keys, strings, and punctuation
  const parts: { text: string; color?: string; charColor?: string }[] = [];

  let i = 0;
  while (i < line.length) {
    // Leading whitespace
    if (line[i] === " ") {
      let spaces = "";
      while (i < line.length && line[i] === " ") spaces += line[i++];
      parts.push({ text: spaces, color: "inherit" });
      continue;
    }

    // String "key": or "value"
    if (line[i] === '"') {
      let str = '"';
      i++;
      while (i < line.length && line[i] !== '"') {
        str += line[i++];
      }
      str += '"';
      i++;

      // Peek ahead for ':'
      let peek = i;
      while (peek < line.length && line[peek] === " ") peek++;
      if (line[peek] === ":") {
        parts.push({ text: str, color: "#B5B0FF" }); // key = lavender
      } else {
        parts.push({ text: str, color: "#E1F26E" }); // value = lime
      }
      continue;
    }

    // Boolean "true" "false"
    if (line.slice(i, i + 4) === "true") {
      parts.push({ text: "true", color: "#E1F26E" }); // lime for booleans too
      i += 4;
      continue;
    }
    if (line.slice(i, i + 5) === "false") {
      parts.push({ text: "false", color: "#E1F26E" }); // lime for booleans too
      i += 5;
      continue;
    }

    // Punctuation / rest
    let charColor = "#A1A1A1";
    if (["{", "}", "[", "]"].includes(line[i])) {
      charColor = "#FFFFFF"; // Braces in white
    }
    parts.push({ text: line[i], charColor });
    i++;
  }

  return (
    <span className="whitespace-pre">
      {parts.map((part, idx) => (
        <span key={idx} style={{ color: part.charColor || part.color }}>
          {part.text}
        </span>
      ))}
    </span>
  );
}

function toYouTubeEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be") {
      const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
      if (id) return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
    }

    if (host.endsWith("youtube.com")) {
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        if (id) return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
      }

      if (parsed.pathname.startsWith("/embed/")) {
        const id = parsed.pathname.split("/")[2];
        if (id) return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
      }

      if (parsed.pathname.startsWith("/shorts/")) {
        const id = parsed.pathname.split("/")[2];
        if (id) return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
      }
    }
  } catch {
    // Fallback below for malformed URLs.
  }

  return "https://www.youtube.com/embed/bf5vnTr1Sz0?rel=0&modestbranding=1";
}

export default function McpPage() {
  const [copied, setCopied] = useState(false);
  const walkthroughEmbedUrl = toYouTubeEmbedUrl(MCP_WALKTHROUGH_URL);

  function handleCopy() {
    navigator.clipboard.writeText(MCP_CONFIG).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const lines = MCP_CONFIG.split("\n");

  return (
    <div className="min-h-screen bg-tg-black text-white font-sans antialiased p-6 md:p-12">
      <main className="max-w-7xl mx-auto space-y-8">
        <Navbar />

        {/* Page header */}
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tg-lavender/10 border border-tg-lavender/20 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-tg-lavender animate-pulse" />
            <span className="text-tg-lavender text-xs font-bold tracking-widest uppercase">MCP Integration</span>
          </div>

          <h1 className="font-display text-4xl md:text-6xl font-extrabold leading-tight tracking-tighter">
            Connect Our MCP{" "}
            <span className="text-tg-lavender">with your Claude</span>
          </h1>
          <p className="text-tg-muted text-base mt-3 max-w-xl">
            Paste this config into your Claude Desktop settings and replace the placeholders with your local values.
          </p>
        </div>

        {/* Main split layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">

          {/* Left — Code block */}
          <div className="md:col-span-7 rounded-card bg-tg-gray border border-white/5 overflow-hidden flex flex-col h-full">
            {/* Card header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                {/* Traffic lights */}
                <span className="w-3 h-3 rounded-full bg-red-500/70" />
                <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <span className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              <span className="text-tg-muted text-xs font-mono font-bold tracking-wide">claude_desktop_config.json</span>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${copied
                  ? "bg-tg-lime/20 text-tg-lime border border-tg-lime/30"
                  : "bg-white/5 text-tg-muted border border-white/10 hover:bg-white/10 hover:text-white"
                  }`}
              >
                <CopyIcon copied={copied} />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* Code */}
            <div className="p-6 font-mono text-sm leading-7 overflow-x-auto">
              {lines.map((line, idx) => (
                <div key={idx} className="flex">
                  <span className="select-none text-white/20 mr-5 text-right w-5 shrink-0">
                    {idx + 1}
                  </span>
                  <SyntaxLine line={line} />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/5">
              <p className="text-tg-muted text-xs">
                Keep tokens and private keys in local config only. Never commit real credentials to source control.
              </p>
            </div>
          </div>

          {/* Right — Video + steps */}
          <div className="md:col-span-5 flex flex-col gap-6 h-full">

            {/* Video card */}
            <div className="rounded-card bg-tg-gray border border-white/5 overflow-hidden shrink-0">
              <div className="px-6 py-5 border-b border-white/5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-tg-lavender/10 border border-tg-lavender/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-tg-lavender" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <span className="font-display font-bold text-sm">Setup Walkthrough</span>
              </div>
              <div className="p-5">
                <div className="rounded-2xl bg-black/60 border border-white/5 overflow-hidden aspect-video flex items-center justify-center">
                  <iframe
                    className="w-full h-full object-cover"
                    src={walkthroughEmbedUrl}
                    title="W3DEPLOY MCP setup walkthrough"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <a
                  href={MCP_WALKTHROUGH_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex mt-4 text-xs font-semibold text-tg-lavender hover:text-tg-lime transition-colors"
                >
                  Watch on YouTube
                </a>
              </div>
            </div>

            {/* Steps card */}
            <div className="rounded-card bg-tg-gray border border-white/5 p-6 flex flex-col flex-1">
              <h3 className="font-display font-bold text-lg mb-4">Quick Steps</h3>
              <div className="flex flex-col flex-1 justify-between">
                {[
                {
                  num: "01",
                  title: "Open Claude Desktop config",
                  desc: 'Find the config file via Claude → Settings → Developer.',
                },
                {
                  num: "02",
                  title: "Paste the MCP block",
                  desc: "Copy the config on the left and merge it into JSON file.",
                },
                {
                  num: "03",
                  title: "Replace placeholders",
                  desc: "Fill in your wallet address, API token, and EVM private key.",
                },
                {
                  num: "04",
                  title: "Restart Claude Desktop",
                  desc: "The ALGOFLOW MCP server will appear in your tools panel.",
                },
              ].map(({ num, title, desc }) => (
                <div key={num} className="flex gap-4 items-start">
                  <span className="font-display text-4xl font-extrabold text-white/10 leading-none shrink-0 tracking-tighter w-10">
                    {num}
                  </span>
                  <div>
                    <h4 className="font-display font-bold text-sm mb-1 text-white/90">{title}</h4>
                    <p className="text-tg-muted text-xs leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
