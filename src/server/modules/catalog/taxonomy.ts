/**
 * Structure de base du catalogue (§6) et des services (§7). Ce sont des données métier
 * réelles (et non de démonstration) : elles sont créées si absentes, puis administrables.
 * Les services sont « sur devis » tant que SYSTELEC n'a pas fixé ses tarifs.
 */
export interface CategorySeed {
  name: string;
  children: readonly string[];
}

export const PRODUCT_CATEGORIES: readonly CategorySeed[] = [
  {
    name: "Informatique",
    children: [
      "Ordinateurs portables",
      "Ordinateurs de bureau",
      "Stations de travail",
      "Serveurs",
      "Écrans",
      "Claviers et souris",
      "Imprimantes et scanners",
      "Cartouches et consommables",
      "Processeurs",
      "Cartes mères",
      "Mémoires RAM",
      "SSD et disques durs",
      "Cartes graphiques",
      "Boîtiers et alimentations",
      "Batteries et chargeurs",
      "Accessoires informatiques",
      "Pièces détachées",
    ],
  },
  {
    name: "Réseaux et télécommunications",
    children: [
      "Routeurs",
      "Switches",
      "Points d'accès Wi-Fi",
      "Câbles Ethernet",
      "Fibre optique et accessoires",
      "Connecteurs réseau",
      "Baies et coffrets",
      "Panneaux de brassage",
      "Onduleurs réseau",
      "Équipements de communication",
      "Accessoires de câblage",
    ],
  },
  {
    name: "Électronique grand public",
    children: [
      "Téléphones",
      "Smartphones",
      "Tablettes",
      "Téléviseurs",
      "Enceintes",
      "Casques et écouteurs",
      "Équipements audio",
      "Appareils connectés",
      "Accessoires électroniques",
    ],
  },
  {
    name: "Vidéosurveillance et sécurité",
    children: [
      "Caméras IP",
      "Caméras analogiques",
      "Kits de vidéosurveillance",
      "Enregistreurs DVR et NVR",
      "Disques de surveillance",
      "Alimentations de sécurité",
      "Câbles et connecteurs de sécurité",
      "Interphones",
      "Visiophones",
      "Contrôle d'accès",
      "Détecteurs",
      "Accessoires de sécurité",
    ],
  },
  {
    name: "Électricité et énergie",
    children: [
      "Câbles électriques",
      "Fils électriques",
      "Disjoncteurs",
      "Tableaux électriques",
      "Prises",
      "Interrupteurs",
      "Éclairage LED",
      "Projecteurs",
      "Multiprises",
      "Onduleurs",
      "Régulateurs de tension",
      "Équipements solaires",
      "Accessoires et outillage électrique",
      "Équipements de protection",
    ],
  },
  {
    name: "Accessoires et consommables",
    children: [
      "Clés USB",
      "Cartes mémoire",
      "Adaptateurs",
      "Convertisseurs",
      "Chargeurs",
      "Supports et fixations",
      "Outils de maintenance",
      "Produits de nettoyage informatique",
      "Consommables divers",
    ],
  },
];

export interface ServiceCategorySeed {
  name: string;
  description: string;
  services: readonly string[];
}

export const SERVICE_CATEGORIES: readonly ServiceCategorySeed[] = [
  {
    name: "Maintenance informatique",
    description: "Diagnostic, réparation et entretien de vos ordinateurs, pour les particuliers et les entreprises.",
    services: [
      "Diagnostic informatique",
      "Installation et réinstallation de systèmes",
      "Installation de logiciels",
      "Nettoyage et optimisation",
      "Suppression de logiciels malveillants",
      "Récupération de données selon faisabilité",
      "Réparation d'ordinateurs",
      "Remplacement de composants",
      "Maintenance préventive informatique",
      "Maintenance corrective informatique",
      "Assistance informatique aux particuliers",
      "Contrats de maintenance pour entreprises",
    ],
  },
  {
    name: "Réseaux informatiques",
    description: "Conception, installation et maintenance de réseaux filaires et Wi-Fi.",
    services: [
      "Installation de réseaux locaux",
      "Câblage réseau",
      "Configuration de routeurs et switches",
      "Déploiement Wi-Fi",
      "Installation de baies de brassage",
      "Configuration de serveurs",
      "Diagnostic réseau",
      "Maintenance d'infrastructures réseau",
      "Assistance réseau aux entreprises",
    ],
  },
  {
    name: "Vidéosurveillance",
    description: "Étude, installation et maintenance de systèmes de vidéosurveillance.",
    services: [
      "Étude de site",
      "Visite technique",
      "Proposition de matériel de vidéosurveillance",
      "Installation de caméras",
      "Installation de DVR et NVR",
      "Configuration de consultation à distance",
      "Extension d'installations existantes",
      "Maintenance préventive vidéosurveillance",
      "Dépannage vidéosurveillance",
      "Remplacement d'équipements de vidéosurveillance",
    ],
  },
  {
    name: "Électricité",
    description:
      "Travaux électriques réalisés par du personnel qualifié, dans le respect des exigences de sécurité.",
    services: [
      "Installation électrique",
      "Diagnostic et dépannage électrique",
      "Pose de prises et interrupteurs",
      "Installation d'éclairage",
      "Pose et remplacement de disjoncteurs",
      "Installation de tableaux électriques",
      "Protection contre les surtensions",
      "Installation d'onduleurs",
      "Étude et réalisation de travaux sur devis",
      "Maintenance électrique",
    ],
  },
];

/** Pages d'information créées en BROUILLON : aucun texte légal n'est inventé. */
export const INFORMATION_PAGES: readonly { slug: string; title: string }[] = [
  { slug: "conditions-generales-de-vente", title: "Conditions générales de vente" },
  { slug: "livraison-et-retrait", title: "Livraison et retrait" },
  { slug: "garantie", title: "Garantie" },
  { slug: "confidentialite", title: "Politique de confidentialité" },
  { slug: "a-propos", title: "À propos de SYSTELEC" },
];
