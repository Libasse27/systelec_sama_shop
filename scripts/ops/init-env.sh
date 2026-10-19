#!/usr/bin/env bash
# Crée .env.production à partir du modèle .env.production.example, avec des secrets aléatoires
# (AUTH_SECRET, POSTGRES_PASSWORD, APP_DB_PASSWORD). Refuse d'écraser un fichier existant : changer un
# secret en service se fait à la main (voir docs/04-mise-en-service.md, « Sécurité d'exploitation »).
#
# Usage : scripts/ops/init-env.sh <APP_URL> <APP_VERSION>
#   APP_URL       https://votre-domaine (sans slash final)
#   APP_VERSION   étiquette des images construites (docs/04, section 2)
# Variables : SAMA_ENV_FILE (défaut : .env.production), SAMA_ENV_TEMPLATE (défaut : .env.production.example).
# Les secrets ne sont jamais affichés. Les variables SMTP restent à remplir à la main (facultatives).
set -euo pipefail

APP_URL="${1:?Usage : init-env.sh <APP_URL> <APP_VERSION>}"
APP_VERSION="${2:?Usage : init-env.sh <APP_URL> <APP_VERSION>}"
ENV_FILE="${SAMA_ENV_FILE:-.env.production}"
TEMPLATE="${SAMA_ENV_TEMPLATE:-.env.production.example}"

[[ "$APP_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "APP_URL invalide : https://domaine, sans chemin ni slash final" >&2; exit 1; }
[[ "$APP_VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "APP_VERSION invalide : $APP_VERSION" >&2; exit 1; }
[[ -f "$TEMPLATE" ]] || { echo "Modèle introuvable : $TEMPLATE" >&2; exit 1; }
[[ ! -e "$ENV_FILE" ]] || { echo "Refus : $ENV_FILE existe déjà (aucun écrasement de secrets)" >&2; exit 1; }
command -v openssl > /dev/null || { echo "openssl requis" >&2; exit 1; }

# Remplace la valeur de la clé $1 par $2 (première occurrence « CLE=… » en début de ligne).
set_value() {
  awk -v key="$1" -v value="$2" 'BEGIN { done = 0 }
    !done && index($0, key "=") == 1 { print key "=" value; done = 1; next } { print }' "$ENV_FILE" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

umask 077
cp "$TEMPLATE" "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_value APP_URL "$APP_URL"
set_value APP_VERSION "$APP_VERSION"
set_value AUTH_SECRET "$(openssl rand -base64 32)"
set_value POSTGRES_PASSWORD "$(openssl rand -hex 24)"
set_value APP_DB_PASSWORD "$(openssl rand -hex 24)"

echo "$ENV_FILE créé (mode 600) : APP_URL=$APP_URL, APP_VERSION=$APP_VERSION, secrets générés."
echo "Facultatif : renseigner SMTP_* pour l'envoi d'e-mails. Puis : scripts/ops/preflight.sh"
echo "Conservez une copie de ce fichier dans un coffre de mots de passe : il est indispensable à une restauration."
