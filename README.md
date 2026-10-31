# FUTANI SHOP

Plateforme e-commerce de **FUTANI SHOP**, la boutique officielle de **FUTANI GROUP**, et des services techniques de **FUTANI TECH** (Sénégal) : vente d'équipements informatiques, réseau, électroniques, électriques et de sécurité ; maintenance, réseaux, vidéosurveillance et électricité. Paiement **exclusivement hors ligne** (espèces), livraison à domicile et retrait en boutique.

> Nom technique historique : le dépôt, les images Docker, les bases et les rôles PostgreSQL gardent le préfixe `systelec` (identifiants techniques, inchangés).

> Statut : Phase 9 terminée (administration avancée, voir [rapport](docs/rapports/phase-9.md)). Prochaine étape : Phase 10, stabilisation et mise en service.

## Démarrage local

```bash
pnpm install
cp .env.example .env          # puis .env.test (voir commentaires)
pnpm db:up                    # PostgreSQL dev (5433) ; `docker compose up -d` pour la base de test (5434)
pnpm db:migrate
pnpm db:seed                  # rôles, catalogue §6, services §7 (idempotent)
ALLOW_DEMO_SEED=1 pnpm db:seed:demo   # produits [DÉMO] (jamais en production)
pnpm admin:create             # premier administrateur principal (mot de passe saisi au clavier)
pnpm dev
```

Les images téléversées depuis l'administration (produits, logo, logos des partenaires) sont écrites dans `STORAGE_LOCAL_DIR` (`./storage` par défaut,
hors Git) : en production, ce dossier doit être un volume persistant et sauvegardé.

Le premier administrateur principal gère ensuite les comptes depuis **Administration → Utilisateurs** (rôles,
désactivation), les paramètres (mentions légales, TVA, règles de commande) depuis **Paramètres**, et consulte
le **Journal d'audit**. Les rapports financiers s'exportent en CSV, Excel (.xlsx) et PDF.

Les e-mails (réinitialisation de mot de passe, notifications des commandes, devis, interventions et retours)
partent par SMTP dès que `SMTP_HOST`, `SMTP_PORT` et `SMTP_FROM` sont renseignés (fournisseur de départ : Brevo ;
tout fournisseur SMTP convient). Sans fournisseur, rien n'est envoyé ni simulé, et un lien de réinitialisation
se génère avec `pnpm admin:reset-link <email>` (après vérification de l'identité du demandeur).

Les commandes non confirmées libèrent leur stock après le délai de réservation (48 h par défaut), les
retours sans action après 24 heures ouvrables déclenchent une alerte unique aux administrateurs, et les
vérifications de retour restées sans réponse sont relancées (12 et 24 heures ouvrables) puis escaladées
(48 heures ouvrables) ; les e-mails en échec sont renvoyés (15 min, 1 h, 4 h) : planifier `pnpm orders:expire`
(par exemple toutes les 15 minutes). Heures
ouvrables, jours fériés et délais de relance : **Administration → Paramètres**.

### Tests et validations

- Tests unitaires, sans PostgreSQL : `pnpm exec vitest run --project unit`.
- Tests d'intégration PostgreSQL : `pnpm test:integration:disposable`. Ce lanceur démarre un conteneur
  et une base jetables pour chaque exécution ; Docker doit être installé et accessible à l'utilisateur.
- `db-test` dans `docker-compose.yml` expose PostgreSQL sur le port 5434. Une commande n'utilise ce
  service que si son URL de base le vise explicitement. `pnpm test:integration:disposable` démarre son
  propre conteneur sur un port aléatoire et n'utilise pas `db-test`.
- `pnpm db:test:prepare` exécute `dotenv -e .env.test -- prisma migrate reset --force` : la commande
  réinitialise et efface les données de la base indiquée par `DATABASE_URL` dans `.env.test`. Elle ne
  garantit pas que cette URL vise `db-test` sur le port 5434. Avant de la lancer, vérifiez que l'URL
  désigne une base jetable dont le contenu peut être supprimé.
- Test de migration : `pnpm test:migration`. Il utilise également un conteneur PostgreSQL jetable et
  nécessite Docker.
- Protections de la base E2E : `pnpm test:e2e-guard`. Deux conteneurs PostgreSQL jetables (deux
  exécutions) vérifient les refus réels : conteneur, marque ou identifiants d'une autre exécution,
  suppression des ressources d'autrui. Docker requis.
- Contrôles statiques et build : `pnpm lint`, `pnpm typecheck`, puis `pnpm build`.
- `pnpm test` exécute les projets Vitest configurés, y compris les tests PostgreSQL jetables ; Docker
  est donc requis pour cette commande complète.

Les E2E sont distincts des tests Vitest. `pnpm test:e2e` (arguments de Playwright acceptés, par exemple
`pnpm test:e2e e2e/smoke.spec.ts`) lance `e2e/run.ts`, qui crée pour CHAQUE exécution :

- un conteneur PostgreSQL jetable (`systelec-e2e-<run>`, données en mémoire, port local aléatoire,
  utilisateur et mot de passe aléatoires) ; la base est marquée avec l'identifiant de l'exécution, et
  cette marque, l'utilisateur et le nom de base sont revérifiés auprès du serveur avant les migrations,
  les données de démonstration et les tests ;
- un dossier de fichiers temporaire `systelec-e2e-<run>-…` dans le dossier temporaire du système ;
- un port applicatif libre choisi par le système ; le serveur testé n'écoute que sur `127.0.0.1`
  (données et comptes de démonstration jamais exposés au réseau local).

Le build des E2E va dans `.next-e2e/` : le build de `.next` (développement, production locale) n'est pas
écrasé. Le verrou `.next-e2e.lock` refuse une seconde exécution simultanée tant que la première est en
cours (lanceur ou processus Playwright encore actif, même si le lanceur a été tué seul) ; le verrou
d'une exécution terminée est repris, sous un verrou de reprise (`.next-e2e.lock.reprise`), seulement
s'il n'a pas changé entre-temps. Un verrou de reprise orphelin bloque les lancements suivants avec un
message explicite : supprimez-le après avoir vérifié qu'aucune exécution E2E ne tourne. Une seule exécution par dossier de
travail : les exécutions parallèles sont volontairement refusées (build commun). `next build` réécrit
`next-env.d.ts` pour `.next-e2e` : le lanceur le rétablit à la fin, sauf si un autre outil l'a modifié
entre-temps (laissé tel quel, avec un avertissement). Les tests qui modifient des paramètres globaux du
site (étiquette `@parametres-globaux`) tournent à part, sur ordinateur puis sur mobile, un seul à la fois
(projets `desktop-parametres` et `mobile-parametres`). `pnpm exec playwright test` lancé directement est
refusé. Les E2E
n'utilisent ni `db-test`, ni `systelec_e2e` sur un serveur partagé, ni `storage-e2e/` (ancien dossier,
qui peut subsister localement). Docker est requis. N'utilisez jamais la base de développement (`.env`)
ou une base partagée pour les tests PostgreSQL.

Les lanceurs PostgreSQL jetables nettoient leurs conteneurs, volumes secrets et répertoires temporaires
à la fin normale du run, après les erreurs interceptées et, pour les E2E, après Ctrl+C. Pour les E2E,
chaque étape de nettoyage est tentée même si une autre échoue ; un échec de nettoyage est affiché sans
masquer l'erreur d'origine (listée en premier) et le code de sortie reste non nul. Une interruption
brutale (processus tué) peut laisser des ressources. Pour les récupérer, ne considérez que les
conteneurs arrêtés et volumes portant l'étiquette `systelec.migration-test.run`, puis vérifiez que leur
nom et leur étiquette correspondent au même identifiant de run avant de supprimer chaque ressource. Ne supprimez aucun conteneur actif ou ressource
sans cette vérification et n'utilisez pas `docker system prune`. Le contenu du secret n'est pas
nécessaire à ce nettoyage.

> Après une migration ou un `pnpm db:generate`, **redémarrez `pnpm dev`** : en développement, le client
> Prisma est conservé entre les rechargements à chaud et ne connaît pas encore les nouvelles tables
> (erreur du type `Cannot read properties of undefined (reading 'findMany')`).

## Documentation

- [Diagnostic du dépôt](docs/00-diagnostic.md)
- [Architecture](docs/01-architecture.md)
- [Modèle de données](docs/02-modele-donnees.md)
- [Plan par phases et décisions à valider](docs/03-plan-et-decisions.md)
- [Mise en service et exploitation](docs/04-mise-en-service.md) : image Docker, déploiement, sauvegarde et restauration, performance

## Stack

Next.js (App Router) · React · TypeScript strict · Tailwind CSS · PostgreSQL · Prisma · Better Auth · Vitest · Playwright · pnpm · Docker Compose.
