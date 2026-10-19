import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { handle } from "@/lib/server/http";
import { soumettreQuestionnaire } from "@/lib/server/questionnaires";

/** Route publique (lien magique) : le client envoie ses réponses ; le lien est ensuite clos. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  await soumettreQuestionnaire(await getDb(), token);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
});
