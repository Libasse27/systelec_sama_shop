#!/usr/bin/env bash
# Exercice de restauration : compare, table par table, une base et sa restauration (nombre de lignes et
# empreinte MD5 du contenu trié). Lecture seule. Sort en erreur à la première différence.
#
# Usage : scripts/ops/verify-restore.sh <base_origine> <base_restauree>
# Variables : SAMA_ENV_FILE, SAMA_COMPOSE (comme backup.sh).
set -euo pipefail

ORIGIN="${1:?Usage : verify-restore.sh <base_origine> <base_restauree>}"
RESTORED="${2:?Base restaurée requise}"
ENV_FILE="${SAMA_ENV_FILE:-.env.production}"
COMPOSE="${SAMA_COMPOSE:-docker compose -f docker-compose.prod.yml --env-file $ENV_FILE}"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
DB_USER="${POSTGRES_USER:-systelec_owner}"

# Pour chaque table du schéma public : « table|lignes|md5 », trié (le contenu est ordonné par sa forme texte).
SNAPSHOT_SQL=$(cat <<'SQL'
DO $$
DECLARE t record; n bigint; h text;
BEGIN
  CREATE TEMP TABLE instantane (nom text, lignes bigint, empreinte text);
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*), coalesce(md5(string_agg(x::text, E''\n'' ORDER BY x::text)), '''') FROM %I x', t.tablename) INTO n, h;
    INSERT INTO instantane VALUES (t.tablename, n, h);
  END LOOP;
END $$;
SELECT nom || '|' || lignes || '|' || empreinte FROM instantane ORDER BY nom;
SQL
)

snapshot() { $COMPOSE exec -T db psql -U "$DB_USER" -d "$1" -tAq -v ON_ERROR_STOP=1 -c "$SNAPSHOT_SQL" | grep '|'; }

A="$(snapshot "$ORIGIN")"
B="$(snapshot "$RESTORED")"
TABLES="$(wc -l <<< "$A")"
if [[ "$A" == "$B" ]]; then
  ROWS="$(awk -F'|' '{ s += $2 } END { print s }' <<< "$A")"
  echo "Restauration conforme : $TABLES tables, $ROWS lignes, contenu identique (MD5 par table)."
else
  echo "DIFFÉRENCES entre $ORIGIN et $RESTORED :" >&2
  diff <(echo "$A") <(echo "$B") >&2 || true
  exit 1
fi
