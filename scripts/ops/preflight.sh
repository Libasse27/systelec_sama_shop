#!/usr/bin/env bash
# shellcheck disable=SC2015  # « test && ok || fail » : ok, warn et fail renvoient toujours 0.
# Contrôles AVANT installation ou mise à jour, sur le serveur de production. Lecture seule : ne démarre,
# n'arrête et ne modifie rien (seul le test no-new-privileges lance un conteneur jetable de l'image app).
# Voir docs/04-mise-en-service.md.
#
# Usage : scripts/ops/preflight.sh
# Variables : SAMA_ENV_FILE, SAMA_COMPOSE (comme backup.sh).
# Code de sortie : 1 si un contrôle bloquant échoue ; les avertissements ne bloquent pas.
set -uo pipefail

ENV_FILE="${SAMA_ENV_FILE:-.env.production}"
COMPOSE="${SAMA_COMPOSE:-docker compose -f docker-compose.prod.yml --env-file $ENV_FILE}"
MIN_DOCKER_MAJOR=27
MIN_CPUS=2
MIN_MEMORY_MB=3800
MIN_DISK_GB=10
SECRET_MIN=24
FAILURES=0
WARNINGS=0

ok()   { echo "  OK         $1"; }
warn() { echo "  ATTENTION  $1"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "  ÉCHEC      $1"; FAILURES=$((FAILURES + 1)); }

echo "Docker"
if ! command -v docker > /dev/null; then
  fail "docker introuvable"
else
  DOCKER_VERSION="$(docker version --format '{{.Server.Version}}' 2> /dev/null || true)"
  if [[ -z "$DOCKER_VERSION" ]]; then fail "démon Docker injoignable (droits de l'utilisateur ?)"
  elif (( ${DOCKER_VERSION%%.*} < MIN_DOCKER_MAJOR )); then fail "Docker $DOCKER_VERSION (il faut $MIN_DOCKER_MAJOR ou plus)"
  else ok "Docker $DOCKER_VERSION"; fi
  if docker compose version > /dev/null 2>&1; then ok "$(docker compose version)"; else fail "Docker Compose v2 absent"; fi
fi

echo "Ressources"
CPUS="$(nproc 2> /dev/null || echo 0)"
(( CPUS >= MIN_CPUS )) && ok "$CPUS processeurs" || warn "$CPUS processeur(s) ($MIN_CPUS conseillés)"
MEMORY_MB="$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo 2> /dev/null || echo 0)"
(( MEMORY_MB >= MIN_MEMORY_MB )) && ok "$MEMORY_MB Mo de mémoire" || warn "$MEMORY_MB Mo de mémoire (4 Go conseillés)"
DOCKER_ROOT="$(docker info --format '{{.DockerRootDir}}' 2> /dev/null || echo /)"
DISK_GB="$(df -P --block-size=1G "$DOCKER_ROOT" 2> /dev/null | awk 'NR == 2 { print $4 }')"
(( ${DISK_GB:-0} >= MIN_DISK_GB )) && ok "${DISK_GB} Go libres ($DOCKER_ROOT)" || warn "${DISK_GB:-?} Go libres sur $DOCKER_ROOT ($MIN_DISK_GB conseillés)"

echo "Configuration ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  fail "$ENV_FILE introuvable (scripts/ops/init-env.sh)"
else
  MODE="$(stat -c %a "$ENV_FILE")"
  [[ "$MODE" == 600 ]] && ok "droits 600" || fail "droits $MODE (attendu : chmod 600 $ENV_FILE)"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  AUTH_SECRET="${AUTH_SECRET:-}" POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}" APP_DB_PASSWORD="${APP_DB_PASSWORD:-}"
  [[ -n "${APP_VERSION:-}" ]] && ok "APP_VERSION=$APP_VERSION" || fail "APP_VERSION vide"
  if [[ "${APP_URL:-}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then ok "APP_URL=$APP_URL"; else fail "APP_URL invalide (https://domaine, sans slash final)"; fi
  (( ${#AUTH_SECRET} >= 32 )) && ok "AUTH_SECRET présent" || fail "AUTH_SECRET absent ou trop court (32 caractères)"
  (( ${#POSTGRES_PASSWORD} >= SECRET_MIN )) && ok "POSTGRES_PASSWORD présent" || fail "POSTGRES_PASSWORD absent ou trop court ($SECRET_MIN caractères)"
  (( ${#APP_DB_PASSWORD} >= SECRET_MIN )) && ok "APP_DB_PASSWORD présent" || fail "APP_DB_PASSWORD absent ou trop court ($SECRET_MIN caractères)"
  [[ "${APP_DB_PASSWORD:-}" != "${POSTGRES_PASSWORD:-}" ]] || fail "APP_DB_PASSWORD identique à POSTGRES_PASSWORD"
  [[ "${APP_DB_USER:-systelec_app}" != "${POSTGRES_USER:-systelec_owner}" ]] && ok "rôle applicatif distinct du propriétaire" || fail "APP_DB_USER identique à POSTGRES_USER"
  [[ "${TRUSTED_PROXY_HOPS:-1}" =~ ^[0-5]$ ]] && ok "TRUSTED_PROXY_HOPS=${TRUSTED_PROXY_HOPS:-1}" || fail "TRUSTED_PROXY_HOPS invalide (0 à 5)"
  if [[ -z "${SMTP_HOST:-}" ]]; then
    warn "SMTP_HOST vide : aucun e-mail ne sera envoyé (confirmations, relances des retours, réinitialisations)"
  elif [[ ! "${SMTP_PORT:-}" =~ ^[0-9]+$ || -z "${SMTP_FROM:-}" ]]; then
    fail "SMTP_HOST renseigné sans SMTP_PORT numérique ou sans SMTP_FROM"
  elif [[ -n "${SMTP_USER:-}" && -z "${SMTP_PASSWORD:-}" ]] || [[ -z "${SMTP_USER:-}" && -n "${SMTP_PASSWORD:-}" ]]; then
    fail "SMTP_USER et SMTP_PASSWORD vont ensemble"
  else
    ok "SMTP ${SMTP_HOST}:${SMTP_PORT}, expéditeur ${SMTP_FROM} (SPF, DKIM et DMARC à publier dans le DNS)"
  fi
  if $COMPOSE config --quiet 2> /dev/null; then ok "docker-compose.prod.yml valide avec cette configuration"; else fail "docker compose config refuse la configuration"; fi
fi

echo "Images"
APP_REF="${APP_IMAGE:-systelec-sama-shop}:${APP_VERSION:-absente}"
TOOLS_REF="${TOOLS_IMAGE:-systelec-sama-shop-tools}:${APP_VERSION:-absente}"
APP_PRESENT=0
if docker image inspect "$APP_REF" > /dev/null 2>&1; then ok "$APP_REF"; APP_PRESENT=1; else fail "$APP_REF absente (docs/04, section 2)"; fi
docker image inspect "$TOOLS_REF" > /dev/null 2>&1 && ok "$TOOLS_REF" || fail "$TOOLS_REF absente (docs/04, section 2)"

echo "Réseau et durcissement"
if command -v ss > /dev/null; then
  for PORT in 80 443; do
    ss -Hltn "sport = :$PORT" | grep -q . && ok "port $PORT à l'écoute (reverse proxy ?)" || warn "port $PORT libre : reverse proxy TLS pas encore en place"
  done
  ss -Hltn "sport = :${APP_PORT:-3000}" | grep -q . && warn "port local ${APP_PORT:-3000} déjà occupé (normal si l'application tourne déjà)" || ok "port local ${APP_PORT:-3000} libre"
else
  warn "ss absent : ports non contrôlés"
fi
if (( APP_PRESENT )); then
  if docker run --rm --security-opt no-new-privileges:true --entrypoint node "$APP_REF" -e 0 > /dev/null 2>&1; then
    ok "no-new-privileges fonctionne ici : l'activer dans docker-compose.prod.yml (x-hardening)"
  else
    warn "no-new-privileges refusé sur ce serveur : le laisser désactivé (docs/04, section 12)"
  fi
fi

echo
echo "Bilan : $FAILURES échec(s), $WARNINGS avertissement(s)."
(( FAILURES == 0 ))
