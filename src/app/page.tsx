import { Banknote, Cctv, Cpu, Network, PlugZap, Wrench } from "lucide-react";
import { getSetting } from "@/server/modules/settings/service";

// Les paramètres administrables sont lus à chaque requête.
export const dynamic = "force-dynamic";

const UNIVERSES = [
  { label: "Informatique", icon: Cpu },
  { label: "Réseaux et télécoms", icon: Network },
  { label: "Vidéosurveillance et sécurité", icon: Cctv },
  { label: "Électricité et énergie", icon: PlugZap },
  { label: "Services techniques", icon: Wrench },
] as const;

export default async function HomePage() {
  const company = await getSetting("company");

  return (
    <>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="rounded-2xl bg-brand-navy px-6 py-10 text-white sm:px-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-accent">Boutique en préparation</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{company.shopName}</h1>
          <p className="mt-3 max-w-2xl text-white/80">
            Équipements informatiques, réseaux, électronique, électricité et sécurité, ainsi que des services de
            maintenance, d&apos;installation réseau, de vidéosurveillance et d&apos;électricité.
          </p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
            <Banknote aria-hidden className="size-4 text-brand-accent" />
            Paiement exclusivement en espèces, à la livraison ou au retrait.
          </p>
        </section>

        <section aria-labelledby="univers" className="mt-10">
          <h2 id="univers" className="text-xl font-semibold">
            Nos univers
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {UNIVERSES.map(({ label, icon: Icon }) => (
              <li key={label} className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-4">
                <Icon aria-hidden className="size-6 text-brand-blue" />
                <span className="text-sm font-medium">{label}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
