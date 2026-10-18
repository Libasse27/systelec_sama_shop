#!/usr/bin/env bash
# Restauration d'une sauvegarde (scripts/ops/backup.sh) dans une base NEUVE, et des fichiers dans un
# dossier NEUF. Ne remplace jamais la base ni les fichiers en service : la bascule est une décision
# séparée (voir docs/04-mise-en-service.md, « Restaurer »).
#
# Usage : scripts/ops/restore.sh <dossier_de_sauvegarde> <base_cible> [dossier_fichiers_cible]
#   base_cible               nom d'une base qui N'EXISTE PAS encore (ex. systelec_restauration_20261019)
#   dossier_fichiers_cible   défaut : ./restauration/<base_cible>/storage (doit être absent ou vide)
# Variables : SAMA_ENV_FILE, SAMA_COMPOSE (comme backup.sh).
set -euo pipefail

SOURCE="${1:?Usage : restore.sh <dossier_de_sauvegarde> <base_cible> [dossier_fichiers_cible]}"
TARGET_DB="${2:?Base cible requise (elle ne doit pas exister)}"
FILES_DIR="${3:-./restauration/$TARGET_DB/storage}"
ENV_FILE="${SAMA_ENV_FILE:-.env.production}"
COMPOSE="${SAMA_COMPOSE:-docker compose -f docker-compose.prod.yml --env-file $ENV_FILE}"

[[ "$TARGET_DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "Nom de base invalide : $TARGET_DB" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Configuration introuvable : $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
DB_USER="${POSTGRES_USER:-systelec_owner}"
LIVE_DB="${POSTGRES_DB:-systelec}"
[[ "$TARGET_DB" != "$LIVE_DB" ]] || { echo "Refus : la base cible est la base en service ($LIVE_DB)" >&2; exit 1; }

echo "Vérification des empreintes…"
(cd "$SOURCE" && sha256sum --check --quiet SHA256SUMS)

EXISTS="$($COMPOSE exec -T db psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")"
[[ -z "$EXISTS" ]] || { echo "Refus : la base $TARGET_DB existe déjà (aucun écrasement)" >&2; exit 1; }
if [[ -e "$FILES_DIR" ]] && [[ -n "$(ls -A "$FILES_DIR" 2>/dev/null)" ]]; then
  echo "Refus : $FILES_DIR n'est pas vide (aucun écrasement)" >&2; exit 1
fi

echo "Création de la base $TARGET_DB et restauration…"
$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$TARGET_DB\""
$COMPOSE exec -T db pg_restore -U "$DB_USER" -d "$TARGET_DB" --exit-on-error --no-owner < "$SOURCE/base.dump"

echo "Restauration des fichiers dans $FILES_DIR…"
umask 077
mkdir -p "$FILES_DIR"
tar -xzf "$SOURCE/storage.tar.gz" -C "$FILES_DIR"

EXPECTED="$(grep '^migrations_appliquees=' "$SOURCE/manifeste.txt" | cut -d= -f2)"
RESTORED="$($COMPOSE exec -T db psql -U "$DB_USER" -d "$TARGET_DB" -tAc 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
[[ "$EXPECTED" == "$RESTORED" ]] || { echo "Migrations : $RESTORED restaurées, $EXPECTED attendues" >&2; exit 1; }

echo "Restauration terminée : base $TARGET_DB ($RESTORED migrations), fichiers dans $FILES_DIR."
echo "Contrôle conseillé : scripts/ops/verify-restore.sh $LIVE_DB $TARGET_DB (si la base d'origine est disponible)."
