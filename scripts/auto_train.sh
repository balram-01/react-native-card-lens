#!/usr/bin/env bash
set -e

# Change to the script's directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run python automation orchestrator
python3 "$DIR/auto_train.py" "$@"
