/**
 * Identité FUTANI : groupe (institutionnel), boutique (commercial) et pôle technique.
 * Source unique des noms et textes de marque. Les coordonnées, la raison sociale, le NINEA et le RCCM
 * n'en font pas partie : ils se saisissent dans l'administration (paramètres « company »).
 */
export const BRAND = {
  group: {
    name: "FUTANI GROUP",
    shortName: "FUTANI",
    signature: "Deux héritages, une vision d'avenir.",
  },
  shop: {
    name: "FUTANI SHOP",
    tagline: "La boutique officielle de FUTANI GROUP.",
    pillars: ["Commerce", "Technologie", "Services"],
  },
  tech: {
    name: "FUTANI TECH",
    description: "le pôle informatique, maintenance et assistance technique de FUTANI GROUP",
  },
} as const;

/** « Commerce · Technologie · Services » */
export const SHOP_PILLARS_LINE = BRAND.shop.pillars.join(" · ");

/** Présentation institutionnelle (texte validé), un paragraphe par entrée. */
export const GROUP_PRESENTATION: readonly string[] = [
  "FUTANI GROUP est un groupe entrepreneurial africain fondé sur une vision ambitieuse : rapprocher le commerce, la technologie et les services professionnels.",
  "Inspiré de deux héritages culturels, le Fouta sénégalais et le monde soninké du Mali, FUTANI porte une identité qui associe tradition, innovation et ouverture internationale.",
  "Notre ambition est de proposer des produits et des solutions de qualité, d'accompagner les particuliers et les entreprises dans leurs projets et de contribuer activement au développement économique et numérique de l'Afrique.",
  "À travers nos différentes activités, nous plaçons la confiance, la qualité et la satisfaction de nos clients au cœur de notre engagement.",
];

export const GROUP_MISSION =
  "Faciliter l'accès aux équipements, aux technologies et aux services professionnels grâce à des solutions fiables, accessibles et innovantes.";

export const GROUP_VISION =
  "Devenir un groupe africain de référence dans le commerce, la technologie et les services, avec une présence progressive dans plusieurs marchés.";

export const GROUP_VALUES = ["Intégrité", "Innovation", "Excellence", "Proximité", "Engagement", "Ambition"] as const;

/** Pôles en activité : la boutique et le pôle technique. */
export const ACTIVE_DIVISIONS: readonly { name: string; activity: string }[] = [
  { name: BRAND.shop.name, activity: "commerce et distribution d'équipements" },
  { name: BRAND.tech.name, activity: "informatique, maintenance et assistance technique" },
];

/** Pôles envisagés : présentés comme à venir, jamais comme des activités déjà ouvertes. */
export const FUTURE_DIVISIONS: readonly { name: string; activity: string }[] = [
  { name: "FUTANI DIGITAL", activity: "développement web, applications et logiciels" },
  { name: "FUTANI NETWORK", activity: "réseaux et télécommunications" },
  { name: "FUTANI SECURITY", activity: "sécurité et vidéosurveillance" },
  { name: "FUTANI SERVICES", activity: "conseil, formation et prestations" },
];

/** Texte de la page « À propos » (créée en brouillon par le seed ; relue puis publiée dans l'administration). */
export function aboutPageBody(): string {
  const divisions = (list: readonly { name: string; activity: string }[]) =>
    list.map(({ name, activity }) => `${name} : ${activity}.`).join("\n");
  return [
    ...GROUP_PRESENTATION,
    `Notre mission\n${GROUP_MISSION}`,
    `Notre vision\n${GROUP_VISION}`,
    `Nos valeurs\n${GROUP_VALUES.join(" · ")}`,
    `Nos activités\n${divisions(ACTIVE_DIVISIONS)}`,
    `Pôles à venir\n${divisions(FUTURE_DIVISIONS)}`,
    `${BRAND.group.name} — ${BRAND.group.signature}`,
  ].join("\n\n");
}
