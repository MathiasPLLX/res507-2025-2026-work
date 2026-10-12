#!/usr/bin/env bash
# Database-backed smoke test: checks that quotes are really read from and
# written to PostgreSQL. Asserts on quote text, not just on HTTP 200.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SEEDED_QUOTE="Talk is cheap. Show me the code."   # from db/init.sql
NEW_QUOTE="ci-quote-${GITHUB_RUN_ID:-local}-$(date +%s)"

fail() { echo "FAIL: $*" >&2; exit 1; }

get_home() { curl --silent --show-error --fail --max-time 5 "$BASE_URL/"; }

echo "1) GET / must render a seeded quote"
page=$(get_home) || fail "GET / did not return HTTP 200"
grep -qF "$SEEDED_QUOTE" <<<"$page" || fail "seeded quote not found on /: '$SEEDED_QUOTE'"
echo "   ok: found '$SEEDED_QUOTE'"

echo "2) the new quote must not exist yet"
if grep -qF "$NEW_QUOTE" <<<"$page"; then
  fail "quote '$NEW_QUOTE' was already on / before being submitted"
fi
echo "   ok: '$NEW_QUOTE' is absent"

echo "3) POST /quotes must accept the new quote"
status=$(curl --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' \
  --data-urlencode "author=ci" --data-urlencode "text=$NEW_QUOTE" "$BASE_URL/quotes")
[ "$status" = "302" ] || fail "POST /quotes returned HTTP $status (expected 302)"
echo "   ok: HTTP $status"

echo "4) a subsequent GET / must return the new quote"
page=$(get_home) || fail "GET / did not return HTTP 200 after the POST"
grep -qF "$NEW_QUOTE" <<<"$page" || fail "submitted quote not found on /: '$NEW_QUOTE'"
grep -qF "$SEEDED_QUOTE" <<<"$page" || fail "seeded quote disappeared after the POST"
echo "   ok: found '$NEW_QUOTE'"

echo "Database-backed smoke test passed."
