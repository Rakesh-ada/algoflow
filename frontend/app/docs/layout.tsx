import type { ReactNode } from "react";
import Navbar from "@/components/navbar";
import DocsSidebar from "@/components/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-tg-black text-white font-sans antialiased p-6 md:p-12">
      <main className="max-w-7xl mx-auto space-y-6">
        <Navbar />

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <aside className="md:col-span-3 rounded-card bg-tg-gray border border-white/5 p-5 h-fit md:sticky md:top-8">
            <h2 className="font-display text-sm font-bold tracking-widest uppercase mb-4 text-tg-lavender">
              Documentation
            </h2>
            <DocsSidebar />
          </aside>

          <section className="md:col-span-9 rounded-card bg-tg-gray border border-white/5 p-6 md:p-8">
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}

