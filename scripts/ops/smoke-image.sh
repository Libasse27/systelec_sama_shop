#!/usr/bin/env bash
# Test de fumée de l'image de production : le serveur démarre avec le durcissement de
# docker-compose.prod.yml et sert les ressources de public/, absentes par défaut en mode standalone.
# Sans base de données : ne vérifie ni /api/health ni les pages. Configuration factice, jamais de secret.
#
# Usage : scripts/ops/smoke-image.sh <image>
set -euo pipefail

IMAGE="${1:?Usage : smoke-image.sh <image>}"
CONTAINER="futani-smoke-$$"
START_ATTEMPTS=60
ASSETS=(/logos/futani-shop.png /icones/services/electricite.png)

trap 'docker rm -f "$CONTAINER" > /dev/null 2>&1 || true' EXIT

docker run -d --rm --name "$CONTAINER" --read-only --tmpfs /tmp --cap-drop ALL \
  -e APP_ENV=production \
  -e APP_URL=https://fumee.invalid \
  -e AUTH_SECRET=valeur-factice-du-test-de-fumee-sans-usage-reel \
  -e DATABASE_URL=postgresql://fumee:fumee@127.0.0.1:1/fumee \
  "$IMAGE" > /dev/null

# Affiche le statut HTTP et le type de contenu d'une adresse ; échoue si le serveur ne répond pas.
probe() {
  docker exec "$CONTAINER" node -e \
    "fetch('http://127.0.0.1:3000' + process.argv[1]).then((r) => console.log(r.status, r.headers.get('content-type'))).catch(() => process.exit(1))" \
    "$1"
}

attempt=0
until probe "${ASSETS[0]}" > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [[ "$attempt" -ge "$START_ATTEMPTS" ]]; then
    echo "Échec : le serveur ne répond pas après $START_ATTEMPTS essais" >&2
    docker logs --tail 20 "$CONTAINER" >&2
    exit 1
  fi
  timeout 1 tail -f /dev/null || true
done

failed=0
for asset in "${ASSETS[@]}"; do
  result="$(probe "$asset")" || { echo "Échec : $asset injoignable" >&2; docker logs --tail 20 "$CONTAINER" >&2; exit 1; }
  echo "$asset : $result"
  [[ "$result" == "200 image/png" ]] || failed=1
done

if [[ "$failed" -ne 0 ]]; then
  echo "Échec : ressources de public/ non servies par l'image $IMAGE" >&2
  exit 1
fi
echo "Image $IMAGE : démarrage et ressources de public/ vérifiés."
