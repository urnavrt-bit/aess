#!/usr/bin/env bash
# Deploy the committed main branch to the production checkout and restart.
#   scripts/deploy.sh            (run from the development repo)
# Production: ~/aess (checkout), ~/aess-data (codes DB + build cache), systemd user unit "aess".
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PROD="${AESS_PROD:-$HOME/aess}"
URL="${AESS_URL:-http://127.0.0.1:8000}"

if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  echo "refusing to deploy: uncommitted changes in $SRC" >&2; exit 1
fi
python3 "$SRC/scripts/lock_models.py"
python3 -m unittest discover -s "$SRC/tests" -q

[ -d "$PROD/.git" ] || git clone -q "$SRC" "$PROD"
git -C "$PROD" fetch -q "$SRC" main
git -C "$PROD" reset -q --hard FETCH_HEAD
systemctl --user restart aess
for _ in $(seq 1 30); do curl -sf "$URL/api/health" >/dev/null && break; sleep 0.5; done
echo "deployed $(git -C "$PROD" log --oneline -1)"
python3 "$SRC/scripts/warm_cache.py" "$URL" || true
