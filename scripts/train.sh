#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$repository/packages/model/.venv/bin/python" -m property_model train "$@"
