# Mise en service et exploitation

Procédures de production de FUTANI SHOP. Chaque commande ci-dessous a été exécutée lors de la stabilisation de la phase 10 sur une pile de test isolée (voir `docs/rapports/phase-10.md`, « Stabilisation »), sauf mention contraire.

Dans ce document : `C="docker compose -f docker-compose.prod.yml --env-file .env.production"`.

## 1. Prérequis

- Serveur Linux avec Docker (Engine 27 ou plus, avec Compose v2) ; 2 vCPU et 4 Go de mémoire au minimum ; disque sauvegardé.
- Nom de domaine pointant vers le serveur ; seuls les ports 80 et 443 ouverts au public (plus SSH, restreint).
- Un reverse proxy TLS devant l'application (Caddy, Nginx…) : l'application écoute seulement sur `127.0.0.1:3000`.
- Une destination de sauvegarde **hors du serveur** (autre machine, stockage objet), chiffrée.

### Informations à réunir avant l'installation

| Information | Fournie par | Sert à |
|---|---|---|
| Serveur (adresse, accès SSH par clé, utilisateur membre du groupe `docker`) | hébergeur | tout |
| Nom de domaine et enregistrement DNS `A` (et `www`) vers le serveur | propriétaire | `APP_URL`, certificat TLS |
| Compte Brevo (ou autre fournisseur SMTP) : clé SMTP, adresse d'expédition du domaine vérifiée, enregistrements DNS SPF, DKIM et DMARC publiés | propriétaire | e-mails : réinitialisations, notifications, relances (section 3) |
| Nom, e-mail et mot de passe du premier administrateur principal | propriétaire | `admin:create` (saisi au clavier) |
| Identité légale : raison sociale, NINEA, RCCM, adresse, téléphone, logo | propriétaire | paramètres, documents |
| Horaires d'ouverture et jours fériés de l'année | propriétaire | délais et relances des retours |
| Zones et tarifs de livraison, points de retrait, livreurs | propriétaire | commandes |
| Destination de la copie hors serveur des sauvegardes (et son outil) | propriétaire | section 7 |

### Déroulé

Sur le serveur, dans `/srv/futani` (dépôt cloné à la version à déployer) :

```bash
git clone https://github.com/Libasse27/systelec_sama_shop.git /srv/futani && cd /srv/futani
git checkout <étiquette ou commit validé>
# section 2 : construire les images
scripts/ops/init-env.sh https://votre-domaine "$(git rev-parse --short HEAD)"   # section 3
scripts/ops/preflight.sh                                                     # contrôles (aucune modification)
scripts/ops/first-start.sh                                                   # section 4, dans un terminal
# puis sections 5 à 7 et liste de contrôle (section 13)
```

## 2. Construire les images

Depuis le dépôt, sur la version à déployer (étiquette Git ou commit) :

```bash
VERSION=$(git rev-parse --short HEAD)
docker build --target app   -t futani-sama-shop:$VERSION .
docker build --target tools -t futani-sama-shop-tools:$VERSION .
```

- `app` : serveur web autonome (Next.js `standalone`). Il tourne sous un utilisateur non-root (`nextjs`, uid 1001), avec la racine en lecture seule, sans capacité Linux et avec une sonde de santé. npm n'y figure pas. Seuls `/app/storage` (fichiers téléversés) et `/app/.next/cache` sont modifiables.
- `tools` : migrations, données de base, premier administrateur, tâche planifiée.
- Aucun secret n'est intégré aux images : la configuration est fournie à l'exécution.
- Image de base épinglée par empreinte (`node:24.21.0-alpine@sha256:…`), paquets Alpine mis à jour à la construction.

## 3. Configuration

```bash
scripts/ops/init-env.sh https://votre-domaine "$VERSION"
```

- Le script crée `.env.production` (mode 600) à partir de `.env.production.example`.
- Il génère `AUTH_SECRET`, `POSTGRES_PASSWORD` et `APP_DB_PASSWORD` et ne les affiche jamais.
- Il refuse d'écraser un fichier existant.
- Gardez une copie de ce fichier dans un coffre de mots de passe : sans lui, une sauvegarde de la base ne se restaure pas sur un nouveau serveur.

Restent à remplir à la main si besoin : `SMTP_*`, et `APP_PORT` si le port 3000 est déjà pris. Contenu attendu :

| Variable | Valeur |
|---|---|
| `APP_VERSION` | étiquette construite (section 2) |
| `APP_URL` | `https://votre-domaine` (sans slash final) |
| `AUTH_SECRET` | `openssl rand -base64 32` (le changer déconnecte tout le monde) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` (propriétaire : migrations et exploitation) |
| `APP_DB_PASSWORD` | `openssl rand -hex 24` (rôle restreint de l'application) |
| `TRUSTED_PROXY_HOPS` | `1` derrière un seul reverse proxy (Caddy). `0`, ou une valeur supérieure au nombre réel de proxys, désactive **sans avertissement** les limites par adresse IP (connexion, commande, devis, retours, contact) : `preflight.sh` affiche la valeur sans la juger. Contrôle réel : section 14 |
| `SMTP_*` | voir « E-mails » ci-dessous ; sans `SMTP_HOST`, aucun e-mail n'est envoyé (tracé, jamais simulé) |
| `DATABASE_POOL_MAX` | `10` (suffisant, voir section 10) |
| `GOOGLE_*`, `FACEBOOK_*`, `APPLE_*`, `MICROSOFT_*` | facultatifs : connexion sociale des clients (section 15) ; vides = désactivée |

`.env.production` n'est jamais versionné (`.gitignore`).

**E-mails (Brevo, ou tout fournisseur SMTP).** L'application envoie par SMTP : liens de réinitialisation, notifications des commandes, devis, interventions et retours, accusés et alertes du formulaire de contact (section 14), relances et alertes de la tâche planifiée.

| Variable | Brevo |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (STARTTLS, exigé en production) ; `465` en TLS implicite |
| `SMTP_USER` / `SMTP_PASSWORD` | identifiant et **clé SMTP** du compte (jamais le mot de passe du compte) ; ils vont ensemble |
| `SMTP_FROM` | `FUTANI SHOP <boutique@votre-domaine>` : adresse du domaine, déclarée comme expéditeur dans Brevo |

Valeurs à confirmer dans l'interface de Brevo, ainsi que les limites de l'offre choisie. Avant d'activer, publier dans le DNS du domaine les enregistrements SPF, DKIM et DMARC fournis par Brevo : sans eux, les messages finissent dans les indésirables.

Comportement :
- Configuration incomplète (port ou expéditeur absent, identifiant sans clé) : l'application refuse de démarrer, et `preflight.sh` échoue.
- Échec du fournisseur : l'envoi abandonne après 10 à 20 secondes. La notification passe en `FAILED` avec une catégorie contrôlée (connexion, authentification, destinataire refusé, incident temporaire ou autre échec). Le texte libre renvoyé par le serveur SMTP n'est ni stocké ni affiché. La commande ou l'action elle-même aboutit.
- **Renvoi automatique** par la tâche planifiée (section 6) : nouvel essai 15 minutes, 1 heure puis 4 heures après chaque échec, soit **4 envois au plus**, jamais davantage. Un refus définitif du destinataire (codes SMTP 550, 551, 553 : adresse inexistante ou invalide) n'est jamais renvoyé. Les notifications envoyées (`SENT`) ou sans fournisseur (`SKIPPED_NO_PROVIDER`) ne sont jamais renvoyées.
- **Rattrapage** : un e-mail resté en attente, jamais envoyé ou interrompu pendant l'envoi (processus arrêté), est repris entre 10 minutes et 24 heures après sa création ; au-delà, il est jugé périmé et n'est pas envoyé. Un envoi interrompu a pu partir juste avant l'arrêt : le client peut alors recevoir le message deux fois (« au moins un envoi »). Une ligne qui a déjà épuisé ses 4 envois passe en échec définitif sans nouvel envoi.
- Deux passages simultanés de la tâche, ou un envoi immédiat et la tâche, n'envoient jamais deux fois la même notification (mises à jour conditionnelles en base).
- La fiche commande affiche le nombre d'essais et l'heure du prochain, ou l'abandon définitif.
- Les échecs antérieurs à cette version ne sont pas renvoyés après coup.
- La demande de réinitialisation répond sans attendre l'envoi (aucune différence de durée selon que le compte existe ou non).

Test après activation : demander une réinitialisation de mot de passe pour votre propre compte depuis `/mot-de-passe-oublie`, puis passer une commande d'essai avec votre adresse.

## 4. Premier démarrage

```bash
scripts/ops/preflight.sh       # contrôles : Docker, ressources, configuration, images, ports, no-new-privileges
scripts/ops/first-start.sh     # toutes les étapes ci-dessous, dans l'ordre (à lancer dans un terminal)
```

`preflight.sh` ne modifie rien. Il échoue (code 1) sur un contrôle bloquant : droits du fichier, secret absent ou trop court, `APP_URL` invalide, SMTP incomplet, image absente. Il avertit sans bloquer quand le reverse proxy n'est pas encore là ou que les ressources sont faibles. Il indique aussi si `no-new-privileges` peut être activé (section 12).

`first-start.sh` relance d'abord ces contrôles et s'arrête s'ils échouent. Il exécute ensuite les étapes suivantes. Il est relançable : la création de l'administrateur est sautée s'il en existe déjà un actif. Il vérifie que le rôle restreint n'a aucun droit `TRUNCATE` ni de création de tables, et termine par la sonde de santé. Équivalent manuel :

```bash
$C up -d db                                   # PostgreSQL 17 (aucun port publié)
$C run --rm migrate                           # migrations (rôle propriétaire)
(
  set -a
  . ./.env.production
  set +a
  $C exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -v app_role="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" < scripts/ops/app-role.sql
)
$C run --rm tasks pnpm db:seed                # rôles, permissions, catalogue de base (idempotent)
$C run --rm tasks pnpm admin:create           # premier administrateur principal (mot de passe saisi)
$C up -d app
(
  set -a
  . ./.env.production
  set +a
  curl -fsS "http://127.0.0.1:${APP_PORT:-3000}/api/health" # {"status":"ok"}
)
```

**Rôle restreint de l'application** (`scripts/ops/app-role.sql`, idempotent).

L'application se connecte avec `futani_app`, qui :
- lit et écrit les données ;
- n'a pas `TRUNCATE`, qui contournerait les triggers d'ajout seul du journal d'audit, des encaissements et des historiques ;
- ne peut ni créer, ni modifier, ni supprimer de tables ;
- n'accède pas à l'historique des migrations.

Les tables créées par les migrations futures lui sont accordées automatiquement. Seul `migrate` utilise le propriétaire.

À relancer si le mot de passe du rôle change. Si les journaux du serveur PostgreSQL enregistrent toutes les requêtes, le mot de passe y apparaît : désactivez cette journalisation pendant l'exécution.

## 5. Reverse proxy TLS (exemple Caddy)

Modèle complet : `deploy/Caddyfile.example` (validé par `caddy validate`). Il comprend la compression, une taille d'envoi de 8 Mo (l'application accepte 7 Mo), un journal d'accès avec rotation et la redirection du `www`. L'essentiel :

```
votre-domaine.sn {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

- Caddy obtient et renouvelle le certificat.
- L'application pose déjà ses en-têtes de sécurité : CSP avec nonce, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` et `Permissions-Policy`.
- Avec un seul proxy, `TRUSTED_PROXY_HOPS=1`. C'est indispensable aux limites anti-abus fondées sur l'adresse IP.
- Ce point n'a pas été exécuté pendant la stabilisation : aucun domaine n'était disponible.

## 6. Tâche planifiée

Expiration des réservations, paniers et devis, alertes et relances des retours, renvoi des e-mails en échec, toutes les 15 minutes (crontab de l'utilisateur qui exploite Docker). Modèle avec la sauvegarde nocturne : `deploy/crontab.example` (créer d'abord `/var/log/futani`, accessible en écriture à cet utilisateur).

```
*/15 * * * * cd /srv/futani && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tasks >> /var/log/futani/taches.log 2>&1
```

## 7. Sauvegardes

```bash
scripts/ops/backup.sh /srv/sauvegardes        # base (pg_dump -Fc) + fichiers téléversés + SHA256SUMS
```

- Prérequis : services `db` et `app` démarrés, `.env.production` lisible, dossier parent accessible en écriture. Le script crée un sous-dossier UTC à la seconde et refuse un nom déjà présent ; en cas d'échec partiel, il laisse ce dossier en place et ne l'écrase pas.
- Le service continue de tourner pendant la sauvegarde, et le dump est un instantané cohérent.
- Le script vérifie que le dump est lisible (`pg_restore --list`) et que l'archive des fichiers aussi.
- Les droits sont `700` sur le dossier et `600` sur les fichiers.
- **Planification** : chaque nuit (`0 2 * * *`), plus avant chaque mise à jour.
- **Rotation** : 14 sauvegardes quotidiennes et 8 hebdomadaires. La suppression des anciennes est volontairement manuelle ou confiée à l'outil de copie : le script ne supprime jamais rien.
- **Copie hors serveur, chiffrée** (restic, rclone avec chiffrement…) : une sauvegarde restée sur le même disque ne protège de rien. Cette copie n'est pas fournie par le projet et doit être mise en place à l'installation.
- Les sauvegardes contiennent des données personnelles : accès restreint, jamais dans le dépôt (`/sauvegardes/` et `*.dump` sont ignorés).

## 8. Restaurer

**Exercice mensuel** (sans toucher au service) :

```bash
scripts/ops/restore.sh /srv/sauvegardes/<date> futani_exercice /srv/exercice/storage
scripts/ops/verify-restore.sh futani futani_exercice   # contenu identique table par table (lignes + MD5)
```

`restore.sh` exige le service `db` démarré, une sauvegarde complète (`SHA256SUMS`, dump, archive et manifeste), et un accès en écriture à la base et au parent du dossier cible. Il vérifie les empreintes et restaure dans une **base neuve** et un **dossier absent ou vide**. Il refuse d'écraser une base existante, la base en service ou un dossier non vide. Il contrôle aussi le nombre de migrations restaurées. Il ne restaure pas les droits du dump (`--no-privileges`), car le rôle applicatif peut ne pas encore exister : `app-role.sql` les recrée (étape 3 ci-dessous). Après un échec en cours de restauration, la base partielle et les fichiers déjà extraits restent en place : relancer avec un autre nom de base et un autre dossier.

`verify-restore.sh` exige le service `db` démarré et les deux bases accessibles au rôle propriétaire ; il compare les bases et échoue à la première différence. Ne lancer la comparaison que juste après la restauration : la base en service continue d'évoluer.

**Incident (bascule sur une sauvegarde)** :

Sur un **serveur neuf**, préparer d'abord le dépôt, les images et le `.env.production` conservé au coffre, puis lancer `$C up -d --wait db`. Si `restore.sh` s'arrête aussitôt sur `the database system is shutting down`, PostgreSQL termine sa première initialisation : attendre quelques secondes et relancer, rien n'a encore été créé. Sur ce serveur, il n'y a rien à arrêter à l'étape 1.

1. `$C stop app` (et suspendre la tâche planifiée).
2. `scripts/ops/restore.sh <sauvegarde> futani_restaure_<date> /srv/restaure/storage`.
3. Recréer le rôle applicatif et ses droits sur la base restaurée :
   ```bash
   (
     set -a
     . ./.env.production
     set +a
     $C exec -T db psql -U "${POSTGRES_USER:-futani_owner}" -d futani_restaure_<date> \
       -v app_role="${APP_DB_USER:-futani_app}" -v app_password="$APP_DB_PASSWORD" < scripts/ops/app-role.sql
   )
   ```
4. Recopier les fichiers dans le volume et les rendre au compte de l'application (uid 1001), car l'extraction par un opérateur non root leur donne son propre compte. Sur un volume déjà rempli, la copie écrase les fichiers de même nom et conserve les autres :
   ```bash
   docker run --rm -v futani-sama-shop_storage:/dst -v /srv/restaure/storage:/src:ro alpine sh -c 'cp -a /src/. /dst/ && chown -R 1001:1001 /dst'
   ```
5. Mettre `POSTGRES_DB=futani_restaure_<date>` dans `.env.production`, puis `$C up -d app` et vérifier la santé et quelques écrans.
6. L'ancienne base est conservée pour l'enquête ; ne la supprimer qu'après décision écrite.

Exercé le 2026-11-07 sur un poste, avec des données synthétiques et une seconde pile vierge simulant un serveur neuf : étapes 2 à 5, avec un opérateur non root. Base restaurée et droits du rôle applicatif conformes, application en bonne santé, fichiers lus et écrits par l'application. Reste à refaire sur le serveur cible, avec une vraie sauvegarde.

## 9. Mise à jour

La migration `20261019090000_notification_retries` a été testée avec `pnpm test:migration` sur un PostgreSQL jetable : le test provoque un échec, vérifie l'annulation transactionnelle, puis la reprise avec Prisma. La procédure opérationnelle complète ci-dessous (sauvegarde, mise à jour de la pile, contrôles et retour arrière) est documentée, mais n'a pas été vérifiée de bout en bout sur une pile jetable pour cette version. `ANCIENNE` et `NOUVELLE` désignent les étiquettes d'images (section 2).

> **Installation créée avant le passage aux noms `futani` :** le projet Compose, les volumes, la base, les rôles et les images ont changé de nom par défaut. Sans précaution, `up -d` crée des volumes vides et l'application démarre sur une base vide (les anciennes données restent dans les anciens volumes). Avant la mise à jour, fixez dans `.env.production` les valeurs réellement en place : `COMPOSE_PROJECT_NAME`, `POSTGRES_DB`, `POSTGRES_USER`, `APP_DB_USER`, `APP_IMAGE` et `TOOLS_IMAGE`. Vérifiez aussi le dossier et les journaux indiqués dans la crontab (section 6), ainsi que la raison sociale dans Paramètres : la valeur par défaut est désormais FUTANI GROUP.

> **Migration `20261111090000_frozen_document_company` (en-tête société et TVA figés sur les factures et reçus) :** dès qu'elle est appliquée, la base refuse toute facture ou tout reçu sans en-tête figé, donc l'ancienne version encore en service ne peut plus encaisser ni facturer. Entre l'étape 6 et le redémarrage sur la nouvelle version, ne saisir aucun encaissement, annulation, remboursement ni facture (ou arrêter `app` avant l'étape 6). Les documents émis avant cette migration gardent l'affichage d'avant (en-tête et TVA relus dans Paramètres). Ses contraintes restent volontairement non validées (`NOT VALID`) : ne jamais lancer `VALIDATE CONSTRAINT` dessus.

1. **Construire** les images `NOUVELLE` (section 2). Le service continue de tourner.
2. **Sauvegarder et vérifier la copie** :
   ```bash
   scripts/ops/backup.sh /srv/sauvegardes        # doit finir par « Sauvegarde terminée : <dossier> (… tables, … migrations) »
   (cd /srv/sauvegardes/<date> && sha256sum --check SHA256SUMS)
   ```
   Copier ce dossier hors du serveur (section 7) et relancer `sha256sum --check` sur la copie. Ne pas continuer sans copie vérifiée.
3. **Suspendre la tâche planifiée** : `crontab -e`, commenter la ligne `*/15 … run --rm tasks` (section 6), puis vérifier par `crontab -l` et attendre qu'aucun conteneur `tasks` ne tourne (`docker ps --filter name=tasks`). Sans cela, une tâche lancée avec la nouvelle image avant la migration lirait des colonnes absentes.
4. **Passer à la nouvelle version** : `APP_VERSION=NOUVELLE` dans `.env.production`. L'application en service n'est pas redémarrée par ce changement. Les exemples de la section 4 chargent maintenant les variables dans un sous-shell. Si `.env.production` avait déjà été chargé dans votre shell avant cette correction, ouvrez un terminal neuf pour éviter que ces variables aient priorité sur `--env-file`. Contrôle facultatif : `echo "${APP_VERSION:-non défini}"` doit afficher `non défini`.
5. **État des migrations, avant** : `$C run --rm migrate pnpm exec prisma migrate status`. Attendu : la ou les nouvelles migrations listées comme non appliquées (« Following migration have not yet been applied »), aucune en échec.
6. **Appliquer les migrations** : `$C run --rm migrate`, puis `$C run --rm migrate pnpm exec prisma migrate status` doit afficher « Database schema is up to date! ». Si la version ajoute des permissions (c'est le cas du module Contact, section 14), lancer ensuite `$C run --rm tasks pnpm db:seed` : sans cela, personne n'a accès aux nouveaux écrans. C'est aussi le cas de la permission `announcements.manage` (bandeau d'annonces, réservée à l'administrateur principal) : lancer `pnpm db:seed` après le déploiement.
7. **En cas d'échec de la migration** (le service ancien continue de tourner : le schéma n'a pas changé ou la migration est atomique) :
   - **Diagnostic** : `$C logs --since 30m db | grep ERROR` donne la cause exacte (Prisma n'affiche parfois que « current transaction is aborted »). `migrate status` liste la migration en échec ; une relance est refusée (`P3009`) tant que l'échec n'est pas résolu (`P3018` désigne l'échec lui-même).
   - **Vérifier ce qui a été appliqué** : `$C exec -T db psql -U futani_owner -d futani -c '\d notifications'` (valeurs de `POSTGRES_USER` et `POSTGRES_DB`, à saisir sans charger le fichier dans le shell) (adapter la table à la migration). La migration `20261019090000_notification_retries` est transactionnelle : après un échec, **rien** n'est appliqué (pas de colonne `attempts`).
   - **Reprise, seulement si rien n'a été appliqué** : corriger la cause, puis
     ```bash
     $C run --rm migrate pnpm exec prisma migrate resolve --rolled-back <nom_de_la_migration>
     $C run --rm migrate                                   # relance
     ```
   - **Si une partie a été appliquée** (migration non transactionnelle) ou en cas de doute : ne rien supprimer à la main ; restaurer la sauvegarde de l'étape 2 dans une base neuve et basculer (section 8, « Incident »). Ne jamais utiliser `migrate resolve --applied` sur une migration incomplète.
8. **Redémarrer et contrôler** :
   ```bash
   $C up -d --wait app                                   # attend l'état « healthy »
   ( set -a; . ./.env.production; set +a; curl -fsS "http://127.0.0.1:${APP_PORT:-3000}/api/health" ) # {"status":"ok"}
   ```
   Puis les écrans principaux (connexion, boutique, une fiche commande).
9. **Vérifier l'envoi et la tâche de renvoi** :
   - e-mail : demander une réinitialisation de mot de passe pour votre propre compte (`/mot-de-passe-oublie`) et vérifier la réception (section 3) ;
   - tâche : la lancer une fois à la main, `$C run --rm tasks`, et vérifier qu'elle se termine par « E-mails renvoyés : … envoyé(s), … en échec, … sans fournisseur. ».
10. **Réactiver la tâche planifiée** : décommenter la ligne dans `crontab -e`, vérifier `crontab -l`, puis, au quart d'heure suivant, la nouvelle entrée de `/var/log/futani/taches.log`.
11. **Retour arrière de l'application** (si un contrôle des étapes 8 ou 9 échoue) : `APP_VERSION=ANCIENNE` dans `.env.production`, puis `$C up -d --wait app` et `curl …/api/health` ; la tâche planifiée reprend aussi l'ancienne image.
    - Les migrations ne vont que vers l'avant et restent en place. Celle du renvoi (`20261019090000_notification_retries`) n'ajoute que des colonnes avec valeur par défaut, une contrainte et un index : l'ancienne version fonctionne avec, **aucune restauration n'est nécessaire**. Les e-mails en échec gardent leur prochain essai, repris au retour de la nouvelle version.
    - Pour une future migration qui modifierait le schéma de façon incompatible, restaurer la sauvegarde de l'étape 2 (section 8). Toute nouvelle migration doit indiquer dans son en-tête si l'ancienne version reste compatible.

## 10. Performance

Mesure de référence (phase 10), sur l'image de production :
- base chargée de 5 000 produits publiés ;
- 30 utilisateurs simultanés sans temps de réflexion ;
- un poste de 8 cœurs partagé entre k6, l'application et PostgreSQL.

Résultats :

| Page | 95e centile | 99e centile |
|---|---|---|
| accueil | 496 ms | 532 ms |
| catégorie | 360 ms | 389 ms |
| fiche produit | 579 ms | 623 ms |
| recherche | 450 ms | 502 ms |
| sonde de santé | 42 ms | 56 ms |

Sur l'ensemble : 9 224 requêtes, 0 échec, 68 requêtes par seconde, temps maximal de 693 ms.

Rejouer sur une base **jetable** (jamais en service) :

```bash
psql "<URL base jetable>" -v confirm_db=<nom> -v categories=20 -v per_category=250 -f scripts/perf/volume.sql
docker run --rm --network host -v "$PWD/scripts/perf:/perf:ro" -e BASE_URL=http://127.0.0.1:<port> grafana/k6:1.3.0 run /perf/load-test.js
```

Les seuils sont écrits dans `scripts/perf/load-test.js` ; la commande échoue s'ils ne sont pas tenus.

## 11. Supervision

- Sonde : `GET /api/health`. Elle vérifie l'accès à PostgreSQL et répond `200 {"status":"ok"}` ou `503`. Docker en fait sa sonde de santé (`docker ps` affiche `healthy`).
- Journaux JSON sur la sortie standard : `$C logs -f app`. Rotation déjà configurée dans `docker-compose.prod.yml` (5 fichiers de 20 Mo par conteneur).
- À surveiller :
  - la disponibilité, avec une sonde externe sur `https://votre-domaine/api/health` ;
  - l'espace disque des volumes `pgdata` et `storage` et des sauvegardes ;
  - la réussite de la sauvegarde nocturne et de la tâche planifiée.

## 12. Sécurité d'exploitation

- **Secrets** : uniquement dans `.env.production` (mode 600). Les changer si une fuite est suspectée ; changer `AUTH_SECRET` invalide toutes les sessions.
- **Base** : aucun port publié, rôle restreint pour l'application, propriétaire réservé aux migrations.
- **Conteneurs** : `cap_drop: ALL`, racine en lecture seule pour `app`. `no-new-privileges` est recommandé en plus, mais seulement après ce test sur le serveur cible : `docker run --rm --security-opt no-new-privileges:true alpine true`. Sur le poste de stabilisation, cette option empêchait tout démarrage, même celui des images officielles.
- **Vulnérabilités** : la CI construit l'image et échoue si Trivy trouve une vulnérabilité élevée ou critique. Reconstruire régulièrement l'image pour les correctifs Alpine et Node.

## 13. Liste de contrôle de mise en service

- [ ] Informations réunies (fin de la section 1)
- [ ] Images construites et étiquetées ; `.env.production` créé par `init-env.sh` et copié dans un coffre
- [ ] `preflight.sh` sans échec
- [ ] `db` démarré, migrations appliquées, rôle restreint créé (contrôle : `droits_truncate = 0`)
- [ ] `db:seed` lancé ; premier administrateur principal créé ; connexion vérifiée
- [ ] Reverse proxy TLS en place ; `https://…/api/health` répond `ok` ; en-têtes de sécurité présents
- [ ] Paramètres saisis dans l'administration : identité, NINEA, RCCM, horaires, jours fériés de l'année
- [ ] Zones de livraison, points de retrait, livreurs (internes reliés à leur compte)
- [ ] Tâche planifiée installée (toutes les 15 minutes)
- [ ] Sauvegarde nocturne planifiée **et copiée hors serveur** ; premier exercice de restauration réussi
- [ ] Sonde externe et alerte d'espace disque en place
- [ ] Test `no-new-privileges` fait sur le serveur ; option activée si possible
- [ ] Connexion sociale (section 15) : désactivée (variables vides) tant que la politique de confidentialité n'est pas publiée ; sinon, contrôles de la section 15 faits
- [ ] Module Contact (section 14) : migration `20261031090000_contact_messages` appliquée puis `db:seed` relancé ; e-mail de l'entreprise renseigné ; message d'essai reçu dans « Messages » avec une adresse IP réelle dans le journal d'audit

## 14. Module Contact (formulaire et rubrique « Messages »)

Formulaire public sur `/contact` ; les messages sont traités dans l'administration, rubrique **Messages** (`/admin/messages`). Les procédures ci-dessous n'ont pas été exécutées sur un serveur réel. La migration a été rejouée sur un PostgreSQL vierge par les tests d'intégration, et ses contraintes et index y sont vérifiés (`src/server/modules/contact/schema.int.test.ts`).

### Prérequis

- Version déployée contenant la migration `20261031090000_contact_messages` (liste : `ls prisma/migrations`).
- Sauvegarde vérifiée et copiée hors serveur juste avant (section 9, étape 2).
- Tâche planifiée suspendue pendant la mise à jour (section 9, étape 3).

### Migration

Elle suit la procédure de la section 9 (étapes 5 à 7). Ce qu'elle fait :
- crée les types `ContactSubject` et `ContactMessageStatus`, la table `contact_messages` (contraintes `contact_messages_reply_check` : e-mail ou téléphone obligatoire ; `contact_messages_closed_check` : date de clôture si, et seulement si, le message est traité) et ses index ;
- ajoute à `notifications` une colonne facultative `contactMessageId` et son index. **Aucune donnée existante n'est modifiée.**

Précautions :
- **Transactionnelle** : en cas d'échec, rien n'est appliqué ; reprise par `migrate resolve --rolled-back 20261031090000_contact_messages` puis relance (section 9, étape 7).
- **`lock_timeout` de 5 secondes** : la création de l'index suspend brièvement les écritures sur `notifications`. Si la table est occupée par une longue transaction, la migration échoue proprement (« canceling statement due to lock timeout » dans `$C logs --since 30m db`) au lieu de bloquer le site : relancer à un moment plus calme.
- **Compatibilité** : l'ancienne version de l'application fonctionne avec ce schéma (table inutilisée, colonne facultative). Un retour arrière de l'application (section 9, étape 11) ne demande aucune restauration.

Juste après la migration, **relancer les données de base** :

```bash
$C run --rm tasks pnpm db:seed
```

Il crée la permission `messages.manage` et réaligne les rôles système sur le code ; le catalogue n'est complété que de ce qui manque. Au premier passage après cette version, la première ligne attendue est « Rôles et permissions : 1 permission(s) créée(s), 0 rôle(s) créé(s), 3 rôle(s) mis à jour. » (administrateur principal, administrateur, service client). Un second passage ne change plus rien.

### Accès à la rubrique « Messages »

- Permission `messages.manage` : rôles **Administrateur principal**, **Administrateur** et **Service client**. Aucun autre rôle n'y a accès (un technicien ou un client est redirigé vers `/acces-refuse`).
- Attribution d'un rôle : administration, **Utilisateurs** (permission `users.manage`). Les droits sont relus à chaque requête : pas besoin de se reconnecter.
- Le menu « Messages » n'apparaît qu'aux comptes qui ont la permission.

### E-mail de l'entreprise

Les alertes au personnel partent vers l'**E-mail** saisi dans **Paramètres → Identité et mentions légales**. C'est aussi l'adresse affichée sur la page Contact et dans le pied de page : utiliser une boîte lue par le service client. Champ vide : aucune alerte n'est préparée ; les messages restent enregistrés et visibles dans « Messages ».

### Adresse IP derrière le reverse proxy

La limite de 5 messages par heure et par connexion repose sur l'adresse IP transmise par Caddy (`X-Forwarded-For`), lue au rang fixé par `TRUSTED_PROXY_HOPS` (section 3).

1. Valeur configurée : `grep '^TRUSTED_PROXY_HOPS=' .env.production` doit afficher `TRUSTED_PROXY_HOPS=1` (un seul proxy). Une ligne absente vaut aussi `1` (valeur par défaut de `docker-compose.prod.yml`).
2. Preuve de fonctionnement, après l'envoi d'un message d'essai depuis un poste extérieur :
   ```bash
   $C exec -T db psql -U futani_owner -d futani -c "SELECT ip, \"createdAt\" FROM audit_logs WHERE action = 'contact_message.create' ORDER BY \"createdAt\" DESC LIMIT 1"
   ```
   (valeurs de `POSTGRES_USER` et `POSTGRES_DB`). Attendu : l'adresse publique du poste d'essai. Une valeur vide signifie qu'aucune limite par IP ne s'applique (valeur `0`, ou supérieure au nombre de proxys) ; une adresse locale (`127.0.0.1`, `172.…`) signale un proxy mal configuré.

Ne pas placer de CDN devant Caddy sans revoir ce réglage : tous les visiteurs partageraient alors les adresses du CDN, et donc la même limite.

### Notifications et e-mails

- **Accusé de réception** au visiteur s'il a donné une adresse e-mail, **3 au plus par adresse et par jour** (au-delà, le message est enregistré sans accusé). **Alerte au personnel** vers l'e-mail de l'entreprise.
- Ces e-mails, en texte brut, ne contiennent **aucune donnée saisie par le visiteur** : seulement le numéro du message (`MSG-AAAA-NNNNNN`) et le libellé du sujet. Le nom, les coordonnées et le message se lisent dans « Messages ».
- Sans SMTP (`SMTP_HOST` vide), rien n'est envoyé : les notifications sont tracées, les messages enregistrés. Avec SMTP, mêmes échecs, renvois et rattrapages que les autres notifications (section 3).
- Refus du formulaire (champ piège, validation, limite par IP, clé d'envoi réutilisée) : une ligne `contact_message.rejected` dans le journal de l'application, avec le motif, les **noms** des champs en cause et le réseau d'origine (`/24` ou `/48`), jamais le nom, les coordonnées, le contenu ni l'adresse IP complète. Aucune ligne en base. Consultation : `$C logs --since 1h app | grep contact_message.rejected`.

### Contrôles après déploiement

1. `migrate status` : « Database schema is up to date! » ; sortie de `db:seed` conforme (ci-dessus).
2. Depuis un poste extérieur, en navigation privée : envoyer un message sur `/contact` avec votre adresse e-mail. La page affiche « Message envoyé, merci ! » et un numéro `MSG-…`.
3. Avec SMTP : accusé reçu sur votre adresse, alerte reçue sur l'e-mail de l'entreprise.
4. Connecté avec un compte Service client ou Administrateur : le message figure dans « Messages » ; « Prendre en charge », une note interne puis « Marquer comme traité » fonctionnent.
5. Adresse IP réelle dans le journal d'audit (requête ci-dessus).
6. Avec un compte sans la permission : `/admin/messages` redirige vers `/acces-refuse`.

## 15. Connexion avec Google, Facebook, Apple, Microsoft

Boutons « Continuer avec … » sur `/connexion` et `/inscription`, **pour les clients uniquement**. Chaque fournisseur est facultatif et ne s'active que si son identifiant **et** son secret sont renseignés dans `.env.production` ; sans aucune variable, la fonctionnalité est inerte (route de retour en 404). Les fournisseurs non configurés restent affichés sous forme de boutons désactivés « Bientôt disponible », sans formulaire ni action serveur. Les procédures ci-dessous n'ont pas été exécutées avec de vrais comptes de fournisseur ; le parcours est vérifié par les tests d'intégration (`src/server/auth/social.int.test.ts`, échange de code simulé) et E2E (`e2e/social-login.spec.ts`, fournisseur intercepté).

### Prérequis

- **Politique de confidentialité publiée** (lot distinct) avant toute activation : les consoles des fournisseurs l'exigent (URL publique) et les clients doivent savoir quelles données sont reçues.
- Domaine définitif en https (`APP_URL`) : les URI de redirection sont déclarées chez chaque fournisseur et doivent correspondre exactement.

### Comportement retenu

- **Personnel exclu** : un compte du personnel (rôle attribué) ne peut ni se connecter, ni être relié, ni être créé par un fournisseur ; il garde l'e-mail et le mot de passe. Lors de l'attribution d'un premier rôle, les comptes sociaux du client promu sont détachés et ses sessions révoquées (journal : `auth.social.unlink`).
- **Liaison automatique** à un compte existant seulement si le fournisseur atteste l'adresse e-mail **et** si l'e-mail du compte local est déjà vérifié. Sinon, le client voit « Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec votre e-mail et votre mot de passe. »
- **Facebook et (le plus souvent) Microsoft n'attestent pas l'adresse e-mail** : un compte créé par eux a un e-mail non vérifié et n'est jamais relié automatiquement à un compte existant (Facebook : jamais, quelle que soit sa réponse). Le client vérifie son e-mail par « Mot de passe oublié ».
- **Vérifier son e-mail** : un client existant le fait par « Mot de passe oublié ». La réinitialisation marque l'e-mail vérifié (`auth.email_verified`), détache tous ses comptes sociaux (`auth.social.unlink`) et, s'il y en avait, révoque ses sessions : l'un d'eux a pu être créé par un tiers avant cette preuve. Un fournisseur qui atteste l'e-mail se reliera de nouveau à la connexion suivante. Cette réconciliation est idempotente et exécutée deux fois (rappel de Better Auth, puis service) : si la première échoue, une ligne d'erreur « Réconciliation après réinitialisation échouée » apparaît dans le journal de l'application et la seconde la rattrape.
- **Données minimales** : portées par défaut (e-mail et profil ; Microsoft : `openid profile email`). Aucun jeton du fournisseur n'est conservé, ni photo de profil. Seuls le nom, l'e-mail et l'identifiant du compte chez le fournisseur sont enregistrés.
- **Journal d'audit** : `auth.social.start`, `auth.social.signup`, `auth.social.link`, `auth.social.login`, `auth.social.blocked` (refusé), avec le fournisseur et l'identifiant interne du compte ; jamais de jeton, de code, d'état ni d'adresse e-mail.
- **Limite** : 20 démarrages de connexion sociale par adresse IP et par quart d'heure, comptés dans le journal d'audit (`auth.social.start`), comme les autres limites : comptage non atomique (quelques démarrages simultanés peuvent dépasser le plafond de peu) et **aucune limite sans adresse IP fiable** (`TRUSTED_PROXY_HOPS=0` ou supérieur au nombre réel de proxys, section 3).
- **Route de retour** `/api/auth/callback/<fournisseur>` : réponse jamais mise en cache (`Cache-Control: no-store`). Elle n'est pas limitée par l'application : le limiteur intégré de Better Auth repère l'adresse IP par une liste d'adresses de proxys (`advanced.ipAddress.trustedProxies`), incompatible avec le réglage par nombre de proxys (`TRUSTED_PROXY_HOPS`) ; il n'est donc pas configuré. Limiter cette route au reverse proxy (ci-dessous).
- **Journal Better Auth** : erreurs seulement, et leur message seul (jamais l'état OAuth, le code ni le profil reçus), dans le journal de l'application.

### URI de redirection

Une par fournisseur actif, à déclarer telle quelle (remplacer le domaine) :

| Fournisseur | URI de redirection |
|---|---|
| Google | `https://<domaine>/api/auth/callback/google` |
| Facebook | `https://<domaine>/api/auth/callback/facebook` |
| Apple | `https://<domaine>/api/auth/callback/apple` |
| Microsoft | `https://<domaine>/api/auth/callback/microsoft` |

### Google

1. Google Cloud Console : créer (ou choisir) un projet, puis **Écran de consentement OAuth** : type « Externe », nom de la boutique, e-mail d'assistance, domaine autorisé, URL de la politique de confidentialité. Portées : `openid`, `email`, `profile` uniquement. Publier l'application (« En production »).
2. **Identifiants → Créer des identifiants → ID client OAuth**, type « Application Web ». URI de redirection autorisée : celle du tableau. Aucune origine JavaScript n'est nécessaire.
3. Reporter `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`.

### Facebook

1. Meta for Developers : créer une application de type « Consommateur » (connexion Facebook), renseigner l'URL de la politique de confidentialité et l'URL de suppression des données.
2. **Facebook Login → Paramètres** : « URI de redirection OAuth valides » = celle du tableau ; laisser activés « Connexion OAuth Web » et « Mode strict pour les URI de redirection ».
3. Autorisations : `email` et `public_profile` seulement (pas d'examen d'application nécessaire). Passer l'application en mode « En ligne ».
4. Reporter l'identifiant de l'application dans `FACEBOOK_CLIENT_ID` et la clé secrète dans `FACEBOOK_CLIENT_SECRET`.

### Apple

1. Apple Developer (compte payant) : **Identifiers → App IDs**, activer « Sign in with Apple » sur l'App ID principal.
2. **Identifiers → Services IDs** : créer un Services ID (par exemple `sn.domaine.web`), activer « Sign in with Apple », configurer le domaine (sans `https://`) et l'URL de retour du tableau. Cet identifiant est `APPLE_CLIENT_ID`.
3. **E-mails relayés** : les clients peuvent masquer leur adresse (`…@privaterelay.appleid.com`). Pour que les e-mails de la boutique leur parviennent, déclarer le domaine et l'expéditeur `SMTP_FROM` dans **Services → Sign in with Apple for Email Communication**, et publier SPF et DKIM pour ce domaine (section 3).
4. **Keys** : créer une clé « Sign in with Apple » liée à l'App ID ; télécharger le fichier `AuthKey_<KEYID>.p8` (une seule fois) et le ranger dans le coffre, jamais sur le serveur ni dans le dépôt.
5. Générer le secret sur un poste d'administration (aucune dépendance supplémentaire), clé en mode 600 (le script avertit sinon), sortie vers un fichier privé plutôt qu'à l'écran :
   ```bash
   chmod 600 chemin/AuthKey_<KEYID>.p8
   umask 077
   APPLE_TEAM_ID=<TEAMID> APPLE_KEY_ID=<KEYID> APPLE_CLIENT_ID=<Services ID> \
     pnpm exec tsx scripts/ops/apple-client-secret.ts chemin/AuthKey_<KEYID>.p8 180 > apple-client-secret.txt
   ```
   Le contenu du fichier va dans `APPLE_CLIENT_SECRET` ; supprimer ensuite le fichier.
6. **Rotation tous les 6 mois au plus** : le secret expire (180 jours maximum). `preflight.sh` prévient 30 jours avant. Un secret **expiré** désactive seulement Apple (bouton désactivé « Bientôt disponible », route de retour en 404, une ligne d'erreur « Connexion Apple désactivée » dans le journal) : la boutique et les autres fournisseurs continuent. Un secret **mal formé** (pas un JWT, sans expiration) empêche en revanche le démarrage. Régénérer, mettre à jour `.env.production`, puis `$C up -d app`.
7. Apple renvoie la réponse par formulaire (POST) : la route de retour l'accepte pour Apple seulement.

### Microsoft

1. Portail Azure, **Microsoft Entra ID → Inscriptions d'applications → Nouvelle inscription**. Types de comptes : « **Comptes Microsoft personnels uniquement** » (Outlook, Hotmail, Live). URI de redirection, plateforme « Web » : celle du tableau.
2. **Certificats et secrets → Nouveau secret client** ; noter sa date d'expiration (24 mois au plus) et planifier son renouvellement.
3. **Autorisations d'API** : `openid`, `profile`, `email` (déléguées) suffisent.
4. Reporter l'« ID d'application (client) » dans `MICROSOFT_CLIENT_ID`, la valeur du secret dans `MICROSOFT_CLIENT_SECRET`. Laisser `MICROSOFT_TENANT_ID=consumers` (comptes personnels uniquement, valeur par défaut). `common` admettrait aussi les comptes professionnels de n'importe quelle organisation : à éviter.

### Reverse proxy : limite et journaux de la route de retour

- **Limiter** `/api/auth/callback/*` au reverse proxy (par exemple 30 requêtes par minute et par adresse). Caddy n'a pas de limitation de débit en standard : module `rate_limit` (github.com/mholt/caddy-ratelimit, image Caddy construite avec `xcaddy`), ou limitation par le pare-feu. Exemple avec le module :
  ```
  rate_limit {
      zone oauth_callback {
          match {
              path /api/auth/callback/*
          }
          key    {remote_host}
          events 30
          window 1m
      }
  }
  ```
- **Journaux d'accès** : ne pas conserver la chaîne de requête de `/api/auth/callback/*`. Elle porte le `code` et l'`state` OAuth, et Apple y place à la première connexion le nom et l'e-mail du client (`user`). Avec Caddy, filtrer ces paramètres dans le bloc `log` (syntaxe à confirmer selon la version de Caddy) :
  ```
  log {
      format filter {
          request>uri query {
              delete code
              delete state
              delete user
              delete id_token
              delete error_description
          }
      }
  }
  ```
  Contrôle : après une connexion d'essai, `grep callback` dans le journal d'accès ne doit montrer aucune valeur de `code`, `state` ni `user`.

### Activation

1. Renseigner les variables du ou des fournisseurs dans `.env.production` (paires complètes), puis `scripts/ops/preflight.sh` : la ligne « connexion sociale » liste les fournisseurs actifs ; aucune paire incomplète ; secret Apple valable.
2. `$C up -d app` (redémarrage nécessaire pour relire la configuration). Une paire incomplète ou un secret Apple mal formé fait échouer le démarrage avec un message explicite (`$C logs --since 5m app`). Les secrets des fournisseurs ne sont transmis qu'au service `app` (pas à `migrate` ni à `tasks`).

### Contrôles après déploiement

1. `/connexion` et `/inscription` affichent les quatre boutons : ceux des fournisseurs actifs sont cliquables, les autres désactivés « Bientôt disponible ».
2. Depuis un poste extérieur, en navigation privée, avec un compte personnel de test par fournisseur : « Continuer avec … », consentement, retour sur `/compte`. Dans l'administration, le compte créé est un **Client**.
3. Journal d'audit : `auth.social.signup` puis `auth.social.login` pour ce compte, avec une adresse IP réelle.
4. Avec l'adresse e-mail d'un compte du personnel : la connexion sociale est refusée (message « Un compte existe déjà… ») et une ligne `auth.social.blocked` apparaît.
5. `curl -s -o /dev/null -w '%{http_code}\n' https://<domaine>/api/auth/get-session` répond `404`, de même que `/api/auth/callback/<fournisseur inactif>`.
6. `curl -sI 'https://<domaine>/api/auth/callback/google?code=x'` : en-tête `cache-control: no-store` ; journal d'accès du reverse proxy sans le paramètre `code`.
7. Désactivation d'urgence d'un fournisseur : vider sa paire dans `.env.production` puis `$C up -d app` ; les comptes déjà reliés restent accessibles par e-mail et mot de passe (« Mot de passe oublié » si le client n'en a jamais choisi).
