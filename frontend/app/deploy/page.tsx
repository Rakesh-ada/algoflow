"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount, useConnect } from "wagmi";
import {
  getToken,
  clearToken,
  DeployReceipt,
  getRepos,
  Repo,
  deployStream,
} from "@/lib/api";
import Navbar from "@/components/navbar";

type DeployState = "idle" | "deploying" | "done" | "error";
type EnvVarRow = { key: string; value: string };

function toProjectName(repoFullName: string) {
  const name = repoFullName.split("/")[1] || repoFullName;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "new-project";
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "new-project";
}

function parseDotEnv(raw: string): EnvVarRow[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^export\s+/, ""))
    .map((line) => {
      const i = line.indexOf("=");
      if (i <= 0) return null;
      const key = line.slice(0, i).trim();
      let value = line.slice(i + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return key ? { key, value } : null;
    })
    .filter((row): row is EnvVarRow => Boolean(row));
}

export default function DeployPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnectingWallet } = useConnect();

  const [cloneUrl, setCloneUrl] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("new-project");
  const [dotEnvText, setDotEnvText] = useState("");
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const walletAddress = isConnected && address ? address : null;
  const walletBusy = isConnectingWallet;

  const [status, setStatus] = useState<DeployState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<DeployReceipt | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const repoMenuRef = useRef<HTMLDivElement>(null);

  const filteredRepos = useMemo(() => {
    const query = repoQuery.trim().toLowerCase();
    if (!query) return repos;
    return repos.filter((repo) => repo.fullName.toLowerCase().includes(query));
  }, [repoQuery, repos]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
  }, [router]);

  useEffect(() => {
    async function loadRepos() {
      try {
        setLoadingRepos(true);
        setReposError(null);

        const res = await getRepos();
        setRepos(res.repos);

        if (res.repos.length > 0) {
          const defaultRepo = res.repos[0];
          const name = toProjectName(defaultRepo.fullName);
          setSelectedRepo(defaultRepo.fullName);
          setProjectName(name);
          setCloneUrl(`https://github.com/${defaultRepo.fullName}.git`);
        }
      } catch (err: unknown) {
        const e = err as Error;
        if (e.message.includes("401") || e.message.includes("Authentication")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setReposError(e.message);
      } finally {
        setLoadingRepos(false);
      }
    }

    if (getToken()) {
      loadRepos();
    }
  }, [router]);

  useEffect(() => {
    if (!selectedRepo) return;
    setCloneUrl(`https://github.com/${selectedRepo}.git`);
  }, [selectedRepo]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!repoMenuOpen) return;

    const handleOutside = (event: MouseEvent) => {
      if (!repoMenuRef.current) return;
      if (!repoMenuRef.current.contains(event.target as Node)) {
        setRepoMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [repoMenuOpen]);

  async function handleConnectWallet() {
    if (walletBusy) return;

    setErrMsg(null);
    try {
      const connector = connectors.find((item) => item.id === "injected") ?? connectors[0];
      if (!connector) {
        throw new Error("No wallet connector is available.");
      }
      await connectAsync({ connector });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Wallet connection failed.";
      if (!message.toLowerCase().includes("cancel")) {
        setErrMsg(message);
      }
    }
  }

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();

    if (!walletAddress) {
      setErrMsg("Connect your Algorand wallet before deploying.");
      return;
    }

    if (!cloneUrl.trim()) {
      setErrMsg("Please select a GitHub repository.");
      return;
    }

    const trimmedProjectName = projectName.trim();
    if (!trimmedProjectName) {
      setErrMsg("Project name is required.");
      return;
    }

    const parsedEnvVars = parseDotEnv(dotEnvText);

    setStatus("deploying");
    setLogs([]);
    setReceipt(null);
    setErrMsg(null);

    const deployMeta = {
      projectName: trimmedProjectName,
      appPreset: "static",
      envVars: parsedEnvVars,
    };

    abortRef.current = deployStream(
      {
        repoUrl: cloneUrl.trim(),
        domain: normalizeDomain(trimmedProjectName),
        meta: JSON.stringify(deployMeta),
      },
      (line) => setLogs((prev) => [...prev, line]),
      (r) => {
        setReceipt(r);
        setStatus("done");
      },
      (message) => {
        setErrMsg(message || "Deploy failed");
        setStatus("error");
      }
    );
  }

  function handleCancel() {
    abortRef.current?.();
    setStatus("idle");
  }

  function handleReset() {
    abortRef.current?.();
    setStatus("idle");
    setLogs([]);
    setReceipt(null);
    setErrMsg(null);
  }

  const isDeploying = status === "deploying";

  return (
    <div className="min-h-screen bg-tg-black text-white font-sans antialiased p-6 md:p-12">
      <main className="max-w-7xl mx-auto space-y-8">
        <Navbar />

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="font-display text-4xl font-extrabold">New Deployment</h1>
              <p className="text-tg-muted mt-2 text-sm">Deploy your static site. Pick your repository and deploy.</p>
            </div>
            <div className="flex items-center md:pb-1">
              <Link href="/dashboard" className="text-tg-muted text-sm hover:text-white transition-colors font-medium">
                Back to Dashboard
              </Link>
            </div>
          </div>

          <div className="md:col-span-5 rounded-card bg-tg-gray border border-white/5 p-8 md:p-10">
            <h2 className="font-display text-3xl font-bold mb-7">Configuration</h2>

            {!walletAddress && (
              <div className="mb-6 px-4 py-3 rounded-2xl bg-tg-lavender/10 border border-tg-lavender/20">
                <p className="text-sm text-tg-muted mb-3">
                  Connect your wallet to store deployment history on-chain.
                </p>
                <button
                  type="button"
                  onClick={handleConnectWallet}
                  disabled={walletBusy}
                  className="bg-tg-lavender text-tg-black px-4 py-2 rounded-full font-bold text-xs tracking-wide hover:opacity-90 transition-all disabled:opacity-60"
                >
                  {walletBusy ? "CONNECTING..." : "CONNECT WALLET"}
                </button>
              </div>
            )}

            <form onSubmit={handleDeploy} className="space-y-6">
              <div className="space-y-2">
                <label className="block text-xs font-bold tracking-widest uppercase text-tg-muted mb-2">Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={isDeploying}
                  required
                  className="w-full bg-tg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-tg-muted focus:outline-none focus:border-tg-lavender transition-colors disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold tracking-widest uppercase text-tg-muted mb-2">Select GitHub Repo</label>
                <div ref={repoMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (isDeploying || loadingRepos || repos.length === 0) return;
                      setRepoMenuOpen((prev) => !prev);
                      setRepoQuery("");
                    }}
                    disabled={isDeploying || loadingRepos || repos.length === 0}
                    className="w-full bg-tg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-tg-lavender transition-colors disabled:opacity-50 flex items-center justify-between"
                  >
                    <span className="truncate">
                      {loadingRepos
                        ? "Loading repositories..."
                        : selectedRepo || "Select a repository"}
                    </span>
                    <span className={`text-tg-muted transition-transform duration-200 ${repoMenuOpen ? "rotate-180" : ""}`}>
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>

                  {repoMenuOpen && (
                    <div className="absolute z-20 mt-2 w-full rounded-2xl border border-white/10 bg-[#0b0b0f] shadow-2xl overflow-hidden">
                      <div className="p-3 border-b border-white/10">
                        <input
                          autoFocus
                          type="text"
                          value={repoQuery}
                          onChange={(e) => setRepoQuery(e.target.value)}
                          placeholder="Search repositories..."
                          className="w-full bg-black/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-tg-muted focus:outline-none focus:border-tg-lavender"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        {filteredRepos.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-tg-muted">No repositories found.</p>
                        ) : (
                          filteredRepos.map((repo) => {
                            const isActive = repo.fullName === selectedRepo;
                            return (
                              <button
                                key={repo.fullName}
                                type="button"
                                onClick={() => {
                                  setSelectedRepo(repo.fullName);
                                  setProjectName(toProjectName(repo.fullName));
                                  setRepoMenuOpen(false);
                                  setRepoQuery("");
                                }}
                                className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors ${
                                  isActive
                                    ? "bg-tg-lavender/20 text-white border border-tg-lavender/40"
                                    : "text-white hover:bg-white/5 border border-transparent"
                                }`}
                              >
                                {repo.fullName}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {reposError && <p className="text-xs text-red-400">Could not load repos: {reposError}</p>}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold tracking-widest uppercase text-tg-muted mb-2">.env (Optional)</label>
                <textarea
                  value={dotEnvText}
                  onChange={(e) => setDotEnvText(e.target.value)}
                  disabled={isDeploying}
                  placeholder="API_URL=https://example.com"
                  className="w-full min-h-28 bg-tg-black border border-white/10 rounded-2xl px-4 py-3 text-xs text-white placeholder-tg-muted focus:outline-none focus:border-tg-lavender transition-colors disabled:opacity-50 font-mono"
                />
              </div>

              <div className="flex space-x-3 pt-1">
                {isDeploying ? (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 bg-red-500/10 border border-red-500/20 text-red-400 px-6 py-3 rounded-full font-bold text-sm tracking-wide hover:bg-red-500/20 transition-all"
                  >
                    CANCEL
                  </button>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={!walletAddress}
                      className="flex-1 bg-tg-lavender text-tg-black px-6 py-3 rounded-full font-bold text-sm tracking-wide hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      DEPLOY
                    </button>
                    {(status === "done" || status === "error") && (
                      <button
                        type="button"
                        onClick={handleReset}
                        className="px-6 py-3 rounded-full font-bold text-sm tracking-wide border border-white/10 text-tg-muted hover:text-white hover:border-white/30 transition-all"
                      >
                        RESET
                      </button>
                    )}
                  </>
                )}
              </div>
            </form>
          </div>

          <div className="md:col-span-7 space-y-5">
            <div className="rounded-card bg-tg-gray border border-white/5 p-8">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-4xl font-bold">Build Log</h2>
                <div className="flex items-center space-x-2">
                  {isDeploying && (
                    <div className="flex items-center space-x-2 text-tg-lime">
                      <div className="w-2 h-2 rounded-full bg-tg-lime animate-pulse" />
                      <span className="text-xs font-bold tracking-widest uppercase">Deploying</span>
                    </div>
                  )}
                  {status === "done" && (
                    <div className="flex items-center space-x-2 text-tg-lime">
                      <span className="text-xs font-bold tracking-widest uppercase">Done</span>
                    </div>
                  )}
                  {status === "error" && (
                    <div className="flex items-center space-x-2 text-red-400">
                      <span className="text-xs font-bold tracking-widest uppercase">Failed</span>
                    </div>
                  )}
                </div>
              </div>

              <div ref={logRef} className="bg-tg-black rounded-2xl border border-white/5 p-5 h-[26rem] overflow-y-auto font-mono text-xs leading-relaxed">
                {logs.length === 0 && status === "idle" && <span className="text-tg-muted">Waiting for deployment to start...</span>}
                {logs.length === 0 && status === "deploying" && (
                  <span className="text-tg-muted">Connected to deploy stream. Waiting for live build output...</span>
                )}
                {logs.map((line, i) => (
                  <div key={i} className={`${line.startsWith("ERROR") ? "text-red-400" : "text-green-400"}`}>
                    <span className="text-tg-muted select-none mr-2">{String(i + 1).padStart(3, "0")}</span>
                    {line}
                  </div>
                ))}
                {logs.length === 0 && status === "done" && !errMsg && (
                  <span className="text-tg-muted">Deployment finished. No verbose build logs were emitted by the backend.</span>
                )}
                {errMsg && <div className="text-red-400 mt-2 border-t border-red-500/20 pt-2">x {errMsg}</div>}
              </div>
            </div>

            {receipt && status === "done" && (
              <div className="rounded-card bg-tg-lime p-6 text-tg-black">
                <h3 className="font-display text-lg font-bold mb-4">Deployment Successful!</h3>
                <div className="space-y-2 text-sm">
                  {receipt.domain && (
                    <div className="flex justify-between">
                      <span className="font-bold opacity-60 uppercase text-xs tracking-widest">Domain</span>
                      <span className="font-mono font-bold">{receipt.domain}</span>
                    </div>
                  )}
                  {receipt.cid && (
                    <div className="flex justify-between">
                      <span className="font-bold opacity-60 uppercase text-xs tracking-widest">CID</span>
                      <span className="font-mono text-xs">{receipt.cid}</span>
                    </div>
                  )}
                  {(receipt.url || receipt.gatewayUrl) && (
                    <div className="flex justify-between items-center">
                      <span className="font-bold opacity-60 uppercase text-xs tracking-widest">Site</span>
                      <a href={String(receipt.url || receipt.gatewayUrl)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs underline">
                        Open
                      </a>
                    </div>
                  )}
                  {receipt.txId && (
                    <div className="flex justify-between items-center">
                      <span className="font-bold opacity-60 uppercase text-xs tracking-widest">Txn</span>
                      {receipt.txExplorerUrl ? (
                        <a href={String(receipt.txExplorerUrl)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs underline">
                          {receipt.txId.slice(0, 10)}...{receipt.txId.slice(-6)}
                        </a>
                      ) : (
                        <span className="font-mono text-xs">{receipt.txId.slice(0, 10)}...{receipt.txId.slice(-6)}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex space-x-3">
                  <Link href={`/projects/${encodeURIComponent(receipt.domain || normalizeDomain(projectName))}`}>
                    <button className="bg-tg-black text-white px-5 py-2 rounded-full font-bold text-xs tracking-wide hover:opacity-90 transition-all">
                      VIEW PROJECT
                    </button>
                  </Link>
                  <Link href="/dashboard">
                    <button className="border border-tg-black/20 text-tg-black px-5 py-2 rounded-full font-bold text-xs tracking-wide hover:bg-tg-black/10 transition-all">
                      DASHBOARD
                    </button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
