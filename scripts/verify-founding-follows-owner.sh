#!/usr/bin/env bash
# T14(c) verification harness — founding follows the owner
# (supabase/migrations/20261008000001_founding_follows_owner.sql, ADR 0005 Q2 / SIL-141).
#
# Proves, against a throwaway Postgres with minimal stub tables:
#   1. catch-up: an unlocked plan row created before the migration flips true when its
#      owner already owns another founding workspace;
#   2. trigger: a workspace_plans row INSERTed after the migration inherits founding
#      when the owner has a founding sibling workspace;
#   3. non-founding owners never inherit (no sibling founding workspace → stays false);
#   4. the lock is honoured everywhere: rows with status <> 'none' or a gateway
#      subscription id are never flipped (catch-up and trigger alike);
#   5. a row inserted already-founding (webhook upsert path) passes through untouched;
#   6. a second run is a no-op — 0 rows caught, no timestamp drift (idempotent).
#
# This harness NEVER touches a real database: it creates its own disposable
# postgres container with no host port, no volume and no network mount.
# Run it from the repo root:  ./scripts/verify-founding-follows-owner.sh
#
# Requires docker. The container is removed on exit.

set -euo pipefail

MIGRATION="${1:-supabase/migrations/20261008000001_founding_follows_owner.sql}"
PG_IMAGE="${PG_IMAGE:-postgres:16.15-alpine}"
CONTAINER="lekhan-t14-follows-owner-$$"
TMPDIR_HARNESS="$(mktemp -d)"
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TMPDIR_HARNESS"' EXIT

if [ ! -f "$MIGRATION" ]; then
	echo "migration not found: $MIGRATION" >&2
	exit 2
fi

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

echo "== starting disposable postgres ($PG_IMAGE, no host port/volume) =="
docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=harness "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do
	if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
	sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 || fail "postgres did not start"
pg() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== seeding stub schema + fixtures (rows created before the migration) =="
cat > "$TMPDIR_HARNESS/seed.sql" <<'SQL'
CREATE TABLE public.workspaces (id uuid PRIMARY KEY, owner_id uuid NOT NULL);
CREATE TABLE public.workspace_plans (
	workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
	gateway text NOT NULL DEFAULT 'none',
	gateway_subscription_id text,
	status text NOT NULL DEFAULT 'none',
	is_founding boolean NOT NULL DEFAULT false,
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- F1: founding owner, W1 founding; W2 inserted after the migration (trigger test).
-- N1: non-founding owner; W4 inserted after the migration (must stay false).
-- F2: founding owner; W6 inserted after the migration ALREADY ACTIVE (lock test).
-- F3: founding owner; W8 pre-existing unlocked false row (catch-up test).
-- F4: founding owner; W10 active + W11 canceled pre-existing false rows (lock test).
-- F5: workspace inserted after the migration already founding (webhook path, untouched).
INSERT INTO public.workspaces (id, owner_id) VALUES
	('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111101'), -- F1/W1
	('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111101'), -- F1/W2 (later)
	('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222202'), -- N1/W3
	('00000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222202'), -- N1/W4 (later)
	('00000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333303'), -- F2/W5
	('00000000-0000-0000-0000-0000000000c2', '33333333-3333-3333-3333-333333333303'), -- F2/W6 (later, active)
	('00000000-0000-0000-0000-0000000000d1', '44444444-4444-4444-4444-444444444404'), -- F3/W7
	('00000000-0000-0000-0000-0000000000d2', '44444444-4444-4444-4444-444444444404'), -- F3/W8 (catch-up)
	('00000000-0000-0000-0000-0000000000e1', '55555555-5555-5555-5555-555555555505'), -- F4/W9
	('00000000-0000-0000-0000-0000000000e2', '55555555-5555-5555-5555-555555555505'), -- F4/W10 (active)
	('00000000-0000-0000-0000-0000000000e3', '55555555-5555-5555-5555-555555555505'), -- F4/W11 (canceled)
	('00000000-0000-0000-0000-0000000000f1', '66666666-6666-6666-6666-666666666606'); -- F5/W12 (later, already founding)

INSERT INTO public.workspace_plans (workspace_id, gateway, gateway_subscription_id, status, is_founding) VALUES
	('00000000-0000-0000-0000-0000000000a1', 'none', NULL, 'none', true),   -- W1 founding
	('00000000-0000-0000-0000-0000000000b1', 'none', NULL, 'none', false),  -- W3 non-founding owner
	('00000000-0000-0000-0000-0000000000c1', 'none', NULL, 'none', true),   -- W5 founding
	('00000000-0000-0000-0000-0000000000d1', 'none', NULL, 'none', true),   -- W7 founding
	('00000000-0000-0000-0000-0000000000d2', 'none', NULL, 'none', false),  -- W8 catch-up target
	('00000000-0000-0000-0000-0000000000e1', 'none', NULL, 'none', true),   -- W9 founding
	('00000000-0000-0000-0000-0000000000e2', 'stripe', 'sub_live_ga', 'active', false),   -- W10 locked
	('00000000-0000-0000-0000-0000000000e3', 'razorpay', 'sub_canceled_ga', 'canceled', false); -- W11 locked
SQL
pg -q < "$TMPDIR_HARNESS/seed.sql"

snapshot() { pg -tA -F'|' -c 'SELECT workspace_id, is_founding, status, updated_at FROM public.workspace_plans ORDER BY workspace_id;'; }

echo "== apply migration (catch-up) =="
OUT1="$(pg -q < "$MIGRATION" 2>&1)"
echo "$OUT1"
echo "$OUT1" | grep -q 'inherited founding onto 1 workspace(s)' \
	|| fail "catch-up should flip exactly 1 row (W8; W10/W11 are locked)"

EXPECTED=$'00000000-0000-0000-0000-0000000000a1|t\n00000000-0000-0000-0000-0000000000b1|f\n00000000-0000-0000-0000-0000000000c1|t\n00000000-0000-0000-0000-0000000000d1|t\n00000000-0000-0000-0000-0000000000d2|t\n00000000-0000-0000-0000-0000000000e1|t\n00000000-0000-0000-0000-0000000000e2|f\n00000000-0000-0000-0000-0000000000e3|f'
ACTUAL="$(pg -tA -F'|' -c 'SELECT workspace_id, is_founding FROM public.workspace_plans ORDER BY workspace_id;')"
[ "$ACTUAL" = "$EXPECTED" ] || fail "unexpected founding state after catch-up:"$'\n'"$ACTUAL"

echo "== trigger: new workspaces inherit (or refuse to) =="
# F1 opens a second workspace — its plan row must inherit founding (rule: follows the founder).
pg -q -c "INSERT INTO public.workspace_plans (workspace_id, gateway, status, is_founding) VALUES ('00000000-0000-0000-0000-0000000000a2', 'none', 'none', false);"
# N1 (non-founding) opens one — must stay false; F2's new workspace is born ACTIVE — locked, stays false;
# F5's new workspace is born already-founding (webhook upsert path) — must pass through untouched.
pg -q -c "INSERT INTO public.workspace_plans (workspace_id, gateway, status, is_founding) VALUES ('00000000-0000-0000-0000-0000000000b2', 'none', 'none', false);"
pg -q -c "INSERT INTO public.workspace_plans (workspace_id, gateway, gateway_subscription_id, status, is_founding) VALUES ('00000000-0000-0000-0000-0000000000c2', 'stripe', 'sub_new_ga', 'active', false);"
pg -q -c "INSERT INTO public.workspace_plans (workspace_id, gateway, status, is_founding) VALUES ('00000000-0000-0000-0000-0000000000f1', 'none', 'none', true);"

EXPECTED=$'00000000-0000-0000-0000-0000000000a1|t\n00000000-0000-0000-0000-0000000000a2|t\n00000000-0000-0000-0000-0000000000b1|f\n00000000-0000-0000-0000-0000000000b2|f\n00000000-0000-0000-0000-0000000000c1|t\n00000000-0000-0000-0000-0000000000c2|f\n00000000-0000-0000-0000-0000000000d1|t\n00000000-0000-0000-0000-0000000000d2|t\n00000000-0000-0000-0000-0000000000e1|t\n00000000-0000-0000-0000-0000000000e2|f\n00000000-0000-0000-0000-0000000000e3|f\n00000000-0000-0000-0000-0000000000f1|t'
ACTUAL="$(pg -tA -F'|' -c 'SELECT workspace_id, is_founding FROM public.workspace_plans ORDER BY workspace_id;')"
[ "$ACTUAL" = "$EXPECTED" ] || fail "unexpected founding state after trigger inserts:"$'\n'"$ACTUAL"

snapshot > "$TMPDIR_HARNESS/after1.txt"

echo "== re-run (idempotency) =="
OUT2="$(pg -q < "$MIGRATION" 2>&1)"
echo "$OUT2"
echo "$OUT2" | grep -q 'inherited founding onto 0 workspace(s)' || fail "re-run must be a no-op"
snapshot > "$TMPDIR_HARNESS/after2.txt"
diff -q "$TMPDIR_HARNESS/after1.txt" "$TMPDIR_HARNESS/after2.txt" >/dev/null \
	|| fail "re-run mutated rows (is_founding or updated_at drifted)"

echo "PASS: founding follows the owner — catch-up flips pre-existing unlocked rows of founding owners; new workspace plan rows inherit via trigger; non-founding owners never inherit; locked rows (active/canceled/subscribed) are never touched; already-founding inserts pass through; re-run updates 0 rows with no drift."
