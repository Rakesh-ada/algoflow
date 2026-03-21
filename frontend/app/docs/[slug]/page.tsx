import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { docsPages, getDocsPage } from "@/lib/docs";

type DocsPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return docsPages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: DocsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocsPage(slug);

  if (!page) {
    return {
      title: "Docs Not Found",
    };
  }

  return {
    title: `${page.title} | ALGOFLOW Docs`,
    description: page.description,
  };
}

export default async function DocsDetailPage({ params }: DocsPageProps) {
  const { slug } = await params;
  const page = getDocsPage(slug);

  if (!page) {
    notFound();
  }

  return (
    <article className="space-y-8">
      <header className="space-y-3 border-b border-white/10 pb-6">
        <p className="text-xs font-bold tracking-widest uppercase text-tg-lavender">ALGOFLOW Docs</p>
        <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight">{page.title}</h1>
        <p className="text-tg-muted text-sm md:text-base max-w-3xl">{page.description}</p>
        <p className="text-xs text-tg-muted">Last updated: {page.updatedAt}</p>
      </header>

      {page.sections.map((section) => (
        <section key={section.id} id={section.id} className="space-y-4">
          <h2 className="font-display text-2xl font-bold">{section.title}</h2>

          {section.paragraphs?.map((paragraph, index) => (
            <p key={index} className="text-sm md:text-base leading-relaxed text-white/90">
              {paragraph}
            </p>
          ))}

          {section.steps && (
            <ol className="space-y-2">
              {section.steps.map((step, index) => (
                <li key={index} className="text-sm md:text-base text-white/90 leading-relaxed">
                  <span className="text-tg-lavender font-bold mr-2">{String(index + 1).padStart(2, "0")}.</span>
                  {step}
                </li>
              ))}
            </ol>
          )}

          {section.bullets && (
            <ul className="space-y-2">
              {section.bullets.map((item, index) => (
                <li key={index} className="text-sm md:text-base text-white/90 leading-relaxed">
                  <span className="text-tg-lime mr-2">•</span>
                  {item}
                </li>
              ))}
            </ul>
          )}

          {section.codeBlocks?.map((block, index) => (
            <div key={index} className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
                <span className="text-xs font-bold tracking-wide text-tg-muted">
                  {block.label || "Example"}
                </span>
                <span className="text-xs text-tg-lavender uppercase">{block.language}</span>
              </div>
              <pre className="p-4 text-xs md:text-sm overflow-x-auto">
                <code>{block.code}</code>
              </pre>
            </div>
          ))}

          {section.callout && (
            <div className="rounded-2xl border border-tg-lavender/30 bg-tg-lavender/10 px-4 py-3 text-sm text-white/90">
              {section.callout}
            </div>
          )}
        </section>
      ))}
    </article>
  );
}

