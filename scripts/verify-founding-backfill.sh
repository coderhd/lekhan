#!/usr/bin/env bash
# T14(a) verification harness — founding-roster backfill
# (supabase/migrations/20261008000000_founding_roster_backfill.sql).
#
# Proves, against a throwaway Postgres with minimal stub tables:
#   1. the pinned predicate matches founders only: waitlist.position <= 500
#      joined to an account through referral_attribution.email_hash =
#      md5(lower(waitlist.email));
#   2. it flips is_founding false -> true only (never back), leaves >500 and
#      unattributed accounts false, and never touches rows that were already true;
#   3. a second run is a no-op — 0 rows updated, no timestamp drift (idempotent);
#   4. it no-ops with a NOTICE (not an error) when public.waitlist is absent
#      (PDEC-6: the waitlist DDL is out-of-band).
#
# This harness NEVER touches a real database: it creates its own disposable
# postgres:16-alpine container and seeds stub billing/waitlist tables inside it.
# Run it from the repo root:  ./scripts/verify-founding-backfill.sh
#
# Requires docker. The container is removed on exit.

set -euo pipefail

MIGRATION="${1:-supabase/migrations/20261008000000_founding_roster_backfill.sql}"
CONTAINER="lekhan-t14-backfill-$$"
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

echo "== starting disposable postgres (docker) =="
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=harness postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
	if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
	sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 || fail "postgres did not start"
pg() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== seeding stub schema + fixtures =="
cat > "$TMPDIR_HARNESS/seed.sql" <<'SQL'
CREATE TABLE public.workspaces (id uuid PRIMARY KEY, owner_id uuid NOT NULL);
CREATE TABLE public.workspace_plans (
	workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
	is_founding boolean NOT NULL DEFAULT false,
	updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE TABLE public.waitlist (id bigint PRIMARY KEY, email text NOT NULL, "position" integer NOT NULL);
CREATE TABLE public.referral_attribution (user_id uuid PRIMARY KEY, email_hash text);

INSERT INTO public.workspaces (id, owner_id) VALUES
	('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'), -- A: founder spot 5, attributed
	('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222'), -- B: founder spot 12, attributed, NO plan row
	('00000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333333'), -- C: spot 501 (outside roster), attributed
	('00000000-0000-0000-0000-0000000000d1', '44444444-4444-4444-4444-444444444444'), -- D: founder spot 250, NO attribution (?ref-less)
	('00000000-0000-0000-0000-0000000000e1', '77777777-7777-7777-7777-777777777777'), -- E: spot 500 (roster boundary), attributed
	('00000000-0000-0000-0000-0000000000f1', '66666666-6666-6666-6666-666666666666'), -- F: spot 77, waitlist email mixed case
	('00000000-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888'); -- G: already founding

INSERT INTO public.workspace_plans (workspace_id, is_founding) VALUES
	('00000000-0000-0000-0000-0000000000a1', false),
	('00000000-0000-0000-0000-0000000000c1', false),
	('00000000-0000-0000-0000-0000000000d1', false),
	('00000000-0000-0000-0000-0000000000e1', false),
	('00000000-0000-0000-0000-0000000000f1', false),
	('00000000-0000-0000-0000-000000000001', true);

INSERT INTO public.waitlist (id, email, "position") VALUES
	(1, 'a@example.com', 5),
	(2, 'b@example.com', 12),
	(3, 'c@example.com', 501),
	(4, 'd@example.com', 250),
	(5, 'F@Example.COM', 77),
	(6, 'e@example.com', 500),
	(7, 'g@example.com', 9);

INSERT INTO public.referral_attribution (user_id, email_hash) VALUES
	('11111111-1111-1111-1111-111111111111', md5(lower('a@example.com'))),
	('22222222-2222-2222-2222-222222222222', md5(lower('b@example.com'))),
	('33333333-3333-3333-3333-333333333333', md5(lower('c@example.com'))),
	('77777777-7777-7777-7777-777777777777', md5(lower('e@example.com'))),
	('66666666-6666-6666-6666-666666666666', md5(lower('f@example.com'))),
	('88888888-8888-8888-8888-888888888888', md5(lower('g@example.com')));
SQL
pg -q < "$TMPDIR_HARNESS/seed.sql"

snapshot() { pg -tA -F'|' -c 'SELECT workspace_id, is_founding, updated_at FROM public.workspace_plans ORDER BY workspace_id;'; }

echo "== run 1 =="
OUT1="$(pg -q < "$MIGRATION" 2>&1)"
echo "$OUT1"
echo "$OUT1" | grep -q 'marked 3 workspace_plans row(s) founding' || fail "run 1 should mark exactly 3 rows (A, E, F)"

snapshot > "$TMPDIR_HARNESS/after1.txt"

# Expected: A, E, F flipped true; C (>500) and D (no attribution) stay false;
# G stays true; B has no plan row at all.
EXPECTED=$'00000000-0000-0000-0000-000000000001|t\n00000000-0000-0000-0000-0000000000a1|t\n00000000-0000-0000-0000-0000000000c1|f\n00000000-0000-0000-0000-0000000000d1|f\n00000000-0000-0000-0000-0000000000e1|t\n00000000-0000-0000-0000-0000000000f1|t'
ACTUAL="$(pg -tA -F'|' -c 'SELECT workspace_id, is_founding FROM public.workspace_plans ORDER BY workspace_id;')"
[ "$ACTUAL" = "$EXPECTED" ] || fail "unexpected founding state after run 1:"$'\n'"$ACTUAL"

echo "== run 2 (idempotency) =="
OUT2="$(pg -q < "$MIGRATION" 2>&1)"
echo "$OUT2"
echo "$OUT2" | grep -q 'marked 0 workspace_plans row(s) founding' || fail "run 2 must be a no-op"
snapshot > "$TMPDIR_HARNESS/after2.txt"
diff -q "$TMPDIR_HARNESS/after1.txt" "$TMPDIR_HARNESS/after2.txt" >/dev/null \
	|| fail "run 2 mutated rows (is_founding or updated_at drifted)"

echo "== run 3 (waitlist DDL absent — PDEC-6) =="
pg -q -c 'DROP TABLE public.waitlist;'
OUT3="$(pg -q < "$MIGRATION" 2>&1)"
echo "$OUT3"
echo "$OUT3" | grep -q 'public.waitlist is absent on this environment; skipping' \
	|| fail "run 3 must skip with a notice when waitlist is absent"
[ "$(snapshot)" = "$(cat "$TMPDIR_HARNESS/after2.txt")" ] || fail "run 3 mutated rows"

echo "PASS: predicate pinned, false->true only, idempotent on re-run, safe when waitlist is absent."
