"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

const buttonClass = "grid size-7 shrink-0 place-items-center rounded-md hover:bg-brand-navy/10 focus-visible:outline-2 focus-visible:outline-brand-navy";
/** Bouton Pause / Reprendre : le focus clavier posé dessus ne doit pas, à lui seul, figer le défilement. */
const TOGGLE_ATTRIBUTE = "data-rotation-toggle";

/**
 * Fait défiler les annonces (déjà rendues côté serveur) : une seule est affichée à la fois, la première
 * dès le rendu serveur. Le défilement s'arrête au survol de la souris, au focus clavier dans le bandeau
 * et avec le bouton Pause (WCAG 2.2.2, utilisable au toucher et au clavier). Il n'a pas lieu si
 * l'utilisateur préfère les animations réduites : seuls les boutons précédent / suivant restent alors.
 */
export function AnnouncementRotator({ slides, rotationSeconds }: { slides: readonly React.ReactNode[]; rotationSeconds: number }) {
  const [index, setIndex] = useState(0);
  // Survol (souris) et focus clavier suivis séparément : un clic souris sur un bouton ne doit pas figer le défilement.
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  // Choix explicite de la personne (bouton Pause / Reprendre), prioritaire et durable.
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const paused = userPaused || hovered || keyboardFocus;
  const count = slides.length;
  const rotates = count > 1 && !reducedMotion;
  // Si la liste raccourcit entre deux rendus, l'index reste valide.
  const current = index % Math.max(count, 1);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Repart à chaque changement d'annonce (y compris manuel) : une annonce choisie reste affichée une période entière.
  useEffect(() => {
    if (!rotates || paused) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % count), rotationSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [count, current, paused, rotates, rotationSeconds]);

  const step = (delta: number) => setIndex((current + delta + count) % count);

  return (
    <div
      className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-1.5"
      onPointerEnter={(event) => setHovered(event.pointerType !== "touch")}
      onPointerLeave={() => setHovered(false)}
      // Geste interrompu (défilement de la page, appel système…) : pointerleave peut ne jamais arriver.
      onPointerCancel={() => setHovered(false)}
      onFocus={(event) => setKeyboardFocus(event.target.matches(":focus-visible") && !event.target.hasAttribute(TOGGLE_ATTRIBUTE))}
      onBlur={(event) => {
        // Le focus reste dans le bandeau : rien à changer.
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setKeyboardFocus(false);
      }}
    >
      {count > 1 && (
        <button type="button" className={buttonClass} aria-label="Annonce précédente" onClick={() => step(-1)}>
          <ChevronLeft aria-hidden className="size-4" />
        </button>
      )}
      <div aria-live="off" className="min-w-0 text-center">
        {slides[current]}
      </div>
      {count > 1 && (
        <button type="button" className={buttonClass} aria-label="Annonce suivante" onClick={() => step(1)}>
          <ChevronRight aria-hidden className="size-4" />
        </button>
      )}
      {rotates && (
        <button
          type="button"
          // Masqué d'emblée par CSS pour les animations réduites : pas d'apparition fugace avant l'hydratation.
          className={`${buttonClass} motion-reduce:hidden`}
          {...{ [TOGGLE_ATTRIBUTE]: "" }}
          aria-label={userPaused ? "Reprendre le défilement des annonces" : "Mettre en pause le défilement des annonces"}
          onClick={() => setUserPaused((value) => !value)}
        >
          {userPaused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
        </button>
      )}
    </div>
  );
}
