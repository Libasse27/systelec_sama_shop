import type { BrandIconName } from "@/components/brand/brand-icon";

/** Réseaux administrables (paramètres « company », champ socialLinks), dans leur ordre d'affichage. */
const SOCIAL_NETWORKS = [
  { network: "facebook", label: "Facebook", icon: "facebook" },
  { network: "instagram", label: "Instagram", icon: "instagram" },
  { network: "linkedin", label: "LinkedIn", icon: "linkedin" },
  { network: "tiktok", label: "TikTok", icon: "tiktok" },
  { network: "youtube", label: "YouTube", icon: "youtube" },
  { network: "x", label: "X (Twitter)", icon: "x" },
] as const satisfies readonly { network: string; label: string; icon: BrandIconName }[];

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["network"];

/** Liens enregistrés par réseau (null : non renseigné). */
export type SocialLinks = Record<SocialNetwork, string | null>;

export interface SocialProfile {
  network: SocialNetwork;
  label: string;
  icon: BrandIconName;
  href: string;
}

interface NetworkRules {
  /** Domaines officiels acceptés, comparés exactement (jamais « se termine par » : evilfacebook.com reste refusé). */
  hosts: readonly string[];
  /** Sous-domaines acceptés en plus (ex. LinkedIn par pays : sn.linkedin.com). */
  hostPattern?: RegExp;
  /** Chemins de redirection ou de connexion du réseau lui-même (segments entiers, en minuscules). */
  redirectPaths?: readonly string[];
}

/**
 * Domaines officiels par réseau. Liens raccourcis et redirections refusés (destination cachée) ;
 * youtu.be est accepté : domaine officiel de partage de YouTube, il ne sert qu'à Google.
 */
const NETWORK_RULES: Record<SocialNetwork, NetworkRules> = {
  facebook: {
    hosts: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "business.facebook.com", "fb.com", "www.fb.com"],
    redirectPaths: ["/l.php", "/flx", "/login", "/login.php", "/dialog", "/sharer", "/sharer.php"],
  },
  instagram: { hosts: ["instagram.com", "www.instagram.com", "instagr.am", "www.instagr.am"], redirectPaths: ["/accounts"] },
  linkedin: { hosts: ["linkedin.com", "www.linkedin.com"], hostPattern: /^[a-z]{2}\.linkedin\.com$/, redirectPaths: ["/redir", "/safety/go", "/authwall"] },
  tiktok: { hosts: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"] },
  youtube: { hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"], redirectPaths: ["/redirect", "/attribution_link"] },
  x: { hosts: ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"], redirectPaths: ["/i/redirect"] },
};

/** Liens raccourcis ou de redirection des réseaux : refusés avec un message dédié (copier l'adresse complète). */
const SHORTLINK_HOSTS = new Set(["fb.me", "on.fb.me", "l.facebook.com", "lm.facebook.com", "fb.watch", "l.instagram.com", "ig.me", "lnkd.in", "vm.tiktok.com", "vt.tiktok.com", "t.co"]);

export type SocialUrlIssue = "invalid" | "not-https" | "credentials" | "port" | "shortlink" | "host" | "redirect" | "no-path";

/**
 * Contrôle d'une adresse de profil (saisie ET affichage) : https complet, sans identifiants ni port,
 * domaine officiel du réseau (point final ignoré, majuscules ramenées par l'analyseur d'URL), et
 * chemin menant à une page (pas l'accueil du réseau). Renvoie null si l'adresse est acceptée.
 */
export function checkSocialUrl(network: SocialNetwork, value: string): SocialUrlIssue | null {
  if (!value.startsWith("https://")) return "not-https";
  // Espaces et caractères de contrôle : l'analyseur d'URL les retire, l'adresse publiée serait la valeur brute.
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return "invalid";
  const url = URL.parse(value);
  if (url === null || url.protocol !== "https:" || url.hostname === "") return "invalid";
  if (url.username !== "" || url.password !== "") return "credentials";
  if (url.port !== "") return "port";
  const host = url.hostname.replace(/\.$/, "");
  if (SHORTLINK_HOSTS.has(host)) return "shortlink";
  const rules = NETWORK_RULES[network];
  if (!rules.hosts.includes(host) && !rules.hostPattern?.test(host)) return "host";
  const path = normalizedPath(url.pathname);
  if (path === null) return "invalid";
  if (rules.redirectPaths?.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return "redirect";
  // Une adresse de profil ne transporte jamais une autre adresse (u=, next=, redirect_uri=…).
  if ([...url.searchParams.values()].some((param) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(param.trim()))) return "redirect";
  if (path === "/" || path === "") return "no-path";
  return null;
}

/** Chemin tel que le serveur du réseau le comprend : décodé, en minuscules, « // » ramenés à « / » (null si illisible). */
function normalizedPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname).toLowerCase().replace(/\/{2,}/g, "/");
  } catch {
    return null;
  }
}

const labelOf = (network: SocialNetwork): string => SOCIAL_NETWORKS.find((item) => item.network === network)!.label;

/** Message affiché sous le champ (administration). */
export function socialUrlMessage(network: SocialNetwork, issue: SocialUrlIssue): string {
  const label = labelOf(network);
  switch (issue) {
    case "not-https":
      return `Lien ${label} : l'adresse doit commencer par https://.`;
    case "credentials":
      return `Lien ${label} : identifiant ou mot de passe interdits dans l'adresse.`;
    case "port":
      return `Lien ${label} : l'adresse ne doit pas préciser de port.`;
    case "shortlink":
      return `Lien ${label} : les liens raccourcis ou de redirection ne sont pas acceptés. Ouvrez-le et copiez l'adresse complète depuis votre navigateur.`;
    case "host":
      return `Lien ${label} : cette adresse n'appartient pas au domaine officiel de ${label}.`;
    case "redirect":
      return `Lien ${label} : les adresses de redirection ne sont pas acceptées.`;
    case "no-path":
      return `Lien ${label} : l'adresse doit mener à votre page ou profil, pas à l'accueil de ${label}.`;
    case "invalid":
      return `Lien ${label} : adresse invalide.`;
  }
}

/** Profils à afficher : seulement les réseaux dont l'adresse est saisie et acceptée (une ancienne valeur non conforme est écartée). */
export function socialProfiles(links: Readonly<SocialLinks>): SocialProfile[] {
  return SOCIAL_NETWORKS.flatMap(({ network, label, icon }) => {
    const href = links[network];
    return href && checkSocialUrl(network, href) === null ? [{ network, label, icon, href }] : [];
  });
}

/** Raison pour laquelle un lien enregistré n'est pas affiché (null : vide ou conforme). */
export function hiddenSocialLinkMessage(network: SocialNetwork, href: string | null): string | null {
  const issue = href ? checkSocialUrl(network, href) : null;
  return issue ? socialUrlMessage(network, issue) : null;
}

/** Liens enregistrés mais non affichés (non conformes aux règles actuelles), pour avertir dans l'administration. */
export function hiddenSocialLinks(links: Readonly<SocialLinks>): { network: SocialNetwork; message: string }[] {
  return SOCIAL_NETWORKS.flatMap(({ network }) => {
    const message = hiddenSocialLinkMessage(network, links[network]);
    return message ? [{ network, message }] : [];
  });
}

export interface SocialLinksReview {
  /** Liens à enregistrer : saisis et conformes, ou anciens liens laissés inchangés (conservés tels quels). */
  links: SocialLinks;
  /** Erreurs par champ du formulaire (« socialLinks.facebook »…), vides si tout est accepté. */
  fieldErrors: Record<string, string[]>;
}

/**
 * Contrôle des liens SAISIS face aux liens ENREGISTRÉS. Un lien modifié doit respecter les règles
 * actuelles ; un lien laissé tel quel est conservé même s'il ne les respecte plus (donnée historique :
 * jamais supprimée ni remplacée automatiquement, toujours masquée sur le site et signalée dans
 * l'administration). Vider un champ efface le lien. Ainsi un ancien lien non conforme ne bloque jamais
 * l'enregistrement des autres informations, et chaque lien se corrige individuellement.
 */
export function reviewSocialLinksInput(submitted: Readonly<SocialLinks>, stored: Readonly<SocialLinks>): SocialLinksReview {
  const reviewed = SOCIAL_NETWORKS.map(({ network }) => {
    const value = submitted[network];
    const previous = stored[network];
    if (value === null) return { network, value: null, error: null };
    // Le formulaire renvoie la valeur affichée, sans espaces autour : comparée à l'ancienne valeur nettoyée.
    if (previous !== null && (value === previous || value === previous.trim())) return { network, value: previous, error: null };
    const issue = checkSocialUrl(network, value);
    return { network, value, error: issue ? socialUrlMessage(network, issue) : null };
  });
  return {
    links: Object.fromEntries(reviewed.map(({ network, value }) => [network, value])) as SocialLinks,
    fieldErrors: Object.fromEntries(reviewed.flatMap(({ network, error }) => (error ? [[`socialLinks.${network}`, [error]]] : []))),
  };
}
