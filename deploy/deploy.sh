#!/usr/bin/env bash
# Build the fable and push it to a static host over ssh.
#
#   ./deploy/deploy.sh you@your-server [/var/www/fables-choice]
#
# The whole site is dist/index.html; rsync is used so a future dist/ with
# more files (a second fable?) deploys the same way. If the box lacks rsync:
#   scp dist/index.html you@your-server:/var/www/fables-choice/
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${1:?usage: deploy.sh user@host [remote-dir]}"
DEST="${2:-/var/www/fables-choice}"

node build.js
rsync -az --delete dist/ "$HOST:$DEST/"
echo "deployed → $HOST:$DEST (see deploy/nginx.conf for the server block)"
