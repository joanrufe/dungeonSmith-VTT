#!/usr/bin/env bash
# Dev launcher for SceneSmith-VTT (Ubuntu / Linux).
# Equivalent of the Windows .bat files — but the Windows ones automate the exact
# same steps: create venv, install deps, run app.py.
#
# Usage:
#   ./run_dev.sh            # default port 3000
#   ./run_dev.sh 3100       # custom port (overrides VTT_PORT env)
#   VTT_PORT=3200 ./run_dev.sh
#
# Logs go to the terminal. Stop with Ctrl+C.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-${VTT_PORT:-3000}}"

# 1. Ensure virtualenv exists (creates on first run only)
if [ ! -d ".venv" ]; then
  echo ">> Creating .venv ..."
  python3 -m venv .venv
fi

# 2. Install deps (idempotent; pip skips if already satisfied)
echo ">> Installing dependencies ..."
.venv/bin/pip install --quiet -r requirements.txt

# 3. Launch app.py with the chosen port
echo ">> Starting SceneSmith-VTT on port ${PORT}"
echo "   Local: http://127.0.0.1:${PORT}"
echo "   DM password: DMCODE   |   Player password: PLAY"
echo "   Ctrl+C to stop."
echo ""
VTT_PORT="$PORT" exec .venv/bin/python app.py