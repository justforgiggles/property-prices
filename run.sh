#!/bin/sh
set -eu

cd "$(dirname "$0")"
. "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
nvm exec 22 npm run scrape -- "$@"
