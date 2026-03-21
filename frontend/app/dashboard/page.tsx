"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  clearToken,
  deleteSite,
  DeployStatus,
  getDeployStatus,
  getSite,
  getSites,
  getToken,
  saveToken,
  SiteDetail,
} from "@/lib/api";
import Navbar from "@/components/navbar";

function shortCid(cid: string) {
  if (!cid) return "-";
  return cid.length > 14 ? `${cid.slice(0, 7)}...${cid.slice(-6)}` : cid;
}

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface SiteRow {
  domain: string;
  detail: SiteDetail | null;
  loading: boolean;
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnectingWallet } = useConnect();
  const { disconnect, isPending: isDisconnectingWallet } = useDisconnect();

  const [domains, setDomains] = useState<string[]>([]);
  const [siteRows, setSiteRows] = useState<SiteRow[]>([]);
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const walletAddress = isConnected && address ? address : null;
  const walletBusy = isConnectingWallet || isDisconnectingWallet;

  const totalDeployments = siteRows.reduce((sum, row) => sum + (row.detail?.count ?? 0), 0);
  const deploymentsCountReady = siteRows.length > 0 && siteRows.every((row) => !row.loading);

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      saveToken(token);
      router.replace("/dashboard");
    }
  }, [searchParams, router]);

  useEffect(() => {
    const urlToken = searchParams.get("token");
    if (!urlToken && !getToken()) {
      router.replace("/login");
    }
  }, [searchParams, router]);

  const loadData = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    if (!walletAddress) {
      setDomains([]);
      setSiteRows([]);
      setDeployStatus(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [sitesRes, statusRes] = await Promise.all([getSites(), getDeployStatus()]);
      const combinedDomains = sitesRes.domains;

      setDomains(combinedDomains);
      setDeployStatus(statusRes);

      const rows: SiteRow[] = combinedDomains.map((domain) => ({
        domain,
        detail: null,
        loading: true,
      }));
      setSiteRows(rows);

      for (const domain of combinedDomains) {
        getSite(domain)
          .then((detail) => {
            setSiteRows((prev) =>
              prev.map((row) =>
                row.domain === domain ? { ...row, detail, loading: false } : row
              )
            );
          })
          .catch(() => {
            setSiteRows((prev) =>
              prev.map((row) =>
                row.domain === domain ? { ...row, loading: false } : row
              )
            );
          });
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes("401") || err.message.includes("Authentication")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [router, walletAddress]);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      loadData();
    }
  }, [loadData, searchParams]);

  useEffect(() => {
    setSelectedDomains((prev) => prev.filter((domain) => domains.includes(domain)));
    if (domains.length === 0) {
      setSelectionMode(false);
    }
  }, [domains]);

  function toggleDomainSelection(domain: string) {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((item) => item !== domain) : [...prev, domain]
    );
  }

  async function handleConnectWallet() {
    if (walletBusy) return;

    setError(null);

    try {
      const connector = connectors.find((item) => item.id === "injected") ?? connectors[0];
      if (!connector) {
        throw new Error("No wallet connector is available.");
      }
      await connectAsync({ connector });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Wallet connection failed.";
      if (!message.toLowerCase().includes("cancel")) {
        setError(message);
      }
    }
  }

  async function handleDisconnectWallet() {
    if (walletBusy) return;

    disconnect();
    setDomains([]);
    setSiteRows([]);
    setSelectionMode(false);
    setSelectedDomains([]);
    setDeployStatus(null);
    setLoading(false);
  }

  async function handleDeleteIconClick() {
    if (isDeleting || !walletAddress) return;

    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedDomains([]);
      return;
    }

    if (selectedDomains.length === 0) {
      setSelectionMode(false);
      setSelectedDomains([]);
      return;
    }

    await handleDeleteSelected();
  }

  async function handleDeleteSelected() {
    if (selectedDomains.length === 0 || isDeleting) return;

    const confirmed = window.confirm(
      `Delete ${selectedDomains.length} selected project(s)? This updates Algorand history and removes Pinata pins.`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setError(null);

    const results = await Promise.allSettled(
      selectedDomains.map((domain) => deleteSite(domain))
    );

    const failed = results.filter((result) => result.status === "rejected").length;
    const withUnpinErrors = results.filter(
      (result) =>
        result.status === "fulfilled" &&
        Array.isArray(result.value.unpinErrors) &&
        result.value.unpinErrors.length > 0
    ).length;

    let nextError: string | null = null;
    if (failed > 0) {
      nextError = `${failed} project(s) failed to delete. Please try again.`;
    } else if (withUnpinErrors > 0) {
      nextError = `${withUnpinErrors} project(s) were removed from Algorand history, but some Pinata unpins failed.`;
    }

    setSelectionMode(false);
    setSelectedDomains([]);
    await loadData();
    if (nextError) setError(nextError);
    setIsDeleting(false);
  }

  return (
    <div className="min-h-screen bg-tg-black text-white font-sans antialiased p-6 md:p-12">
      <main className="max-w-7xl mx-auto space-y-6">
        <Navbar />

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-4 rounded-card bg-tg-gray p-8 border border-white/5 flex flex-col justify-between min-h-36 transition-transform duration-200 hover:-translate-y-0.5">
            <div className="flex justify-between items-start">
              <span className="text-tg-muted text-xs font-bold tracking-widest uppercase">Total Active Deployments</span>
              <svg className="text-tg-lavender w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <div>
              <span className="font-display text-5xl font-bold block">
                {!walletAddress
                  ? "-"
                  : loading || (domains.length > 0 && !deploymentsCountReady)
                    ? "..."
                    : totalDeployments}
              </span>
              <span className="text-tg-muted text-xs font-medium mt-2 block uppercase tracking-widest">
                MAX {deployStatus?.max ?? 3} CONCURRENT
              </span>
            </div>
          </div>

          <div className="md:col-span-4 rounded-card bg-tg-gray p-8 border border-white/5 flex flex-col justify-between min-h-36 transition-transform duration-200 hover:-translate-y-0.5">
            <div className="flex justify-between items-start">
              <span className="text-tg-muted text-xs font-bold tracking-widest uppercase">Total Projects Deployed</span>
              <svg className="text-tg-lime w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
            <div>
              <span className="font-display text-5xl font-bold block">
                {!walletAddress ? "-" : loading ? "..." : domains.length}
              </span>
              <span className="text-tg-muted text-xs font-medium mt-2 block uppercase tracking-widest">
                Projects Deployed Till Now
              </span>
            </div>
          </div>

          <div className="md:col-span-4 rounded-card bg-tg-lime p-8 flex flex-col justify-between text-tg-black transition-transform duration-200 hover:-translate-y-0.5">
            <div>
              <span className="text-tg-black/60 text-xs font-bold tracking-widest uppercase">Quick Deploy</span>
            </div>
            <div>
              <p className="text-tg-black/75 text-sm leading-relaxed mb-5">
                Ship a new deployment instantly. Repositories are fetched automatically and deployed like Vercel.
              </p>
              <div className="flex items-center gap-2">
                {walletAddress ? (
                  <Link href="/deploy">
                    <button className="bg-tg-black text-white px-6 py-3 rounded-full font-bold text-xs tracking-widest hover:opacity-90 transition-all">
                      DEPLOY NOW
                    </button>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectWallet}
                    disabled={walletBusy}
                    className="bg-tg-black text-white px-6 py-3 rounded-full font-bold text-xs tracking-widest hover:opacity-90 transition-all disabled:opacity-60"
                  >
                    {walletBusy ? "CONNECTING..." : "CONNECT WALLET"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <section className="md:col-span-12 rounded-card bg-tg-gray border border-white/5 p-8">
            <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <h2 className="font-display text-2xl font-bold">Active Projects</h2>
              <div className="flex items-center gap-2 flex-wrap">
                {walletAddress && (
                  <button
                    type="button"
                    onClick={handleDisconnectWallet}
                    disabled={walletBusy}
                    className="inline-flex items-center px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase bg-white/5 text-white border border-white/15 hover:bg-white/10 transition-colors disabled:opacity-60"
                  >
                    {walletBusy ? "Working..." : "Disconnect"}
                  </button>
                )}

                <Link
                  href={walletAddress ? "/deploy" : "#"}
                  className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase border transition-colors ${
                    walletAddress
                      ? "bg-tg-lime/10 text-tg-lime border-tg-lime/30 hover:bg-tg-lime/20"
                      : "bg-white/5 text-white/50 border-white/10 pointer-events-none"
                  }`}
                  aria-label="New deploy"
                  title="New deploy"
                >
                  New
                </Link>

                <button
                  type="button"
                  onClick={handleDeleteIconClick}
                  disabled={!walletAddress}
                  className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    selectionMode
                      ? "bg-red-500 text-white border-red-500"
                      : "bg-red-500/10 text-red-300 border-red-500/20 hover:bg-red-500/20"
                  }`}
                  aria-label="Select projects to delete"
                  title={
                    selectionMode
                      ? selectedDomains.length > 0
                        ? "Delete selected projects"
                        : "Exit selection"
                      : "Select projects to delete"
                  }
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            {loading && walletAddress && domains.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-8 h-8 border-2 border-tg-lavender border-t-transparent rounded-full animate-spin" />
                  <span className="text-tg-muted text-sm">Loading projects...</span>
                </div>
              </div>
            ) : !walletAddress ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-tg-lavender/10 border border-tg-lavender/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-tg-lavender" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m9-9H3" />
                  </svg>
                </div>
                <h3 className="font-display text-lg font-bold mb-2">Connect your wallet</h3>
                <p className="text-tg-muted text-sm mb-6">
                  Connect your wallet to load your active projects and deployment history from blockchain records.
                </p>
                <button
                  type="button"
                  onClick={handleConnectWallet}
                  disabled={walletBusy}
                  className="bg-tg-lavender text-tg-black px-6 py-3 rounded-full font-bold text-sm tracking-wide hover:opacity-90 transition-all disabled:opacity-60"
                >
                  {walletBusy ? "CONNECTING..." : "CONNECT YOUR WALLET"}
                </button>
              </div>
            ) : domains.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-tg-lavender/10 border border-tg-lavender/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-tg-lavender" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h3 className="font-display text-lg font-bold mb-2">No deployments yet</h3>
                <p className="text-tg-muted text-sm mb-6">This wallet has no deployment history yet.</p>
                <Link href="/deploy">
                  <button className="bg-tg-lavender text-tg-black px-6 py-3 rounded-full font-bold text-sm tracking-wide hover:opacity-90 transition-all">
                    DEPLOY YOUR FIRST SITE
                  </button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-tg-muted text-xs font-bold tracking-widest uppercase border-b border-white/5">
                      {selectionMode && <th className="pb-4 px-4 font-bold">Select</th>}
                      <th className="pb-4 px-4 font-bold">DOMAIN</th>
                      <th className="pb-4 px-4 font-bold">STATUS</th>
                      <th className="pb-4 px-4 font-bold">LATEST CID</th>
                      <th className="pb-4 px-4 font-bold">ENV</th>
                      <th className="pb-4 px-4 font-bold">DEPLOYED</th>
                      <th className="pb-4 px-4 font-bold text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {siteRows.map(({ domain, detail, loading: rowLoading }) => (
                      <tr key={domain} className="group hover:bg-white/5 transition-colors">
                        {selectionMode && (
                          <td className="py-6 px-4">
                            <input
                              type="checkbox"
                              checked={selectedDomains.includes(domain)}
                              onChange={() => toggleDomainSelection(domain)}
                              className="h-4 w-4 rounded border-white/20 bg-transparent text-red-400 focus:ring-red-400"
                            />
                          </td>
                        )}
                        <td className="py-6 px-4 font-display font-semibold text-lg">{domain}</td>
                        <td className="py-6 px-4">
                          {detail?.latest ? (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase bg-tg-lime/10 text-tg-lime border border-tg-lime/20">
                              Online
                            </span>
                          ) : rowLoading ? (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase bg-tg-lavender/10 text-tg-lavender border border-tg-lavender/20">
                              Loading...
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase bg-white/5 text-tg-muted border border-white/10">
                              Unknown
                            </span>
                          )}
                        </td>
                        <td className="py-6 px-4 font-mono text-sm text-tg-muted">
                          {detail?.latest ? shortCid(detail.latest.cid) : "-"}
                        </td>
                        <td className="py-6 px-4">
                          {detail?.latest?.env ? (
                            <span className="text-xs text-tg-muted uppercase tracking-widest">
                              {detail.latest.env}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="py-6 px-4 text-sm text-tg-muted">
                          {detail?.latest?.timestamp ? timeAgo(detail.latest.timestamp) : "-"}
                        </td>
                        <td className="py-6 px-4 text-right">
                          <Link href={`/projects/${encodeURIComponent(domain)}`}>
                            <button className="p-2 rounded-full border border-white/10 hover:bg-tg-lavender hover:text-tg-black transition-colors">
                              <svg className="w-4 h-4 -rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                              </svg>
                            </button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-20 pt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-tg-muted text-xs font-medium">
          <div className="flex items-center space-x-4 mb-4 md:mb-0">
            <span>© 2024 ALGOFLOW FOUNDATION</span>
            <span className="w-1 h-1 bg-white/20 rounded-full" />
            <span className="hover:text-white cursor-pointer transition-colors">TERMS OF SERVICE</span>
          </div>
          <div className="flex items-center space-x-6">
            <a href="#" className="hover:text-white transition-colors">TWITTER</a>
            <a href="#" className="hover:text-white transition-colors">GITHUB</a>
            <a href="#" className="hover:text-white transition-colors text-tg-lime">STATUS: OPTIMAL</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}

