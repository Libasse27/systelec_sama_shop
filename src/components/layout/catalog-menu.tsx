"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

/** Délai avant fermeture quand la souris quitte le menu : laisse franchir l'espace entre « Catalogue » et la liste. */
const CLOSE_DELAY_MS = 150;

/** Entrée du menu : adresse calculée côté serveur (seules des valeurs sérialisables traversent la frontière). */
export interface CatalogMenuItem {
  key: string;
  href: string;
  name: string;
}

interface CatalogMenuViewProps {
  /** Libellé du bouton (« Catalogue » sur FUTANI SHOP, « Services » sur FUTANI TECH). */
  label: string;
  items: readonly CatalogMenuItem[];
  /** Dernier lien du menu, mis en valeur (« Tous les produits », « Tous les services »). */
  allLink: { href: string; label: string };
  /** Classes du lien de navigation, fournies par l'en-tête pour ne pas dupliquer la constante. */
  linkClass: string;
}

/**
 * Menu des familles (produits ou services) : <details> natif (utilisable sans JavaScript).
 * Avec JavaScript, il s'ouvre aussi au survol de la souris ; le clavier et le tactile gardent le comportement natif.
 */
export function CatalogMenuView({ label, items, allLink, linkClass }: CatalogMenuViewProps) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Dernier pointeur utilisé sur le summary, et ouverture obtenue par survol (pas par clic).
  const lastPointerType = useRef<string>("");
  const openedByHover = useRef(false);

  const cancelClose = () => clearTimeout(closeTimer.current);

  const close = () => {
    cancelClose();
    openedByHover.current = false;
    setOpen(false);
  };

  // Minuteur nettoyé au démontage.
  useEffect(() => cancelClose, []);

  // Clic à l'extérieur : écouteur présent seulement tant que le menu est ouvert.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node) || detailsRef.current?.contains(event.target)) return;
      clearTimeout(closeTimer.current);
      openedByHover.current = false;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    if (!open) {
      openedByHover.current = true;
      setOpen(true);
    }
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    // Menu ouvert au clavier : un passage de souris ne doit pas lui retirer le focus. Ouvert par survol : il se ferme.
    if (!openedByHover.current && detailsRef.current?.querySelector(":focus-visible")) return;
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  };

  const onSummaryClick = (event: MouseEvent) => {
    // Souris ouverte par survol : le clic ne referme pas. Clavier (detail 0) et tactile : comportement natif.
    if (lastPointerType.current === "mouse" && event.detail > 0 && openedByHover.current) {
      event.preventDefault();
      openedByHover.current = false;
      return;
    }
    openedByHover.current = false;
  };

  return (
    <details
      ref={detailsRef}
      open={open}
      className="group relative"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onBlur={(event) => {
        // Focus parti ailleurs dans la page (Tab) ; relatedTarget nul (fenêtre quittée, clic) : le menu ne change pas.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        close();
        summaryRef.current?.focus();
      }}
    >
      <summary
        ref={summaryRef}
        className={`${linkClass} flex cursor-pointer list-none items-center gap-1`}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType;
        }}
        onClick={onSummaryClick}
      >
        {label}
        <ChevronDown aria-hidden className="size-4 transition group-open:rotate-180" />
      </summary>
      <ul className="absolute left-0 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 text-ink shadow-lg">
        {items.map((item) => (
          <li key={item.key}>
            <Link href={item.href} onClick={close} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
              {item.name}
            </Link>
          </li>
        ))}
        <li>
          <Link href={allLink.href} onClick={close} className="block rounded-lg px-3 py-2 text-sm font-medium text-brand-blue hover:bg-surface-muted">
            {allLink.label}
          </Link>
        </li>
      </ul>
    </details>
  );
}
