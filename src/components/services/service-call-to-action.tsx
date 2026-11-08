import Link from "next/link";
import { PaymentMethodIcons } from "@/components/brand/payment-method-icons";
import { primaryActionClass, secondaryActionClass } from "@/components/services/service-action-styles";
import { ACCEPTED_PAYMENT_METHODS } from "@/lib/payment-methods";

/** Fin des pages de services : demande de devis, contact et moyens de règlement. */
export function ServiceCallToAction() {
  return (
    <section aria-labelledby="service-appel-action" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <h2 id="service-appel-action" className="text-lg font-semibold">
        Un besoin, une question ?
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/devis/demande" className={primaryActionClass}>
          Demander un devis
        </Link>
        <Link href="/contact" className={secondaryActionClass}>
          Nous contacter
        </Link>
      </div>
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <PaymentMethodIcons />
        Règlement {ACCEPTED_PAYMENT_METHODS}, après la prestation.
      </p>
    </section>
  );
}
