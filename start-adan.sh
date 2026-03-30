#!/bin/bash
# ADAN Watchdog & Auto-Restart Script
# Runs ADAN and restarts it if it crashes or hangs.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEARTBEAT_FILE="$DIR/.heartbeat"

echo "Starting ADAN Watchdog..."

# Background watchdog process to check heartbeat
(
  while true; do
    sleep 60
    if [ -f "$HEARTBEAT_FILE" ]; then
      # Check if heartbeat is older than 5 minutes (300 seconds)
      if [ "$(uname)" == "Darwin" ]; then
        LAST_MOD=$(stat -f "%m" "$HEARTBEAT_FILE")
        NOW=$(date +%s)
      else
        LAST_MOD=$(stat -c "%Y" "$HEARTBEAT_FILE")
        NOW=$(date +%s)
      fi
      
      AGE=$((NOW - LAST_MOD))
      if [ $AGE -gt 300 ]; then
        echo "[$(date)] ⚠️  Watchdog: Heartbeat stale ($AGE seconds). Killing ADAN..."
        pkill -f "node adan-pred.js"
        # The loop below will automatically restart it
      fi
    fi
  done
) &
WATCHDOG_PID=$!

trap "echo 'Stopping Watchdog...'; kill $WATCHDOG_PID; exit" INT TERM

# Main application loop
while true; do
  echo "[$(date)] Starting node adan-pred.js..."
  node adan-pred.js 2>&1 | tee -a adan.log
  
  EXIT_CODE=$?
  echo "[$(date)] ADAN exited with code $EXIT_CODE. Restarting in 10s..."
  sleep 10
done
