import Link from "next/link";
import Navbar from "@/components/navbar";

export default function Home() {
  return (
    <div className="min-h-screen bg-tg-black text-white font-sans antialiased p-6 md:p-12">
      <main className="max-w-7xl mx-auto space-y-6">
        {/* Top Navigation */}
        <Navbar />

        {/* ── Hero Bento Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">

          {/* Hero Card */}
          <section className="md:col-span-8 rounded-card bg-tg-lavender p-8 md:p-12 flex flex-col justify-between h-100 text-tg-black transition-transform duration-200 hover:-translate-y-0.5">
            <div>
              <h1 className="font-display text-3xl md:text-5xl font-extrabold leading-tight tracking-tighter">
                Build Your First<br />dApp
              </h1>
              <p className="mt-4 text-base font-medium opacity-80 max-w-md">
                Create simple HTML/CSS/JS Web3 sites with wallet connect,
                smart-contract interactions, and transaction flows, then deploy
                to IPFS in minutes.
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/login">
                <button className="bg-tg-black text-white px-8 py-4 rounded-full font-bold text-sm tracking-wide flex items-center space-x-2 hover:opacity-90 transition-all">
                  <span>BUILD YOUR FIRST DAPP</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </button>
              </Link>
              <Link href="/dashboard">
                <button className="border border-tg-black/30 text-tg-black px-6 py-4 rounded-full font-bold text-sm tracking-wide hover:bg-tg-black/10 transition-all">
                  DASHBOARD
                </button>
              </Link>
            </div>
          </section>

          {/* Feature Card – IPFS */}
          <div className="md:col-span-4 rounded-card bg-tg-gray p-8 border border-white/5 flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5">
            <div className="w-40 h-40 rounded-3xl bg-tg-lavender/10 border border-tg-lavender/20 flex items-center justify-center">
              <svg className="w-36 h-36 text-tg-lavender" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <h3 className="font-display text-xl font-bold mb-2">IPFS Hosting</h3>
              <p className="text-tg-muted text-sm leading-relaxed">
                Every deployment is content-addressed and pinned to IPFS. Your
                site lives forever — no single point of failure.
              </p>
            </div>
          </div>

          {/* Feature Card – GitHub CI/CD */}
          <div className="md:col-span-4 rounded-card bg-tg-lime p-8 flex flex-col justify-between text-tg-black transition-transform duration-200 hover:-translate-y-0.5">
            <div className="w-12 h-12 rounded-2xl bg-tg-black/10 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-tg-black" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="5" r="2" strokeWidth={2} />
                <circle cx="6" cy="12" r="2" strokeWidth={2} />
                <circle cx="18" cy="12" r="2" strokeWidth={2} />
                <circle cx="9" cy="19" r="2" strokeWidth={2} />
                <circle cx="15" cy="19" r="2" strokeWidth={2} />
                <path d="M10.3 6.5L7.7 10.5M13.7 6.5l2.6 4M8 13.8l.8 3M16 13.8l-.8 3M11 19h2" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="font-display text-xl font-bold mb-2">Web3 Starter Flow</h3>
              <p className="text-tg-black/70 text-sm leading-relaxed">
                Start from a clean dApp template with wallet connect and
                contract calls ready, then customize and deploy.
              </p>
            </div>
          </div>

          {/* Feature Card – Native MCP */}
          <div className="md:col-span-4 rounded-card bg-tg-gray p-8 border border-white/5 flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M4 6h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-display text-xl font-bold mb-2">Native MCP Server</h3>
              <p className="text-tg-muted text-sm leading-relaxed">
                Connect your IDE to ALGOFLOW via MCP and let AI instantly spin up previews and deploy.
              </p>
            </div>
          </div>

          {/* Feature Card – Deployment History */}
          <div className="md:col-span-4 rounded-card bg-tg-lavender p-8 flex flex-col justify-between text-tg-black transition-transform duration-200 hover:-translate-y-0.5">
            <div className="w-12 h-12 rounded-2xl bg-tg-black/10 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-tg-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="font-display text-xl font-bold mb-2">Wallet + Contract Ready</h3>
              <p className="text-tg-black/70 text-sm leading-relaxed">
                Add MetaMask, send transactions, and connect to multiple
                smart contracts from a static site hosted on IPFS.
              </p>
            </div>
          </div>

          {/* How It Works */}
          <section className="md:col-span-12 rounded-card bg-tg-gray border border-white/5 p-8 md:p-12">
            <h2 className="font-display text-3xl font-bold mb-10">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  step: "01",
                  title: "Pick your dApp starter",
                  desc: "Start from a simple static template designed for wallet connection and contract interaction.",
                },
                {
                  step: "02",
                  title: "Connect wallet + contracts",
                  desc: "Configure chain IDs, contract addresses, and ABIs to power real on-chain actions.",
                },
                {
                  step: "03",
                  title: "Deploy to IPFS",
                  desc: "Publish instantly to IPFS and keep immutable versions so your dApp can be shared anywhere.",
                },
              ].map(({ step, title, desc }) => (
                <div key={step} className="space-y-4">
                  <div className="font-display text-5xl font-extrabold text-white/10">
                    {step}
                  </div>
                  <h3 className="font-display text-lg font-bold">{title}</h3>
                  <p className="text-tg-muted text-sm leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA Card */}
          <section className="md:col-span-12 rounded-card bg-tg-black border border-tg-lavender/20 p-8 md:p-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 className="font-display text-3xl font-bold">
                Ready to deploy with agents?
              </h2>
              <p className="text-tg-muted mt-2 text-sm">
                Connect your GitHub or chat with your IDE MCP and ship your first decentralised site in
                under 2 minutes.
              </p>
            </div>
            <div className="flex items-center space-x-4 shrink-0">
              <Link href="/mcp">
                <button className="bg-tg-lavender text-tg-black px-8 py-4 rounded-full font-bold text-sm tracking-wide hover:opacity-90 transition-all font-display">
                  CONNECT NOW {""}
                </button>
              </Link>
            </div>
          </section>
        </div>

        {/* Footer */}
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
