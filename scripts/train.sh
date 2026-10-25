#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$repository/packages/model/.venv/bin/python" -m prop_radar.train.main "$@"
