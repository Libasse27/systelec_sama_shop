#!/usr/bin/env bash
# Premier démarrage de production (docs/04-mise-en-service.md, section 4), dans l'ordre :
# contrôles, base, migrations, rôle restreint, données de base, premier administrateur, application.
# Relançable : chaque étape est idempotente, et la création de l'administrateur est sautée s'il existe déjà.
# Ne supprime ni ne réinitialise rien.
#
# Usage : scripts/ops/first-start.sh            (à lancer dans un terminal : le mot de passe est saisi au clavier)
# Variables : SAMA_ENV_FILE, SAMA_COMPOSE (comme backup.sh).
set -euo pipefail

ENV_FILE="${SAMA_ENV_FILE:-.env.production}"
COMPOSE="${SAMA_COMPOSE:-docker compose -f docker-compose.prod.yml --env-file $ENV_FILE}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { echo; echo "── $1"; }

step "Contrôles préalables"
SAMA_ENV_FILE="$ENV_FILE" SAMA_COMPOSE="$COMPOSE" "$HERE/preflight.sh" || { echo "Contrôles bloquants en échec : arrêt." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
DB_USER="${POSTGRES_USER:-systelec_owner}"
DB_NAME="${POSTGRES_DB:-systelec}"
APP_ROLE="${APP_DB_USER:-systelec_app}"
sql() { $COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -tAc "$1"; }

step "Base PostgreSQL"
$COMPOSE up -d --wait db

step "Migrations (rôle propriétaire)"
$COMPOSE run --rm migrate

step "Rôle restreint de l'application ($APP_ROLE)"
$COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q \
  -v app_role="$APP_ROLE" -v app_password="$APP_DB_PASSWORD" < "$HERE/app-role.sql" > /dev/null
TRUNCATE_GRANTS="$(sql "SELECT count(*) FROM information_schema.table_privileges WHERE grantee = '$APP_ROLE' AND privilege_type = 'TRUNCATE'")"
CAN_CREATE="$(sql "SELECT has_schema_privilege('$APP_ROLE', 'public', 'CREATE')")"
[[ "$TRUNCATE_GRANTS" == 0 && "$CAN_CREATE" == f ]] || { echo "Rôle $APP_ROLE trop permissif (TRUNCATE=$TRUNCATE_GRANTS, CREATE=$CAN_CREATE)" >&2; exit 1; }
echo "Rôle $APP_ROLE : aucun droit TRUNCATE ni de création de tables."

step "Données de base (rôles, permissions, catalogue initial)"
$COMPOSE run --rm tasks pnpm db:seed

step "Premier administrateur principal"
ADMINS="$(sql "SELECT count(*) FROM user_roles ur JOIN roles r ON r.id = ur.\"roleId\" JOIN users u ON u.id = ur.\"userId\" WHERE r.code = 'SUPER_ADMIN' AND u.\"isActive\"")"
if [[ "$ADMINS" -gt 0 ]]; then
  echo "Un administrateur principal actif existe déjà : étape sautée."
elif [[ -t 0 ]]; then
  $COMPOSE run --rm tasks pnpm admin:create
else
  echo "Pas de terminal : lancez ensuite « $COMPOSE run --rm tasks pnpm admin:create »." >&2
fi

step "Application"
$COMPOSE up -d --wait app
HEALTH="$(curl -fsS "http://127.0.0.1:${APP_PORT:-3000}/api/health")"
echo "Sonde de santé : $HEALTH"
[[ "$HEALTH" == *'"ok"'* ]] || { echo "Application démarrée mais sonde en échec" >&2; exit 1; }

echo
echo "Premier démarrage terminé. Suite : reverse proxy TLS, tâche planifiée, sauvegardes (docs/04, sections 5 à 7"
echo "et liste de contrôle, section 13)."
