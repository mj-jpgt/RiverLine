import { NextResponse } from "next/server";
import { verifyMagicLink, createSessionCookieValue, SESSION_COOKIE_NAME } from "@/core/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  const login = await verifyMagicLink(token);
  if (!login) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
  }

  const { value, maxAgeSeconds } = createSessionCookieValue(login);

  const response = NextResponse.redirect(new URL("/home", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    path: "/",
  });
  return response;
}
