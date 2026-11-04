import { BrandIcon } from "@/components/brand/brand-icon";
import { PAYMENT_METHOD_ICONS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/payment-methods";

/** Pictogramme d'un moyen de paiement ; décoratif, le texte voisin porte le sens. */
export function PaymentMethodIcon({ method }: { method: PaymentMethod }) {
  const { name, sizeClass } = PAYMENT_METHOD_ICONS[method];
  return <BrandIcon name={name} className={sizeClass} />;
}

/** Les pictogrammes de tous les moyens acceptés, à côté d'une mention de paiement. */
export function PaymentMethodIcons() {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {PAYMENT_METHODS.map((method) => (
        <PaymentMethodIcon key={method} method={method} />
      ))}
    </span>
  );
}
