interface LogoProps {
  shopName: string;
  logoUrl: string | null;
}

/** Logo administrable ; à défaut, logo typographique provisoire. */
export function Logo({ shopName, logoUrl }: LogoProps) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- URL administrable, domaine inconnu à la compilation
    return <img src={logoUrl} alt={shopName} className="h-9 w-auto" />;
  }
  const [brand, ...rest] = shopName.split(" ");
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight" aria-label={shopName}>
      <span aria-hidden className="grid size-8 place-items-center rounded-md bg-brand-blue text-sm text-white">
        {shopName.charAt(0).toUpperCase()}
      </span>
      <span className="text-lg text-white">
        {brand}
        {rest.length > 0 && <span className="ml-1 font-semibold text-brand-accent">{rest.join(" ")}</span>}
      </span>
    </span>
  );
}
