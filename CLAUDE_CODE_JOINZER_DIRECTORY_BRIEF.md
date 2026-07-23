# Claude Code Brief — Joinzer Court Directory

_Last updated: July 20, 2026 · Replaces prior version (Arizona-scoped). Supersedes it entirely._

> **For Claude Code:** This brief is the source of truth for the directory workstream. Follow CC session discipline: mandatory investigation phase, then a **hard go-gate** — no code or DDL until Marty explicitly approves the plan. Small slices, scope fences respected, grep-before-delete. The **two-form-factor workstream is off-limits** during directory sessions.

---

## 1. What we're building

A public, SEO-oriented **nationwide directory of pickleball courts** living inside Joinzer (not a separate app). Server-rendered public pages per facility (and later per city/metro), designed as an organic-acquisition channel (see `docs/strategy/go-to-market.md` — per-court SEO pages).

**Phasing (important):**
- **Ingest: nationwide, once.** The raw OSM pull is cheap; do the whole US in one pipeline.
- **Enrichment + public UI: Phoenix first.** Prove enrichment quality and the page template on one metro before turning the crank elsewhere. Do NOT enrich nationwide in v1.

## 2. Decisions locked (do not re-litigate in-session)

1. **Directory lives in the Joinzer app/repo.** Same Next.js project, same Supabase.
2. **Separate `facility_listings` table** — real columns for queryable/SEO fields + a JSONB blob for enrichment. **Greenfield: this table does not exist yet** (verified against production 2026-07-20).
3. **`locations` stays untouched as the operational table.** Nullable FK from `facility_listings.location_id` → `locations.id`; a facility is "promoted" only when a real event uses it. Never bulk-insert scraped data into `locations`.
4. **OSM is the only bulk-ingest source.** Google Places is **per-record enrichment only**. Aggregators (Pickleheads, Places2Play, etc.) are **off-limits** — do not scrape them.
5. **Gemini is the v1 LLM enrichment generator**, behind a one-file-swap wrapper so the provider can change later.
6. **No stored Google Maps URL.** Derive at render time: `https://www.google.com/maps/search/?api=1&query={lat},{lng}&query_place_id={place_id}` when `google_place_id` is present; lat/lng-only fallback otherwise.

## 3. Current database reality (verified 2026-07-20, production)

- `facility_listings`: **does not exist.**
- `locations`: 64 rows, all Las Vegas metro. 63/64 have coords, 54/64 have addresses. Columns: `id, name, metro_area (default 'Las Vegas'), subarea, court_count, access_type, notes, is_active, address, city, category, source_url, sort_order (default 999), lat, lng, "Phone", state, zip_code, country (default 'US'), created_by, status (default 'approved'), short_code`.
- ⚠️ `"Phone"` is a capitalized quoted identifier. **Session 1 includes renaming it to `phone`** — grep the codebase for every reference (`"Phone"`, `.Phone`, select strings) before the migration; migration + code change ship together, migration applied to Supabase first per ADR-10.

## 4. Target schema — `facility_listings` (Session 1 designs the final DDL; this is the spec)

**Identity & ingest provenance**
- `id uuid pk default gen_random_uuid()`
- `osm_id text unique` — the idempotent upsert key for re-runs (store OSM type+id, e.g. `way/123456`)
- `source text not null default 'osm'`
- `last_synced_at timestamptz`

**Queryable / SEO columns (real columns, indexed as needed)**
- `name text not null`
- `slug text unique not null` — URL identity for `/courts/[slug]`
- `lat double precision`, `lng double precision`
- `address text`, `city text`, `state text`, `zip text`, `country text default 'US'`
- `metro_area text` — derived/assigned; nullable (most of the country won't map to a Joinzer metro)
- `court_count integer` — nullable (OSM often has it; don't fake a default)
- `access_type text` — normalize to a small enum-ish set (public / private / membership / school / hoa / unknown)
- `indoor boolean`, `lighting boolean`, `surface text` — nullable, from OSM tags where present
- `status text not null default 'draft'` — `draft` → `published`; only published rows render publicly

**Google (ToS-compliant)**
- `google_place_id text` — the **only** Places datum stored permanently. Ratings/hours/phone from Places are refresh-on-render or ≤30-day cache, never permanent columns.

**Enrichment**
- `enrichment jsonb` — Gemini output: description, amenities, "what to know", nearby context, FAQs
- `enriched_at timestamptz`, `enrichment_version text`

**Operational link**
- `location_id uuid null references locations(id)` — set only on promotion

**RLS (per ADR-03):** deny-all; all reads via service role in server components/routes for v1 (simplest, keeps the boundary in the route). Revisit a `status='published'` public-read policy only if a concrete need appears.

## 5. Data pipeline — three layers

**Layer 1 — OSM bulk ingest (nationwide).**
- Overpass API queries for `leisure=pitch` + `sport=pickleball` (plus `sport~"pickleball"` multi-sport values, and `leisure=sports_centre` / `club=sport` variants tagged pickleball).
- Chunk by state (or bbox grid for big states) to respect Overpass rate/size limits; polite delays; retry with backoff.
- Normalize: nodes → lat/lng directly; ways/relations → centroid. Map OSM tags → columns (`capacity`/`courts` → court_count; `access` → access_type; `lit` → lighting; `surface`; `indoor`).
- Upsert on `osm_id`. Re-runnable at any time. Runs as a **local script** (`scripts/` in repo, Node, ES modules) — not a cron, not an edge function.
- Fill city/state gaps by reverse-geocoding from OSM/Nominatim data where address tags are absent (batch, polite rate limits) — or defer gap-fill to Layer 3 for enriched metros only. Prefer defer.
  - **Nominatim reverse-geocode standard (PINNED — slice 3d-4b, 2026-07-22): use `zoom=14`, not `zoom=10`.** At `zoom=10`, metro CDPs (Sun City/West, Anthem, Sun Lakes, Gold Canyon, Rio Verde) resolve to their *county* with no locality key — no fallback chain can recover them. `zoom=14` surfaces the CDP name (`town`/`village`) while returning the identical `city` for incorporated places (verified zero-regression). City fallback chain: `city → town → village → municipality`. Descriptive User-Agent (Joinzer + contact email), 1 req/sec, no parallelism, `addressdetails=1`. Nominatim output is ODbL — safe to store permanently (this is *not* the Google 3d-0 DB path). The next metro inherits this value + rationale, not the original `zoom=10` guess.
- Slug generation: `{name}-{city}-{state}` kebab-case with collision suffix.

**Layer 2 — deterministic derivation (code only, free).** Maps link derivation (see §2.6), slugging, state/metro normalization. No external services.

**Layer 3 — enrichment (Phoenix only in v1).**
- **Google Places:** text/nearby match per facility → store `place_id`; use Details for transient display data under caching rules.
- **Gemini wrapper:** generate the JSONB enrichment per facility. Budget-capped, batchable, resumable; store `enrichment_version` so regeneration is targeted.
- Publish gate: a facility flips `draft → published` only when it has coords + slug + minimally viable enrichment (or is manually approved).

## 6. Licensing & compliance (hard constraints)

- **ODbL (OSM):** attribute "© OpenStreetMap contributors" on directory pages; the ingested dataset carries share-alike obligations. Include attribution in the page footer/component from day one.
- **Google Places ToS:** `place_id` may be stored permanently; most other Places data may not be cached beyond 30 days. Never bulk-scrape Places.
- **Aggregators:** no scraping Pickleheads/Places2Play/etc. under any framing.

## 7. CC sessions (each: investigate → go-gate → build)

**Session 1 — Data model & migration.**
Scope: `facility_listings` DDL per §4, RLS, indexes (slug, osm_id, state+city, geo if needed), the `"Phone"` → `phone` rename (with full-codebase reference sweep), and — if trivial — a backfill mapping existing `locations` rows to listing rows via the FK. Migration applied to Supabase before dependent code deploys (ADR-10).
Out of scope: any ingest code, any UI.

**Session 2 — Ingest pipeline.**
Scope: Overpass query strategy + `scripts/ingest-osm-courts.mjs` (chunked, resumable, idempotent upsert, dry-run mode, per-state progress log), tag normalization, slugging. Run nationwide. **Also decide the timezone strategy for `facility_listings`** (see §9) — the directory is national, so this can't stay implicitly Pacific.
Out of scope: enrichment, UI, any `locations` writes.

**Session 3 — Enrichment + public SSR directory UI (Phoenix).**
Scope: Places match (place_id), Gemini wrapper + batch enrichment for Phoenix-metro rows, `/courts/[slug]` SSR page + minimal city index, OSM attribution, sitemap entries, publish gate.
Out of scope: nationwide enrichment, map views, filters beyond basics.

## 8. Constraints reminders

- Solo builder; small shippable slices; no new fixed-cost dependencies.
- Vercel Hobby: no sub-daily crons — ingest and enrichment are on-demand local scripts, not scheduled infra.
- Stack rules per ADR-01/02: no new libraries beyond what the task truly requires; Tailwind only; lucide-react; ES modules; env vars for all keys (Gemini, Google Places) — never in code.

## 9. Deferred design notes — multi-sport & timezone (added 2026-07-20, Session 1 follow-up)

Captured for later; **not** in scope for Sessions 1–3 unless called out. Session 1 verified there is currently **no sport/activity dimension anywhere** (sport is implicitly pickleball), and `locations.category` is messy ownership/access free-text — *not* a sport field.

**Timezone — the near-term one (decide in Session 2).** `facility_listings` is nationwide (~6 US timezones), so the single-Pacific assumption breaks the moment scheduling/reminders/"starts today" logic touches a non-Pacific facility. Two options: **store a `timezone` column** on `facility_listings`, or **derive from lat/lng at render** (tz lookup). Storing is simpler for scheduling logic; deriving avoids a column. The operational `locations` table will need the same the day a non-Pacific organizer onboards (separate, later).

**Multi-sport / activities — when a real 2nd sport exists, not before.** The rating engine is already "activity-aware"; the venue model follows the same discipline (defer the DB expansion until a concrete second sport lands). When it does:
- A venue is inherently multi-sport, so **sport is not a scalar** — do NOT add `sport text` or per-sport scalar columns (`court_count` is pickleball-implied and would need per-sport values → columns explode).
- Start with **`activities text[]`** for tagging/filtering/SEO; graduate to a **child table** (`facility_activities`: facility × activity → court_count, surface, indoor) only when per-sport attributes are actually needed.
- Put it on **`facility_listings` first** (the discovery surface — per-sport pages/filters), not `locations` (which infers its sport from its events).
- Use the **"activity"** vocabulary, consistent with the rating engine.

**Adjacent cleanup (unrelated).** `locations.category` overlaps `access_type` (both encode ownership/access) — a fold/retire candidate if `locations` is ever normalized. Not urgent.