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

Sur le serveur, dans `/srv/systelec` (dépôt cloné à la version à déployer) :

```bash
git clone https://github.com/Libasse27/systelec_sama_shop.git /srv/systelec && cd /srv/systelec
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
docker build --target app   -t systelec-sama-shop:$VERSION .
docker build --target tools -t systelec-sama-shop-tools:$VERSION .
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

L'application se connecte avec `systelec_app`, qui :
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

Expiration des réservations, paniers et devis, alertes et relances des retours, renvoi des e-mails en échec, toutes les 15 minutes (crontab de l'utilisateur qui exploite Docker). Modèle avec la sauvegarde nocturne : `deploy/crontab.example` (créer d'abord `/var/log/systelec`, accessible en écriture à cet utilisateur).

```
*/15 * * * * cd /srv/systelec && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tasks >> /var/log/systelec/taches.log 2>&1
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
scripts/ops/restore.sh /srv/sauvegardes/<date> systelec_exercice /srv/exercice/storage
scripts/ops/verify-restore.sh systelec systelec_exercice   # contenu identique table par table (lignes + MD5)
```

`restore.sh` exige le service `db` démarré, une sauvegarde complète (`SHA256SUMS`, dump, archive et manifeste), et un accès en écriture à la base et au parent du dossier cible. Il vérifie les empreintes et restaure dans une **base neuve** et un **dossier absent ou vide**. Il refuse d'écraser une base existante, la base en service ou un dossier non vide. Il contrôle aussi le nombre de migrations restaurées.

`verify-restore.sh` exige le service `db` démarré et les deux bases accessibles au rôle propriétaire ; il compare les bases et échoue à la première différence. Ne lancer la comparaison que juste après la restauration : la base en service continue d'évoluer.

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

La migration `20261019090000_notification_retries` a été testée avec `pnpm test:migration` sur un PostgreSQL jetable : le test provoque un échec, vérifie l'annulation transactionnelle, puis la reprise avec Prisma. La procédure opérationnelle complète ci-dessous (sauvegarde, mise à jour de la pile, contrôles et retour arrière) est documentée, mais n'a pas été vérifiée de bout en bout sur une pile jetable pour cette version. `ANCIENNE` et `NOUVELLE` désignent les étiquettes d'images (section 2).

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
6. **Appliquer les migrations** : `$C run --rm migrate`, puis `$C run --rm migrate pnpm exec prisma migrate status` doit afficher « Database schema is up to date! ». Si la version ajoute des permissions (c'est le cas du module Contact, section 14), lancer ensuite `$C run --rm tasks pnpm db:seed` : sans cela, personne n'a accès aux nouveaux écrans.
7. **En cas d'échec de la migration** (le service ancien continue de tourner : le schéma n'a pas changé ou la migration est atomique) :
   - **Diagnostic** : `$C logs --since 30m db | grep ERROR` donne la cause exacte (Prisma n'affiche parfois que « current transaction is aborted »). `migrate status` liste la migration en échec ; une relance est refusée (`P3009`) tant que l'échec n'est pas résolu (`P3018` désigne l'échec lui-même).
   - **Vérifier ce qui a été appliqué** : `$C exec -T db psql -U systelec_owner -d systelec -c '\d notifications'` (valeurs de `POSTGRES_USER` et `POSTGRES_DB`, à saisir sans charger le fichier dans le shell) (adapter la table à la migration). La migration `20261019090000_notification_retries` est transactionnelle : après un échec, **rien** n'est appliqué (pas de colonne `attempts`).
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
10. **Réactiver la tâche planifiée** : décommenter la ligne dans `crontab -e`, vérifier `crontab -l`, puis, au quart d'heure suivant, la nouvelle entrée de `/var/log/systelec/taches.log`.
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
   $C exec -T db psql -U systelec_owner -d systelec -c "SELECT ip, \"createdAt\" FROM audit_logs WHERE action = 'contact_message.create' ORDER BY \"createdAt\" DESC LIMIT 1"
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
