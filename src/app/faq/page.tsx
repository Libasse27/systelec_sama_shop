import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { db } from "@/server/db/client";
import { listFaq } from "@/server/modules/content/queries";

export const metadata: Metadata = {
  title: "Questions fréquentes",
  description: "Commande, paiement en espèces, livraison, retrait et garanties : nos réponses.",
  alternates: { canonical: "/faq" },
};

export default async function FaqPage() {
  const items = await listFaq(db);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs items={[{ label: "Questions fréquentes", href: "/faq" }]} />
      <h1 className="text-2xl font-bold">Questions fréquentes</h1>
      {items.length === 0 ? (
        <p className="text-ink-muted">
          Les réponses arrivent bientôt. Une question ?{" "}
          <Link href="/contact" className="text-brand-blue underline">
            Contactez-nous
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, i) => (
            <details key={`${i}-${item.question}`} className="rounded-xl border border-line bg-surface p-4">
              <summary className="cursor-pointer font-medium">{item.question}</summary>
              <p className="mt-2 text-ink-muted">{item.answer}</p>
            </details>
          ))}
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: items.map((item) => ({
                "@type": "Question",
                name: item.question,
                acceptedAnswer: { "@type": "Answer", text: item.answer },
              })),
            }}
          />
        </div>
      )}
    </main>
  );
}
