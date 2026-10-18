# Mise en service et exploitation

Procédures de production de SYSTELEC SAMA-SHOP. Chaque commande ci-dessous a été exécutée lors de la stabilisation de la phase 10 sur une pile de test isolée (voir `docs/rapports/phase-10.md`, « Stabilisation »), sauf mention contraire.

Dans ce document : `C="docker compose -f docker-compose.prod.yml --env-file .env.production"`.

## 1. Prérequis

- Serveur Linux avec Docker (Engine 27 ou plus, avec Compose v2) ; 2 vCPU et 4 Go de mémoire au minimum ; disque sauvegardé.
- Nom de domaine pointant vers le serveur ; seuls les ports 80 et 443 ouverts au public (plus SSH, restreint).
- Un reverse proxy TLS devant l'application (Caddy, Nginx…) : l'application écoute seulement sur `127.0.0.1:3000`.
- Une destination de sauvegarde **hors du serveur** (autre machine, stockage objet), chiffrée.

## 2. Construire les images

Depuis le dépôt, sur la version à déployer (étiquette Git ou commit) :

```bash
VERSION=$(git rev-parse --short HEAD)
docker build --target app   -t systelec-sama-shop:$VERSION .
docker build --target tools -t systelec-sama-shop-tools:$VERSION .
```

- `app` : serveur web autonome (Next.js `standalone`). Il tourne sous un utilisateur non-root (`nextjs`, uid 1001), avec la racine en lecture seule, sans capacité Linux et avec une sonde de santé. npm n'y figure pas. Seuls `/app/storage` (fichiers téléversés) et `/app/.next/cache` sont modifiables.
- `tools` : migrations, données de base, premier administrateur, tâche planifiée.
- Aucun secret n'est intégré aux images : la configuration est fournie à l'exécution.
- Image de base épinglée par empreinte (`node:24.21.0-alpine@sha256:…`), paquets Alpine mis à jour à la construction.

## 3. Configuration

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Remplir :

| Variable | Valeur |
|---|---|
| `APP_VERSION` | étiquette construite (section 2) |
| `APP_URL` | `https://votre-domaine` (sans slash final) |
| `AUTH_SECRET` | `openssl rand -base64 32` (le changer déconnecte tout le monde) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` (propriétaire : migrations et exploitation) |
| `APP_DB_PASSWORD` | `openssl rand -hex 24` (rôle restreint de l'application) |
| `TRUSTED_PROXY_HOPS` | `1` derrière un reverse proxy |
| `SMTP_*` | facultatif : sans `SMTP_HOST`, aucun e-mail n'est envoyé (tracé, jamais simulé) |
| `DATABASE_POOL_MAX` | `10` (suffisant, voir section 10) |

`.env.production` n'est jamais versionné (`.gitignore`).

## 4. Premier démarrage

```bash
$C up -d db                                   # PostgreSQL 17 (aucun port publié)
$C run --rm migrate                           # migrations (rôle propriétaire)
set -a; . ./.env.production; set +a
$C exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_role="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" < scripts/ops/app-role.sql
$C run --rm tasks pnpm db:seed                # rôles, permissions, catalogue de base (idempotent)
$C run --rm tasks pnpm admin:create           # premier administrateur principal (mot de passe saisi)
$C up -d app
curl -s http://127.0.0.1:3000/api/health      # {"status":"ok"}
```

**Rôle restreint de l'application** (`scripts/ops/app-role.sql`, idempotent).

L'application se connecte avec `systelec_app`, qui :
- lit et écrit les données ;
- n'a pas `TRUNCATE`, qui contournerait les triggers d'ajout seul du journal d'audit, des encaissements et des historiques ;
- ne peut ni créer, ni modifier, ni supprimer de tables ;
- n'accède pas à l'historique des migrations.

Les tables créées par les migrations futures lui sont accordées automatiquement. Seul `migrate` utilise le propriétaire.

À relancer si le mot de passe du rôle change. Si les journaux du serveur PostgreSQL enregistrent toutes les requêtes, le mot de passe y apparaît : désactivez cette journalisation pendant l'exécution.

## 5. Reverse proxy TLS (exemple Caddy)

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

Expiration des réservations, paniers et devis, alertes et relances des retours, toutes les 15 minutes (crontab de l'utilisateur qui exploite Docker) :

```
*/15 * * * * cd /srv/systelec && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tasks >> /var/log/systelec-taches.log 2>&1
```

## 7. Sauvegardes

```bash
scripts/ops/backup.sh /srv/sauvegardes        # base (pg_dump -Fc) + fichiers téléversés + SHA256SUMS
```

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
scripts/ops/restore.sh /srv/sauvegardes/<date> systelec_exercice /srv/exercice/storage
scripts/ops/verify-restore.sh systelec systelec_exercice   # contenu identique table par table (lignes + MD5)
```

`restore.sh` vérifie les empreintes et restaure dans une **base neuve** et un **dossier neuf**. Il refuse d'écraser une base existante, la base en service ou un dossier non vide. Il contrôle aussi le nombre de migrations restaurées.

`verify-restore.sh` compare les deux bases et échoue à la première différence. Ne lancer la comparaison que juste après la restauration : la base en service continue d'évoluer.

**Incident (bascule sur une sauvegarde)** :
1. `$C stop app` (et suspendre la tâche planifiée).
2. `scripts/ops/restore.sh <sauvegarde> systelec_restaure_<date> /srv/restaure/storage`.
3. Relancer `scripts/ops/app-role.sql` sur la base restaurée.
4. Recopier les fichiers dans le volume :
   ```bash
   docker run --rm -v systelec-sama-shop_storage:/dst -v /srv/restaure/storage:/src:ro alpine sh -c 'cp -a /src/. /dst/'
   ```
5. Mettre `POSTGRES_DB=systelec_restaure_<date>` dans `.env.production`, puis `$C up -d app` et vérifier la santé et quelques écrans.
6. L'ancienne base est conservée pour l'enquête ; ne la supprimer qu'après décision écrite.

Non exécuté pendant la stabilisation : les étapes 4 et 5. L'application a été démarrée directement sur la base restaurée, avec succès.

## 9. Mise à jour

1. Construire les images de la nouvelle version (section 2).
2. `scripts/ops/backup.sh /srv/sauvegardes` (sauvegarde de sécurité).
3. Mettre `APP_VERSION=<nouvelle>` dans `.env.production`.
4. `$C run --rm migrate`, puis `$C up -d app`, puis vérifier `curl …/api/health` et les écrans principaux.
5. **Retour arrière** : remettre l'ancienne `APP_VERSION` et `$C up -d app`. Les migrations ne vont que vers l'avant : si une migration de la nouvelle version a modifié le schéma de façon incompatible, restaurer la sauvegarde de l'étape 2 (section 8).

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
- Journaux JSON sur la sortie standard : `$C logs -f app`. Configurer la rotation des journaux Docker (`max-size`, `max-file`).
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

- [ ] Images construites et étiquetées ; `.env.production` rempli (mode 600)
- [ ] `db` démarré, migrations appliquées, rôle restreint créé (contrôle : `droits_truncate = 0`)
- [ ] `db:seed` lancé ; premier administrateur principal créé ; connexion vérifiée
- [ ] Reverse proxy TLS en place ; `https://…/api/health` répond `ok` ; en-têtes de sécurité présents
- [ ] Paramètres saisis dans l'administration : identité, NINEA, RCCM, horaires, jours fériés de l'année
- [ ] Zones de livraison, points de retrait, livreurs (internes reliés à leur compte)
- [ ] Tâche planifiée installée (toutes les 15 minutes)
- [ ] Sauvegarde nocturne planifiée **et copiée hors serveur** ; premier exercice de restauration réussi
- [ ] Sonde externe et alerte d'espace disque en place
- [ ] Test `no-new-privileges` fait sur le serveur ; option activée si possible
