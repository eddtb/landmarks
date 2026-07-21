#!/usr/bin/env bash
# Rotate the CLAUDE_CODE_OAUTH_TOKEN repo secret that powers the
# claude-review GitHub Action.
#
# Why this exists: the review robot authenticates with a long-lived
# OAuth token minted by `claude setup-token`. When it expires, every
# claude-review check fails in ~30 seconds and the merge queue jams.
# The rotation handshake is mostly automatable — the ONE step that
# must stay human is clicking Approve in the browser (it's identity
# consent; nothing can or should click it for you).
#
# Usage:
#   scripts/rotate-review-token.sh
#
# What happens:
#   1. `claude setup-token` starts and opens your browser itself.
#   2. YOU click Approve (sign in first if asked). That's your whole job.
#      If the terminal shows "Paste code here" and the browser gave you
#      a code instead of finishing on its own, paste it there.
#   3. The script captures the printed sk-ant-oat… token (never echoed),
#      PROVES it works with a live authenticated call, stores it as the
#      repo secret, verifies the secret's timestamp moved, and re-runs
#      the most recent failed claude-review so the queue unjams.
#
# The token is written only to a chmod-600 temp file that is deleted
# on exit. If anything fails, nothing is stored and the old secret is
# left untouched.

set -euo pipefail

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || echo "$HOME/.local/bin/claude")}"
SECRET_NAME="CLAUDE_CODE_OAUTH_TOKEN"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
LOG="$WORK/setup.log"
TOKEN_FILE="$WORK/token"
touch "$TOKEN_FILE" && chmod 600 "$TOKEN_FILE" "$WORK"

echo "→ Starting the handshake. Your browser will open — click Approve."
echo "  (If it shows a code instead, paste it into THIS terminal.)"

# A very wide pty keeps the token on one line — terminal wrapping is
# what makes scraping it fragile otherwise.
expect <<EOF
  set stty_init "columns 500"
  log_file -noappend $LOG
  log_user 0
  spawn $CLAUDE_BIN setup-token
  set timeout 300
  expect {
    -re {sk-ant-oat01-[A-Za-z0-9_-]+} {}
    timeout { puts "TIMED OUT waiting for approval (5 min)"; exit 1 }
    eof     { puts "setup-token exited before printing a token"; exit 1 }
  }
  # Let it finish printing and exit cleanly
  expect { eof {} timeout {} }
EOF

grep -oE 'sk-ant-oat01-[A-Za-z0-9_-]+' "$LOG" | head -1 | tr -d '\n' > "$TOKEN_FILE"
rm -f "$LOG"
TOKEN_LEN="$(wc -c < "$TOKEN_FILE" | tr -d ' ')"
if [ "$TOKEN_LEN" -lt 60 ]; then
  echo "✗ Could not extract a plausible token (got $TOKEN_LEN chars). Nothing stored." >&2
  exit 1
fi
echo "→ Token captured ($TOKEN_LEN chars). Proving it authenticates…"

if ! CLAUDE_CODE_OAUTH_TOKEN="$(cat "$TOKEN_FILE")" "$CLAUDE_BIN" -p "Reply with exactly: TOKEN-ALIVE" 2>/dev/null | grep -q "TOKEN-ALIVE"; then
  echo "✗ The new token failed a live call. Nothing stored — run again." >&2
  exit 1
fi
echo "✓ Token authenticates."

gh secret set "$SECRET_NAME" --repo "$REPO" < "$TOKEN_FILE"
STAMP="$(gh secret list --repo "$REPO" | awk -v s="$SECRET_NAME" '$1 == s {print $2}')"
echo "✓ Secret stored: $SECRET_NAME updated $STAMP"

# Unjam the queue: re-fire the most recent failed review run, if any.
FAILED_RUN="$(gh run list --repo "$REPO" --workflow=claude-code-review.yml \
  --status=failure --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
if [ -n "$FAILED_RUN" ] && [ "$FAILED_RUN" != "null" ]; then
  gh run rerun "$FAILED_RUN" --failed --repo "$REPO"
  echo "✓ Re-ran failed claude-review run $FAILED_RUN — watch it with: gh run watch $FAILED_RUN"
else
  echo "→ No failed claude-review runs to re-fire."
fi

echo "Done. The review robot has a fresh 1-year key."
