"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isAdminPath } from "@/lib/routes";

/** Marge après l'échéance : le serveur doit déjà considérer l'annonce comme commencée ou terminée. */
const MARGIN_MS = 1_000;
/** Étalement aléatoire : les onglets ouverts ne redemandent pas tous la page à la même milliseconde. */
const JITTER_MS = 2_000;
/** Plancher : jamais de rafraîchissements en rafale. */
const MIN_DELAY_MS = 2_000;
/** Limite de setTimeout (environ 24,8 jours) : au-delà, un rafraîchissement intermédiaire recalcule le délai. */
const MAX_DELAY_MS = 2_147_483_647;

/**
 * Redemande le rendu serveur de la page (dont le bandeau) quand une annonce commence ou se termine.
 * Le délai vient du serveur, mesuré au moment du rendu ; le composant est remonté à chaque rendu serveur
 * (clé fournie par le parent), donc le minuteur repart toujours du délai le plus récent.
 * Toujours monté (y compris sous /admin, où le bandeau est masqué) : l'échéance continue de courir ;
 * atteinte dans le back-office, le rafraîchissement est reporté au retour sur la boutique (jamais
 * pendant une saisie d'administration).
 * Minuteurs ralentis (onglet en arrière-plan, mise en veille, retour arrière depuis le cache du
 * navigateur) : l'échéance est revérifiée au retour sur la page.
 * Hypothèse : la mise en page racine est rendue dynamiquement (en-tête lié à la session) ; une page
 * mise en cache statiquement figerait ce délai.
 */
export function AnnouncementRefresh({ delayMs }: { delayMs: number }) {
  const router = useRouter();
  const isAdmin = isAdminPath(usePathname());
  const [due, setDue] = useState(false);
  const refreshed = useRef(false);

  useEffect(() => {
    const wait = Math.min(Math.max(delayMs + MARGIN_MS + Math.random() * JITTER_MS, MIN_DELAY_MS), MAX_DELAY_MS);
    const deadline = Date.now() + wait;
    const timer = window.setTimeout(() => setDue(true), wait);
    const checkDeadline = () => {
      if (document.visibilityState === "visible" && Date.now() >= deadline) setDue(true);
    };
    document.addEventListener("visibilitychange", checkDeadline);
    window.addEventListener("pageshow", checkDeadline);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkDeadline);
      window.removeEventListener("pageshow", checkDeadline);
    };
  }, [delayMs]);

  useEffect(() => {
    if (!due || isAdmin || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [due, isAdmin, router]);

  return null;
}
