# Golden fixtures — 50%-rule engine (M3)

**ORCHESTRATOR-AUTHORED 2026-08-17. Agents: implement to these. Never modify,
extend, or regenerate this directory.** (ORCHESTRATOR.md "What you personally
own"; SUBAGENT.md test-agent rule 2.)

Semantics fixed for engine v1 (build spec §5, constitution §2):
- element repair cost = base_cost_per_sqft[element_code] × sq_ft × (damage_pct/100)
- total_repair_cost = Σ element repair costs (elements absent from input = 0%)
- ratio = total_repair_cost / market_value_used, rounded half-up to 4 dp
- threshold_result: ratio < 0.45 → NOT_SD; 0.45 ≤ ratio < 0.55 → BORDERLINE;
  ratio ≥ 0.55 → SD. (Routing bands only. The legal threshold is 50% and all
  user-facing copy states 50%; BORDERLINE forces official review.)
- market_value_used ≤ 0 → error, no calculation row.
- Depreciation (FEMA P-784 Table 3-5) is NOT applied in v1 — it belongs to the
  computed-value path, which is out of scope until a real cost guide is chosen.
  The verified Table 3-5 constants live in docs/data-contracts/sde-cost-tables.md.
- Element codes = verified SDE 3.0 sets (12 residential / 7 non-residential).

`cost-table.test-fixture-v0.json` uses ARBITRARY round dollar values labeled
TEST-FIXTURE. They exist to verify arithmetic, not to price anything. They must
never load outside a *_test database (AGENTS.md rule 6).

Every expected value in cases.json was computed by hand by the orchestrator;
the arithmetic is shown in the `working` field of each case.
