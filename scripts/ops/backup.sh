#!/usr/bin/env bash
# Sauvegarde de production : base PostgreSQL (format personnalisé, pg_dump -Fc) et fichiers téléversés
# (volume storage), avec empreintes SHA-256 et contrôle de lisibilité du dump.
# Voir docs/04-mise-en-service.md (planification, rotation, copie hors serveur).
#
# Usage : scripts/ops/backup.sh [dossier_parent]        (défaut : ./sauvegardes)
# Variables :
#   SAMA_ENV_FILE   fichier de configuration (défaut : .env.production)
#   SAMA_COMPOSE    commande compose (défaut : docker compose -f docker-compose.prod.yml --env-file "$SAMA_ENV_FILE")
# N'arrête pas le service : pg_dump lit un instantané cohérent ; l'archive des fichiers est faite ensuite.
set -euo pipefail

ENV_FILE="${SAMA_ENV_FILE:-.env.production}"
COMPOSE="${SAMA_COMPOSE:-docker compose -f docker-compose.prod.yml --env-file $ENV_FILE}"
PARENT="${1:-./sauvegardes}"

[[ -f "$ENV_FILE" ]] || { echo "Configuration introuvable : $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
DB_USER="${POSTGRES_USER:-systelec_owner}"
DB_NAME="${POSTGRES_DB:-systelec}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$PARENT/$STAMP"
umask 077
mkdir -p "$TARGET"

echo "Sauvegarde de la base $DB_NAME…"
$COMPOSE exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-password > "$TARGET/base.dump"

echo "Contrôle du dump (pg_restore --list)…"
TABLES="$($COMPOSE exec -T db pg_restore --list < "$TARGET/base.dump" | grep -c ' TABLE DATA ' || true)"
[[ "$TABLES" -gt 0 ]] || { echo "Dump illisible ou vide : sauvegarde invalide" >&2; exit 1; }

echo "Sauvegarde des fichiers téléversés…"
$COMPOSE exec -T app tar -C /app/storage -czf - . > "$TARGET/storage.tar.gz"
tar -tzf "$TARGET/storage.tar.gz" > /dev/null

MIGRATIONS="$($COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
{
  echo "date_utc=$STAMP"
  echo "base=$DB_NAME"
  echo "tables_avec_donnees=$TABLES"
  echo "migrations_appliquees=$MIGRATIONS"
} > "$TARGET/manifeste.txt"
(cd "$TARGET" && sha256sum base.dump storage.tar.gz manifeste.txt > SHA256SUMS)

echo "Sauvegarde terminée : $TARGET ($TABLES tables, $MIGRATIONS migrations)"
echo "À copier HORS du serveur (chiffrée) : une sauvegarde restée sur le même disque ne protège de rien."
