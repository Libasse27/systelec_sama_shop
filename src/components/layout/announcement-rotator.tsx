"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

const buttonClass = "grid size-7 shrink-0 place-items-center rounded-md hover:bg-brand-navy/10 focus-visible:outline-2 focus-visible:outline-brand-navy";

/**
 * Fait défiler les annonces (déjà rendues côté serveur) : une seule est affichée à la fois, la première
 * dès le rendu serveur. Le défilement s'arrête au survol et au focus, et n'a pas lieu si l'utilisateur
 * préfère les animations réduites (il garde les boutons précédent / suivant).
 */
export function AnnouncementRotator({ slides, rotationSeconds }: { slides: readonly React.ReactNode[]; rotationSeconds: number }) {
  const [index, setIndex] = useState(0);
  // Survol (souris) et focus clavier suivis séparément : un clic souris sur un bouton ne doit pas figer le défilement.
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const paused = hovered || keyboardFocus;
  const [reducedMotion, setReducedMotion] = useState(false);
  const count = slides.length;
  // Si la liste raccourcit entre deux rendus, l'index reste valide.
  const current = index % Math.max(count, 1);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (count < 2 || paused || reducedMotion) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), rotationSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [count, paused, reducedMotion, rotationSeconds]);

  const step = (delta: number) => setIndex((current + delta + count) % count);

  return (
    <div
      className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-1.5"
      onPointerEnter={(event) => setHovered(event.pointerType !== "touch")}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => setKeyboardFocus(event.target.matches(":focus-visible"))}
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
    </div>
  );
}
