import Link from "next/link";
import { docsPages } from "@/lib/docs";

export default function DocsHomePage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs font-bold tracking-widest uppercase text-tg-lavender">ALGOFLOW Docs</p>
        <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight">
          Build and deploy static Web3 apps with confidence
        </h1>
        <p className="text-tg-muted text-sm md:text-base max-w-3xl">
          These guides cover the complete ALGOFLOW workflow: architecture, MCP setup, deployment, wallet integration,
          and operations.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {docsPages.map((page) => (
          <Link
            key={page.slug}
            href={`/docs/${page.slug}`}
            className="rounded-2xl border border-white/10 bg-black/20 p-5 transition-colors hover:border-tg-lavender/40 hover:bg-black/30"
          >
            <h2 className="font-display text-lg font-bold text-white">{page.title}</h2>
            <p className="mt-2 text-sm text-tg-muted leading-relaxed">{page.description}</p>
            <span className="mt-4 inline-flex text-xs font-semibold text-tg-lavender">Read guide {"->"}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
