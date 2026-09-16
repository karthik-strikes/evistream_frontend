#!/bin/bash
# Deploy the frontend without taking the site down.
#
# `next build` empties its output directory and refills it over ~75s, and
# `next start` reads that directory on every request. Building straight into
# `.next` therefore 500s every request for the length of the build. So: build
# into a staging directory the live server is not reading, and swap it in once
# the build has actually succeeded. Downtime is the systemd restart (~2s), and a
# failed build leaves the current site untouched.
set -euo pipefail

cd /home/ubuntu/evistream/frontend
STAGE=.next-staging
PREV=.next-previous
LOG=/home/ubuntu/evistream/logs/nextjs-build.log

echo "[$(date)] Building into $STAGE" >> "$LOG"
rm -rf "$STAGE"
NEXT_DIST_DIR="$STAGE" npm run build >> "$LOG" 2>&1

[ -f "$STAGE/BUILD_ID" ] || { echo "[$(date)] BUILD FAILED — site untouched." >> "$LOG"; exit 1; }

# The build stamps its own distDir into the server manifest. Rewrite it, or the
# started server looks for `.next-staging` and 500s exactly like before.
python3 - "$STAGE" <<'PY'
import json, sys
p = f"{sys.argv[1]}/required-server-files.json"
d = json.load(open(p))
d["config"]["distDir"] = ".next"
json.dump(d, open(p, "w"))
PY

rm -rf "$PREV"
[ -d .next ] && mv .next "$PREV"
mv "$STAGE" .next
sudo systemctl restart evistream-nextjs.service
sleep 4

CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ || echo 000)
if [ "$CODE" = "200" ]; then
  rm -rf "$PREV"
  echo "[$(date)] Deployed $(cat .next/BUILD_ID) — site 200." >> "$LOG"
  echo "deployed $(cat .next/BUILD_ID) — root=200"
else
  # Put the previous build back rather than leaving the site broken.
  echo "[$(date)] Post-deploy check returned $CODE — rolling back." >> "$LOG"
  rm -rf .next-bad && mv .next .next-bad && mv "$PREV" .next
  sudo systemctl restart evistream-nextjs.service
  echo "rolled back — new build returned $CODE, see $LOG"
  exit 1
fi
