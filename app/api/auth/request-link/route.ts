import { NextResponse } from "next/server";
import { z } from "zod";
import { requestMagicLink } from "@/core/auth";

const bodySchema = z.object({ email: z.string().trim().email() });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  try {
    await requestMagicLink(parsed.data.email);
  } catch (err) {
    console.error("[auth] request-link failed:", err);
    return NextResponse.json(
      { error: "Could not process the request right now. Try again shortly." },
      { status: 500 },
    );
  }

  // Same response whether or not the email is on the roster — do not leak
  // allowlist membership.
  return NextResponse.json({ requested: true });
}
