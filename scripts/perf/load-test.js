// Test de charge des pages publiques (k6, via son image Docker : aucune dépendance ajoutée au projet).
// À lancer contre l'IMAGE DE PRODUCTION, sur une base jetable chargée en volume (scripts/perf/volume.sql),
// jamais contre le site en service. Voir docs/04-mise-en-service.md, « Performance ».
//
//   docker run --rm --network host -v "$PWD/scripts/perf:/perf:ro" -e BASE_URL=http://127.0.0.1:3300 \
//     grafana/k6:<version> run /perf/load-test.js
//
// Profil : montée à 10 puis 30 utilisateurs simultanés sans temps de réflexion (charge bien supérieure au
// trafic attendu d'une boutique locale), mélange accueil / catégorie / fiche produit / recherche / santé.
// Les seuils ci-dessous font échouer la commande s'ils ne sont pas tenus.
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3000";
const CATEGORIES = Number(__ENV.CATEGORIES || 20);
const PER_CATEGORY = Number(__ENV.PER_CATEGORY || 250);

export const options = {
  scenarios: {
    navigation: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "60s", target: 30 },
        { duration: "30s", target: 30 },
        { duration: "15s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{page:accueil}": ["p(95)<800"],
    "http_req_duration{page:categorie}": ["p(95)<1000"],
    "http_req_duration{page:produit}": ["p(95)<800"],
    "http_req_duration{page:recherche}": ["p(95)<1200"],
    "http_req_duration{page:sante}": ["p(95)<200"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const pick = (max) => 1 + Math.floor(Math.random() * max);
const SEARCHES = ["camera", "4 MP", "Hikvision", "vision nocturne", "routeur", "onduleur"];

function get(path, page) {
  const response = http.get(`${BASE_URL}${path}`, { tags: { page } });
  check(response, { [`${page} : 200`]: (r) => r.status === 200 });
}

export default function navigation() {
  const roll = Math.random();
  if (roll < 0.25) get("/", "accueil");
  else if (roll < 0.5) get(`/categories/perf-categorie-${pick(CATEGORIES)}${Math.random() < 0.5 ? `?page=${pick(5)}` : ""}`, "categorie");
  else if (roll < 0.8) get(`/produits/perf-produit-${pick(CATEGORIES)}-${pick(PER_CATEGORY)}`, "produit");
  else if (roll < 0.95) get(`/recherche?q=${encodeURIComponent(SEARCHES[pick(SEARCHES.length) - 1])}`, "recherche");
  else get("/api/health", "sante");
}
