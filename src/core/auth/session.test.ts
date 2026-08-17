import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createSessionCookieValue, verifySessionCookie } from "./session";

describe("session cookie", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "a".repeat(32);
  });

  it("round-trips a valid session", () => {
    const { value, maxAgeSeconds } = createSessionCookieValue({
      userId: "11111111-1111-1111-1111-111111111111",
      jurisdictionId: "22222222-2222-2222-2222-222222222222",
      role: "assessor",
      email: "assessor@example.gov",
    });
    expect(maxAgeSeconds).toBe(12 * 60 * 60);

    const payload = verifySessionCookie(value);
    expect(payload).not.toBeNull();
    expect(payload?.role).toBe("assessor");
    expect(payload?.email).toBe("assessor@example.gov");
  });

  it("rejects a tampered signature", () => {
    const { value } = createSessionCookieValue({
      userId: "1",
      jurisdictionId: "2",
      role: "viewer",
      email: "v@example.gov",
    });
    const tampered = value.slice(0, -1) + (value.at(-1) === "a" ? "b" : "a");
    expect(verifySessionCookie(tampered)).toBeNull();
  });

  it("rejects an expired session", () => {
    const { value } = createSessionCookieValue({
      userId: "1",
      jurisdictionId: "2",
      role: "viewer",
      email: "v@example.gov",
    });
    const dot = value.lastIndexOf(".");
    const payloadB64 = value.slice(0, dot);
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    payload.exp = Math.floor(Date.now() / 1000) - 10;
    // Re-sign with the tampered (expired) payload using the same secret so
    // this test isolates expiry handling, not signature handling.
    const newPayloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const newSig = createHmac("sha256", process.env.SESSION_SECRET!)
      .update(newPayloadB64)
      .digest("base64url");
    expect(verifySessionCookie(`${newPayloadB64}.${newSig}`)).toBeNull();
  });

  it("returns null for missing/garbage input", () => {
    expect(verifySessionCookie(null)).toBeNull();
    expect(verifySessionCookie(undefined)).toBeNull();
    expect(verifySessionCookie("not-a-real-cookie")).toBeNull();
  });
});
