# Rapport de phase 3 — Authentification et permissions

**Branche :** `feat/phase-3-auth` · **Date :** 2026-10-13

## Livré

| Élément | Fichiers |
|---|---|
| Tables d'identité Better Auth + champs SYSTELEC (`kind`, `isActive`, `phone`), RBAC (rôles, permissions, liaisons) | `prisma/schema.prisma`, migration `*_auth_rbac` |
| 27 permissions et 10 rôles (§14), synchronisés depuis le code, synchronisation idempotente et auditée | `src/server/authz/{permissions,roles,sync}.ts`, `pnpm db:seed` |
| Garde serveur : permissions vérifiées dans les services, refus journalisés (`DENIED`) | `src/server/authz/service.ts`, `src/server/auth/session.ts` |
| Attribution et retrait de rôles audités ; seul un administrateur principal gère ce rôle ; le dernier administrateur principal actif ne peut pas être retiré | `src/server/authz/service.ts` |
| Inscription client, connexion, déconnexion, réinitialisation du mot de passe, toutes auditées | `src/server/auth/{auth,service,schemas}.ts`, `src/app/(auth)/**` |
| Limitation des tentatives sur 15 minutes. Connexion : 5 échecs par couple (e-mail, IP), 20 par e-mail, 30 par IP, sous verrou par e-mail. Inscription : 10 par IP. Demandes de réinitialisation : 3 par e-mail, 10 par IP | `src/server/auth/{limits,client-ip,service}.ts`, table `login_attempts` |
| Aucune route HTTP Better Auth exposée : tout passe par des Server Actions validées | `src/app/(auth)/actions.ts` |
| Comptes désactivés : aucune session possible, aucune permission | hook de session, `loadAccess` |
| Pages : connexion, inscription, mot de passe oublié, nouveau mot de passe, `/compte`, `/admin`, accès refusé | `src/app/**` |
| Proxy : redirection anticipée des espaces privés, CSP avec nonce par requête | `src/proxy.ts` |
| CLI : premier administrateur principal (mot de passe saisi masqué), lien de réinitialisation sans SMTP (D11) | `scripts/`, `pnpm admin:create`, `pnpm admin:reset-link <email>` |
| Envoi d'e-mails : point unique, inactif tant que le SMTP n'est pas configuré (aucun envoi simulé) | `src/server/notifications/mailer.ts` |

## Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `pnpm lint` | OK |
| `pnpm typecheck` | OK |
| `pnpm test` | 16 fichiers, 100 tests réussis (dont intégration PostgreSQL et concurrence) |
| `pnpm build` | OK |
| `pnpm test:e2e` | 24 tests réussis (bureau et mobile) |
| `pnpm admin:reset-link` (chemins d'erreur) | adresse inconnue et argument manquant refusés |
| `pnpm db:seed` (2 fois, base de dev) | 27 permissions + 10 rôles, puis aucun changement |

Critères §20 couverts :

- **n° 1, création et connexion d'un compte client** : intégration (inscription, connexion, échecs, blocage, compte désactivé, déconnexion, réinitialisation) et E2E (inscription, déconnexion, reconnexion, erreurs).
- **n° 2, protection des routes privées** : E2E (`/compte` et `/admin` en anonyme, client sur `/admin`).
- **n° 3, permissions de chaque rôle** : unitaires (matrice) et intégration (un test par rôle sur PostgreSQL).
- **n° 24, journalisation des actions sensibles** : intégration (connexions, inscriptions, refus d'autorisation, rôles, synchronisation) et vérification qu'aucun mot de passe n'apparaît dans l'audit.

## Revues (code-reviewer + security-reviewer)

Aucun point CRITICAL, aucun contournement d'authentification ni élévation de privilèges. Corrigé, avec des tests :

- **IP falsifiable** : l'IP est lue au rang du proxy de confiance (`TRUSTED_PROXY_HOPS`) et validée. Comportement de Next vérifié dans son code : il ne renseigne `X-Forwarded-For` que si l'en-tête est absent.
- **Limiteur non atomique** :
  - Constat : une première version gardait une transaction ouverte pendant l'appel à Better Auth. Le test de concurrence a montré que le pool de connexions s'épuisait, ce qui permettait un déni de service.
  - Correctif : la tentative est réservée dans une transaction courte, sous verrou, dans la table purgeable `login_attempts`.
- **Blocage d'un compte par un tiers** : le plafond principal porte sur le couple (e-mail, IP).
- **Remplissage du journal append-only** : un seul refus est journalisé par fenêtre. Les inscriptions et les demandes de réinitialisation sont limitées.
- **Redirection ouverte** via des caractères de contrôle (`/\t/hôte`) : ces caractères sont refusés et l'origine est vérifiée.
- **Rôles** :
  - le rôle d'un administrateur principal désactivé peut être retiré ;
  - un compte sans rôle redevient client ;
  - un utilisateur ou un rôle inconnu donne `NOT_FOUND`.
- **Audit** :
  - les tentatives de connexion utilisent l'entité `LoginAttempt` (et l'acteur en cas de succès) ;
  - la réinitialisation est attribuée au compte concerné.
- **CLI**
  - `admin:reset-link` : journalisation de l'opérateur système, `--confirmer` exigé pour un compte du personnel.
  - `admin:create` : verrou, nettoyage en cas d'échec, mot de passe non rogné.
- **Tests** :
  - matrice des rôles écrite en dur, indépendante du code ;
  - E2E d'un compte du personnel et d'un cookie forgé ;
  - cas limites.
- **Divers** : index sur `audit_logs`, `SMTP_PORT` strict, ordre des champs du logger.

## Risques acceptés (à revoir)

- **Énumération par l'inscription** : un e-mail déjà pris est signalé, et il n'y a pas de vérification d'e-mail. Correctif prévu avec le SMTP (D11) : `requireEmailVerification` et une réponse identique dans les deux cas.
- **L'application doit être servie derrière le reverse proxy**, avec `TRUSTED_PROXY_HOPS=1`. Exposée directement, l'IP client n'est pas fiable. Mettre aussi en place le masquage du paramètre `token` dans les journaux du proxy (phase 10).
- **Rendu dynamique de toutes les pages** : l'en-tête dépend de la session, et les nonces CSP l'imposent de toute façon. À réévaluer pour la mise en cache du catalogue en phase 4.
- **CSP** : `style-src 'unsafe-inline'` et `img-src https:` sont conservés (logo administrable) ; les scripts sont protégés par nonce et `strict-dynamic`.
- **Rétention** : la purge de `login_attempts` (plus de 30 jours) et la politique de conservation de l'audit sont à planifier en phase 10.
- **Ordre des écritures** : l'audit d'un succès est écrit juste après l'action de Better Auth, hors transaction (limite de la bibliothèque).

## Non vérifié automatiquement

- `pnpm admin:create` est interactif. Il n'a pas été lancé, car le mot de passe doit être saisi par vous. Sa logique (rôle, audit, refus si un administrateur principal existe) reprend les services testés.

## Points ouverts

- SMTP (D11) : tant qu'il n'est pas configuré, les liens de réinitialisation sont générés par `pnpm admin:reset-link`.
- L'interface de gestion des utilisateurs et des rôles est prévue en phase 9. Les services `assignRole` et `revokeRole` sont prêts et testés.
- Hérité de la phase 2 : séparer le rôle PostgreSQL de migration du rôle applicatif (phase 10).
