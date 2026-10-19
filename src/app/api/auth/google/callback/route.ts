import { decodeIdToken } from "arctic";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl, createSession, findAllowedUser } from "@/lib/server/auth";
import { google, googleEnabled } from "@/lib/server/google";

export async function GET(req: NextRequest) {
  const fail = () => NextResponse.redirect(`${appUrl()}/connexion?erreur=refus`);
  if (!googleEnabled()) return fail();
  const jar = await cookies();
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const expected = jar.get("g_state")?.value;
  const verifier = jar.get("g_verifier")?.value;
  jar.delete("g_state");
  jar.delete("g_verifier");
  if (!state || !code || !expected || !verifier || state !== expected) return fail();
  try {
    const tokens = await google().validateAuthorizationCode(code, verifier);
    const claims = decodeIdToken(tokens.idToken()) as { email?: string; email_verified?: boolean; name?: string };
    if (!claims.email || !claims.email_verified) return fail();
    // SSO toujours restreint à la liste blanche
    const user = await findAllowedUser(claims.email);
    if (!user) return fail();
    await createSession(user, "google");
    return NextResponse.redirect(`${appUrl()}/`);
  } catch {
    return fail();
  }
}
