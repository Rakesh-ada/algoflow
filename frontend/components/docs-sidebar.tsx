"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsPages } from "@/lib/docs";

export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="space-y-2">
      <Link
        href="/docs"
        className={`block rounded-2xl px-4 py-2 text-sm font-medium transition-colors ${
          pathname === "/docs"
            ? "bg-tg-lavender text-tg-black"
            : "text-tg-muted hover:text-white hover:bg-white/5"
        }`}
      >
        Overview
      </Link>
      {docsPages.map((page) => {
        const href = `/docs/${page.slug}`;
        const active = pathname === href;

        return (
          <Link
            key={page.slug}
            href={href}
            className={`block rounded-2xl px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-tg-lavender text-tg-black"
                : "text-tg-muted hover:text-white hover:bg-white/5"
            }`}
          >
            {page.title}
          </Link>
        );
      })}
    </nav>
  );
}

