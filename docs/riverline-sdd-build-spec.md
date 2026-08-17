# RiverLine SDD — Full Build Specification
**A modular Substantial Damage Determination field system for Hamilton County floodplain administrators**

---

## 1. System Overview and Architecture Philosophy

The system is a mobile-first web application (PWA) with a modular core-plus-add-ons architecture. The core is the smallest thing that is legally useful: capture a structure's damage in the field, compute the 50% rule against assessor data, and produce a determination record an official can adopt. Everything else — letters, dashboards, SDE export, depth corroboration, future modules — is an add-on that reads from and writes to the same core data model but can be built, shipped, broken, or removed without touching the core.

One architectural decision drives everything else: **the jurisdiction's official is always the decision-maker of record, and the system is a calculation and documentation aid.** This is not just a legal disclaimer — it shapes the data model (every determination has a `reviewed_by` official and an explicit adoption step), the UI (the tool proposes, the official confirms), and your liability posture.

A second decision follows from your hardware reality: **you are on a Windows laptop and your users are on iPhones, so there is no native app in this project, period.** You cannot build or sign iOS apps without a Mac and an Apple Developer account, and App Store review takes longer than your entire deployment window. A PWA served over HTTPS gives you: install-to-homescreen on iOS, camera access via standard web APIs, GPS via the Geolocation API, and offline behavior via a service worker. Every capability you need is available in mobile Safari. Do not let an agent talk you into React Native or Expo "for better camera access" — that path is a multi-day detour that ends at an App Store queue.

### 1.1 Module Map

```
CORE (must exist for anything to work)
├── M0  Auth & jurisdiction scoping
├── M1  Structure registry (parcel + assessor + SFHA join)
├── M2  Field assessment capture (mobile, offline-capable)
├── M3  50%-rule calculation engine (versioned cost tables)
└── M4  Determination record + official adoption workflow

ADD-ONS (each independently shippable)
├── A1  Determination letter generator (SD / not-SD variants)
├── A2  Administrator dashboard (caseload, status, map)
├── A3  SDE 3.0 compatible export
├── A4  Contractor-estimate intake (with OCR assist)
├── A5  Hydrologic corroboration (USGS depth grid at parcel)
├── A6  Homeowner-facing status page (read-only, per-address)
├── A7  ICC / HMGP eligibility flagging
└── A8  Multi-jurisdiction admin (county-level roll-up)

FUTURE MODULES (same data spine, different workload)
├── F1  PA force-account / debris documentation
└── F2  Preliminary damage assessment (PDA) aggregation
```

MVP = M0–M4 + A1 + A2 + A3. Do not start any A4–A8 work until an official has used M0–A3 on a real structure.

---

## 2. Tech Stack

Chosen for: buildable on Windows, zero-install for iPhone users, boring enough that agents can't creatively break it, self-hostable if a jurisdiction demands it.

1. **Frontend:** Next.js (App Router) as a PWA. Plain React + a minimal component library (shadcn/ui). MapLibre GL only inside the dashboard add-on (A2) — the field capture flow must not depend on a map rendering.
2. **Backend:** Next.js API routes or a small FastAPI service — pick ONE and forbid agents from adding the other. Recommendation: keep it all in Next.js/TypeScript for the MVP so there is a single runtime, single deploy, and no CORS surface at all. Introduce Python only in the offline preprocessing scripts (see §4), never in the serving path.
3. **Database:** Postgres with PostGIS (Supabase hosted for speed; schema written so `pg_dump` → self-hosted Postgres is a one-hour migration if a jurisdiction requires local hosting). Row-Level Security scoped by jurisdiction from day one — retrofitting RLS after data exists is how you leak Noblesville's records to Fishers.
4. **Storage:** Supabase Storage / S3-compatible bucket for photos. Photos are content-hashed (SHA-256) at upload; hash stored on the assessment record.
5. **Offline:** Service worker + IndexedDB write queue for the capture flow (M2 only). Assessments made offline sync when connectivity returns; conflicts resolve last-write-wins per field with an audit entry, never silent overwrite of a whole record.
6. **Auth:** Email magic-link, allowlisted per jurisdiction domain, with an admin-issued invite flow. No self-signup. No passwords to breach, no SSO integration project.
7. **Geospatial preprocessing:** Python (GeoPandas, Rasterio, Shapely) run **once, offline, on your laptop** — outputs static tables loaded into Postgres. The serving path never does raster math.
8. **Hosting:** Vercel or a single VPS with Caddy for automatic HTTPS. HTTPS is non-negotiable: iOS will not grant camera or geolocation permissions to insecure origins.

---

## 3. Data Model (the schema contract — write this first, freeze it)

This is the single most important artifact in the project. Every agent works against this contract; no agent may alter it without your sign-off. Keep it in one file (`/schema/core.sql`) that is the source of truth.

```
jurisdictions(id, name, nfip_cid, ordinance_citation, letterhead_config, created_at)
users(id, email, jurisdiction_id, role[admin|assessor|official|viewer], created_at)
structures(id, jurisdiction_id, parcel_id, address, geom point,
           assessor_market_value, improvement_value, value_source, value_as_of_date,
           sfha_zone, firm_panel, occupancy_type, foundation_type, stories,
           created_at)
assessments(id, structure_id, assessor_user_id, started_at, completed_at,
            sync_status, device_captured_at, gps_lat, gps_lng, gps_accuracy_m,
            water_depth_interior_in, water_depth_source, notes)
assessment_elements(id, assessment_id, element_code, damage_pct,
                    cost_table_version, computed_cost)
photos(id, assessment_id, storage_key, sha256, captured_at, gps_lat, gps_lng, caption)
calculations(id, assessment_id, cost_table_version, total_repair_cost,
             market_value_used, value_source, ratio, threshold_result[SD|NOT_SD|BORDERLINE],
             computed_at, engine_version)
determinations(id, structure_id, calculation_id, status[draft|adopted|contested|superseded],
               adopted_by_user_id, adopted_at, letter_id, appeal_deadline_date, notes)
letters(id, determination_id, template_version, pdf_storage_key, issued_at, delivery_method)
audit_log(id, actor_user_id, entity_type, entity_id, action, before_json, after_json, at)
cost_tables(version, source_citation, effective_date, json_payload)
```

Non-obvious rules embedded here: `calculations` are immutable — a re-run creates a new row, never an update, because a determination that gets contested needs to point at exactly the numbers it was based on. `cost_table_version` is stamped on every element and calculation because FEMA unit costs get updated and you must be able to reproduce any historical result. `BORDERLINE` (e.g., ratio 45–55%) is a first-class result that routes to mandatory official review rather than auto-classification. The `audit_log` is append-only and covers every mutation of `determinations` — this record may end up in an administrative appeal, and an immutable trail is what makes your tool's output defensible rather than a liability.

---

## 4. Datasets

1. **Hamilton County parcels + assessor values** — Hamilton County GeoHub (open data). Fields needed: parcel ID, situs address, geometry, assessed improvement value, total market value, property class. **Preprocessing:** verify the actual field names against the live download before any agent writes ingest code (see §9, failure mode #1). Note assessed vs. market value distinction: FEMA P-758 permits assessed value adjusted to market or independent appraisal; record `value_source` explicitly and let the official override the value with an appraisal — this override path is not optional, it is how contested determinations get resolved.
2. **FEMA NFHL / effective FIRM SFHA layer** — public download or ArcGIS REST. Pre-join zone + panel to every parcel in the preprocessing step; store as static columns.
3. **FEMA SDE 3.0 unit-cost tables and element structure** — extracted from the SDE User Manual / Field Workbook into `cost_tables.json_payload`. The element breakdown (foundation, superstructure, roof, interior finish, electrical, plumbing, HVAC, built-in appliances) must mirror SDE's structure exactly, because A3's export has to import cleanly into SDE.

   > **CORRECTION (verified 2026-08-17, orchestrator-confirmed against FEMA P-784 pp.65–67 and p.77):** the 8-item element list written above is **wrong**. The real SDE 3.0 structure is **12 residential elements** and **7 non-residential elements**, and it does not map one-to-one onto the list above — the spec omits Exterior finish, Doors and windows, Cabinets and countertops, and Floor finish, and splits Roof differently. Build M3 and A3 against `docs/data-contracts/sde-cost-tables.md`, never against this paragraph. Also verified: **the manual contains no dollar unit costs at all** — base cost per square foot must come from an externally licensed cost-estimating guide the jurisdiction selects. That is a procurement blocker for M3, not a research task.
4. **USGS Noblesville FIM depth grids** (A5 only) — precompute max modeled depth per parcel footprint per stage; store as a static lookup. Label as modeled estimate; the crest exceeded the 24.0 ft model ceiling, so flag extrapolation.
5. **Jurisdiction ordinance citations and letterhead assets** — collected during onboarding, not scraped.

All geospatial joins happen in preprocessing on your laptop; production serves precomputed tables. This kills an entire category of runtime failure.

---

## 5. Methods: the 50%-Rule Engine (M3)

1. Assessor selects structure (search by address, tap on list, or GPS "nearest parcels" — no map required).
2. Enter structure attributes if missing (occupancy, foundation, stories) — pre-filled from parcel data where possible.
3. Walk element list; for each, enter damage percentage via preset increments (0/10/25/50/75/100) with free entry allowed. Preset increments matter: field consistency beats false precision, and SDE itself works in coarse percentages.
4. Engine computes: element base cost (from cost table × structure size/type) × damage % → summed total repair cost; ratio = total repair cost ÷ market value used.
5. Result classes: `NOT_SD` (<45%), `BORDERLINE` (45–55%), `SD` (≥55%) for routing purposes — the legal threshold remains 50% and is what the letter states; the borderline band exists purely to force human review where the calculation is within its own error bars.
6. Official review screen: shows every input, the value source, the cost table version, side-by-side photos; official may override any element or the market value (override reason required, audited); adoption is an explicit signed action.

The engine is ~200 lines of pure, deterministic TypeScript with zero I/O. It gets the project's only exhaustive unit-test suite: golden fixtures covering every occupancy/foundation combination, hand-verified against worked examples in the SDE manual. **You personally verify the golden fixtures. No agent self-certifies this module.**

---

## 6. Interface Specification

Design principle: an assessor wearing gloves, standing in mud, in glare, using one hand. Concretely:

1. **Capture flow (M2):** one decision per screen; tap targets ≥48px; damage percentages as large buttons, not sliders (sliders are unusable with wet hands); progress indicator ("Element 6 of 11"); photo capture inline per element plus a required exterior shot; every screen auto-saves to the local queue on advance — there is no Save button to forget, and killing the app loses nothing.
2. **Visual design:** high-contrast, system fonts, no thin grays. Status colors: green NOT_SD, amber BORDERLINE, red SD, gray draft. Offline state is a persistent visible banner ("Offline — 3 assessments queued"), never a silent failure.
3. **Official review (M4):** desktop-friendly but responsive; a queue sorted borderline-first; single-page review with adopt/override/return actions.
4. **Dashboard (A2):** counts by status, list + map toggle, CSV export always available (officials live in Excel; meet them there).
5. **Letters (A1):** print-first design. Officials will print these. Test on paper, on your printer, before shipping.
6. **Accessibility floor:** WCAG AA contrast, all functionality without color perception, screen-reader labels on the capture flow. Cheap now, impossible later.
7. **Onboarding budget: ten minutes.** If a new assessor cannot complete a practice assessment in ten minutes with no training call, the flow is too complex. Include a built-in demo structure ("123 Practice Ln") in every jurisdiction so training never touches real records.

---

## 7. Security and Trust Requirements

1. **Transport & auth:** HTTPS everywhere; magic-link auth with admin-issued invites; sessions expire at 12 hours (field devices get shared); role-based access with `viewer` as default-deny.
2. **Tenant isolation:** Postgres RLS on `jurisdiction_id` for every table, enforced at the database, tested with a cross-tenant access test in CI. This is the one security property you cannot ship without.
3. **PII inventory & minimization:** you hold addresses, owner-visible photos of home interiors, assessor values, and official identities. You do NOT collect: SSNs, phone numbers beyond official contacts, insurance policy numbers, bank anything. Refuse fields agents "helpfully" add.
4. **Photo EXIF:** strip EXIF on serve (public-facing A6), retain on the stored original (evidentiary value), and document this split.
5. **Audit trail:** append-only `audit_log`, no delete endpoint for determinations — only `superseded` status. Backups: automated daily `pg_dump` + storage bucket versioning; test one restore before pilot.
6. **Public-records reality (Indiana APRA):** records created inside your tool by a public official are plausibly public records of the jurisdiction. Two consequences: build a per-jurisdiction full export (they must be able to answer a records request from your system), and put data ownership in writing — the jurisdiction owns its data, you are a processor, deletion on request within 30 days.
7. **Secrets & supply chain:** secrets in environment config only, secret-scan the repo in CI (agents commit keys constantly), pin dependency versions, no new runtime dependency without your approval — agent-added dependency bloat is both an attack surface and a debugging tax.
8. **Legal posture, in-product:** every calculation screen and letter footer states the tool is a calculation and documentation aid and the determination is made by the local official under their ordinance authority. Ship the one-page data-handling and liability memo as part of onboarding, not as an afterthought.

---

## 8. OCR: Scope and Failure Modes (A4 — explicitly post-MVP)

OCR appears in exactly one place: reading contractor repair estimates to pre-fill the repair-cost side when an official prefers actual bids over unit-cost tables. Treat OCR as an assist that pre-fills fields a human confirms — never as a data source that commits values.

Failure modes to design for:

1. **Hallucinated digits.** Vision models confidently misread totals, especially handwritten or photographed-at-angle documents. Mitigation: extracted values render side-by-side with a crop of the source region; the confirm button is disabled until each field is visually verified; totals must reconcile (line items sum to subtotal, subtotal+tax = total) or the record flags for manual entry.
2. **Wrong-number selection.** Estimates contain many numbers — deposits, per-unit prices, alternates, tax. The model grabs the wrong one. Mitigation: extract the full line-item table, not a single total; require the human to tap the row that is the relevant total.
3. **Multi-page and revision confusion.** Contractors send revised estimates; page 3 supersedes page 1. Mitigation: one estimate = one document record with explicit version; never merge numbers across uploads.
4. **Field conditions.** Wet, wrinkled, low-light, glare-shot documents. Mitigation: client-side capture guidance (edge detection frame, blur warning) and a "retake" prompt below a sharpness threshold.
5. **Scope mismatch.** An estimate covering both flood repair and unrelated remodeling inflates the ratio. This is a policy failure OCR cannot catch — surface a mandatory official checkbox: "estimate reviewed for disaster-related scope only."
6. **Unit and currency artifacts.** "$12,500.00" read as "1250000". Mitigation: sanity bounds per element and per structure (repair cost > 3× market value hard-flags), thousands-separator normalization tests.

If OCR accuracy in your field test is below roughly 95% on totals, ship A4 as structured manual entry with the photo attached, and let OCR wait. Manual entry of one number takes ten seconds; a wrong committed number can invalidate a determination.

---

## 9. Agent Failure Modes and Working Protocol

You're deploying many agents in parallel. The failure modes are predictable; the protocol below is what prevents them.

1. **Schema drift.** The most destructive failure: two agents "improve" the data model divergently and every module stops composing. Protocol: `/schema/core.sql` is frozen; agents propose changes as written diffs you approve; CI fails any migration not matching the frozen schema.
2. **Invented field names and APIs.** Agents will write ingest code against the parcel schema they *imagine* Hamilton County publishes, and call library APIs that don't exist in the pinned version. Protocol: before any ingest code, an agent must download the real dataset and commit a `docs/data-contracts/` file with actual observed field names and three sample rows; code review checks against that file, not against plausibility.
3. **Fabricated domain constants.** An agent asked to "fill in the FEMA cost tables" will generate plausible numbers. This is the single scariest failure in this project because the output looks completely legitimate. Protocol: cost tables are ingested only from the committed source document, with citation and page number per table, and you spot-check 10 values by hand against the PDF.
4. **Mock data leaking into production paths.** Agents scaffold with fake parcels and forget to remove them. Protocol: all fixtures live under `/test/fixtures/`, seeded only into databases named `*_test`; CI greps the production seed for fixture markers.
5. **Silent error swallowing.** Agents wrap everything in try/catch-log-continue, which in an offline-sync app turns data loss into a mystery. Protocol: the sync queue has exactly one error policy — retry with backoff, then surface to the user visibly; empty catch blocks fail lint.
6. **Over-engineering.** Agents add Redis, message queues, microservices, and abstraction layers for a system that will hold a few thousand records. Protocol: the dependency allowlist is in the repo; anything beyond it is rejected without discussion. Boring is a requirement, not a preference.
7. **Offline-hostile "improvements."** Agents refactor capture-flow logic into server calls, quietly breaking the core field requirement. Protocol: an automated test runs the full capture flow with network disabled; it is a merge blocker.
8. **Cross-module coupling.** Add-on agents import core internals instead of the defined interfaces, so shipping A2 breaks M2. Protocol: modules communicate only through the database schema and a typed interface file; imports across module boundaries fail lint.
9. **Test theater.** Agents write tests that assert the code does what the code does, not what the spec says. Protocol: for M3 you write the golden fixtures yourself, from the SDE manual's worked examples, before any engine code exists; agents implement to your fixtures.
10. **Parallelism without a merge discipline.** 100 agents on one repo means merge chaos. Protocol: partition by module directory with owners; core (M0–M4) is a single serialized workstream you supervise directly; add-ons parallelize freely because they can only touch their own directory and the schema contract.

Research-agent variant of the same problems: agents sent to gather ordinance citations, CRS classes, or contact names will confabulate specifics. Rule: any fact that will appear in a letter template, a legal footer, or an outreach email requires a primary-source URL captured alongside it, and you verify each one before it enters the product.

---

## 10. MVP Definition and Acceptance

The MVP is proven when the following end-to-end run works on a real iPhone, on a real Noblesville-area parcel, with you playing assessor and a colleague playing official:

1. Assessor logs in, finds the structure by address, completes an 11-element assessment with photos in under 12 minutes, including 3 minutes with airplane mode on.
2. The assessment syncs; the engine produces a calculation with visible cost-table version and value source.
3. The official reviews, overrides one element with a reason, adopts the determination.
4. A letter PDF generates with correct ordinance citation, appeal language, and ICC instructions, and prints legibly.
5. The dashboard reflects the caseload; the SDE-compatible export imports into FEMA's SDE tool without manual re-keying.
6. A cross-tenant access attempt fails; the audit log shows the full chain; a database restore from last night's backup succeeds.

If any of these six fail, the MVP is not done, regardless of how many add-ons exist.

---

## 11. Additional Project Considerations (the things that get forgotten)

1. **Versioning and rollback.** Tag every deploy; keep the previous version one command away. Mid-disaster is not when you debug forward.
2. **Error monitoring.** Sentry (or equivalent) from day one, with the field PWA reporting sync failures — you will otherwise learn about breakage from an annoyed official three days later.
3. **A demo/sandbox jurisdiction.** Your pitch to Fishers should be a live walkthrough on demo data, not slides. This is also your training environment and your regression-test bed.
4. **Support channel and expectations.** One phone number/text line (yours), stated hours, and a written "what happens if the tool goes down" answer: the capture flow degrades to a printable paper form matching the element list, so the process never blocks on your uptime. Ship that PDF form with onboarding.
5. **Naming and trademark hygiene.** Search the product name against existing emergency-management vendors before it goes on a letterhead.
6. **Licensing.** Open-source (MIT or Apache-2.0) the core. It converts the "unknown vendor" objection into a "you can inspect and keep it" answer, and it is your credibility instrument with the county.
7. **Data retention policy, written now.** Determination records: retained by the jurisdiction per their records schedule (export provided). Your hosted copies: deleted on jurisdiction request within 30 days. Photos: same. Put it in the onboarding memo.
8. **Load reality check.** Hundreds of structures, tens of users. No performance work is justified anywhere except photo upload on bad connections (client-side compression to ~1600px longest edge before upload, originals optional on wifi).
9. **The handoff document.** Assume a jurisdiction wants to keep running this after you move on: a self-host README (Postgres + one container + Caddy) is part of done.
10. **Scope discipline, stated once:** every feature request from a pilot official goes on a list; nothing interrupts the MVP acceptance run. The modular architecture exists precisely so that "yes, as an add-on, after" is always a true answer.
