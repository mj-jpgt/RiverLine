import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// AGENTS.md rule 1: schema/core.sql is FROZEN; migration 0001 must
// reproduce it exactly. This is the CI-style drift check T-C1 requires —
// byte-for-byte, not "close enough".
describe("migration 0001 vs schema/core.sql", () => {
  it("is byte-for-byte identical to the frozen schema file", () => {
    const root = path.resolve(__dirname, "../../..");
    const frozen = readFileSync(path.join(root, "schema/core.sql"), "utf8");
    const migration = readFileSync(path.join(root, "migrations/0001_core_schema.sql"), "utf8");
    expect(migration).toBe(frozen);
  });
});
