"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import {
  clearToken,
  getSite,
  getToken,
  SiteDetail,
} from "@/lib/api";
import Navbar from "@/components/navbar";

function timeStr(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortCid(cid: string) {
  if (!cid) return "-";
  return cid.length > 18 ? `${cid.slice(0, 9)}...${cid.slice(-8)}` : cid;
}

export default function ProjectPage() {
  const router = useRouter();
  const { domain: rawDomain } = useParams<{ domain: string }>();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnectingWallet } = useConnect();
  const domain = decodeURIComponent(rawDomain);

  const [site, setSite] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const walletAddress = isConnected && address ? address : null;
  const walletBusy = isConnectingWallet;

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
  }, [router]);

  useEffect(() => {
    if (!domain) return;
    if (!getToken()) return;
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const siteRes = await getSite(domain);
        setSite(siteRes);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load project";
        if (message.includes("401") || message.includes("Authentication")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [domain, router, walletAddress]);

  async function handleConnectWallet() {
    if (walletBusy) return;

    setError(null);
    try {
      const connector = connectors.find((item) => item.id === "injected") ?? connectors[0];
      if (!connector) {
        throw new Error("No wallet connector is available.");
      }
      await connectAsync({ connector });
      setLoading(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Wallet connection failed.";
      if (!message.toLowerCase().includes("cancel")) {
        setError(message);
      }
    }
  }

  return (
    <div className="min-h-screen bg-tg-black text-white font-sans antialiased p-6 md:p-12">
      <main className="max-w-7xl mx-auto space-y-6">
        <Navbar />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-4xl font-extrabold">{domain}</h1>
          </div>
          <Link href="/dashboard" className="text-tg-muted text-sm hover:text-white transition-colors">
            Back To Dashboard
          </Link>
        </div>

        {!walletAddress ? (
          <div className="rounded-card bg-tg-gray border border-white/5 p-8 text-center">
            <h2 className="font-display text-xl font-bold mb-2">Connect your wallet</h2>
            <p className="text-tg-muted text-sm mb-6">
              Connect your wallet to load deployment history for this project.
            </p>
            <button
              type="button"
              onClick={handleConnectWallet}
              disabled={walletBusy}
              className="bg-tg-lavender text-tg-black px-6 py-3 rounded-full font-bold text-sm tracking-wide hover:opacity-90 transition-all disabled:opacity-60"
            >
              {walletBusy ? "CONNECTING..." : "CONNECT WALLET"}
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-8 h-8 border-2 border-tg-lavender border-t-transparent rounded-full animate-spin" />
              <span className="text-tg-muted text-sm">Loading project...</span>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-card bg-red-500/10 border border-red-500/20 p-8 text-center">
            <p className="text-red-400 text-sm">{error}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-tg-lavender text-sm hover:underline">
              Back To Dashboard
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {site?.latest && (
              <div className="md:col-span-12 rounded-card bg-tg-lavender p-8 text-tg-black flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-tg-black/60 text-xs font-bold tracking-widest uppercase">Latest Deployment</span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase bg-tg-black/10 text-tg-black">
                      {site.latest.env}
                    </span>
                  </div>
                  <h3 className="font-mono text-xl font-bold break-all">{site.latest.cid}</h3>
                  <p className="text-tg-black/60 text-sm mt-2">{timeStr(site.latest.timestamp)}</p>
                  {site.latest.meta && (
                    <p className="text-tg-black/70 text-sm mt-1 italic">{site.latest.meta}</p>
                  )}
                </div>
                <div className="flex items-center space-x-3 mt-6">
                  <a
                    href={site.latest.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-tg-black text-white px-6 py-3 rounded-full font-bold text-xs tracking-wide hover:opacity-90 transition-all flex items-center space-x-2"
                  >
                    <span>VISIT SITE</span>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <Link href="/deploy">
                    <button className="border border-tg-black/20 text-tg-black px-6 py-3 rounded-full font-bold text-xs tracking-wide hover:bg-tg-black/10 transition-all">
                      REDEPLOY
                    </button>
                  </Link>
                </div>
              </div>
            )}

            <section className="md:col-span-12 rounded-card bg-tg-gray border border-white/5 p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="font-display text-2xl font-bold">Deploy History</h2>
                <span className="text-tg-muted text-xs font-bold tracking-widest uppercase">
                  {site?.count ?? 0} total
                </span>
              </div>

              {!site?.history?.length ? (
                <p className="text-tg-muted text-sm text-center py-8">No deployments found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-tg-muted text-xs font-bold tracking-widest uppercase border-b border-white/5">
                        <th className="pb-4 font-bold">#</th>
                        <th className="pb-4 font-bold">CID</th>
                        <th className="pb-4 font-bold">ENV</th>
                        <th className="pb-4 font-bold">TX</th>
                        <th className="pb-4 font-bold">DEPLOYER</th>
                        <th className="pb-4 font-bold">DATE</th>
                        <th className="pb-4 font-bold text-right">LINK</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {site.history.map((deploy, idx) => (
                        <tr key={deploy.cid + idx} className="group hover:bg-white/5 transition-colors">
                          <td className="py-4 text-tg-muted font-mono text-sm">
                            {site.count - idx}
                          </td>
                          <td className="py-4 font-mono text-sm text-tg-muted">
                            {shortCid(deploy.cid)}
                          </td>
                          <td className="py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase border ${
                              deploy.env === "production"
                                ? "bg-tg-lime/10 text-tg-lime border-tg-lime/20"
                                : "bg-tg-lavender/10 text-tg-lavender border-tg-lavender/20"
                            }`}>
                              {deploy.env}
                            </span>
                          </td>
                          <td className="py-4 font-mono text-xs text-tg-muted">
                            {deploy.txId && deploy.txExplorerUrl ? (
                              <a
                                href={deploy.txExplorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-white transition-colors"
                              >
                                {deploy.txId.slice(0, 10)}...{deploy.txId.slice(-6)}
                              </a>
                            ) : (
                              <span>-</span>
                            )}
                          </td>
                          <td className="py-4 font-mono text-xs text-tg-muted">
                            {deploy.deployer ? `${deploy.deployer.slice(0, 6)}...${deploy.deployer.slice(-4)}` : "-"}
                          </td>
                          <td className="py-4 text-sm text-tg-muted">{timeStr(deploy.timestamp)}</td>
                          <td className="py-4 text-right">
                            <a
                              href={deploy.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 rounded-full border border-white/10 group-hover:bg-tg-lavender group-hover:text-tg-black transition-all inline-flex"
                            >
                              <svg className="w-4 h-4 -rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                              </svg>
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

