import { generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { google, googleEnabled } from "@/lib/server/google";

export async function GET() {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/connexion?erreur=sso", process.env.APP_URL ?? "http://localhost:3000"));
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = google().createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
  url.searchParams.set("prompt", "select_account");
  const jar = await cookies();
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set("g_state", state, opts);
  jar.set("g_verifier", verifier, opts);
  return NextResponse.redirect(url);
}
