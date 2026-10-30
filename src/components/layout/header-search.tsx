"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Recherche repliée derrière une loupe ; un clic déploie le champ par-dessus la ligne de l'en-tête.
 * Sans JavaScript, la loupe reste un bouton d'envoi : elle mène à /recherche.
 */
export function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (open && inputRef.current?.value.trim()) return;
    event.preventDefault();
    if (open) inputRef.current?.focus();
    else setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && open) close();
  }

  // Un clic ou une tabulation hors du champ le replie, sauf s'il contient déjà une saisie.
  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    if (!event.currentTarget.contains(event.relatedTarget) && !inputRef.current?.value.trim()) setOpen(false);
  }

  return (
    <form
      action="/recherche"
      method="get"
      role="search"
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className={cn(
        "flex items-center",
        // Ancrée en bas : la loupe est sur la dernière ligne de l'en-tête (la seule sur grand écran).
        open &&
          "absolute bottom-3 right-4 z-30 h-9 w-[min(24rem,calc(100%-2rem))] rounded-lg bg-white shadow-lg focus-within:ring-2 focus-within:ring-brand-accent",
      )}
    >
      <label htmlFor="recherche-site" className="sr-only">
        Rechercher un produit
      </label>
      <input
        ref={inputRef}
        id="recherche-site"
        type="search"
        name="q"
        placeholder="Produit, marque, référence…"
        hidden={!open}
        // Focus signalé par l'anneau de la barre (« ! » : la règle :focus-visible globale est hors couche) ;
        // croix native masquée, « Fermer la recherche » la remplace.
        className="h-full min-w-0 flex-1 rounded-l-lg px-3 text-sm text-ink focus-visible:outline-none! [&::-webkit-search-cancel-button]:appearance-none"
      />
      {open && (
        <button
          type="button"
          onClick={close}
          className="grid size-9 place-items-center text-ink-muted hover:text-ink"
          aria-label="Fermer la recherche"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
      <button
        ref={toggleRef}
        type="submit"
        aria-expanded={open}
        aria-controls="recherche-site"
        aria-label={open ? "Lancer la recherche" : "Rechercher"}
        title={open ? "Lancer la recherche" : "Rechercher"}
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md",
          open ? "rounded-l-none bg-brand-accent text-brand-navy" : "text-white/90 hover:bg-white/10",
        )}
      >
        <Search aria-hidden className="size-5" />
      </button>
    </form>
  );
}
