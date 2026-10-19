import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { handle } from "@/lib/server/http";
import { enregistrerReponse } from "@/lib/server/questionnaires";

const Corps = z.object({ critereId: z.string().max(20), reponse: z.string().max(20), commentaire: z.string().max(1000).nullable().optional() });

/** Route publique (lien magique) : enregistre une réponse du client. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const b = Corps.parse(await req.json());
  await enregistrerReponse(await getDb(), token, b.critereId, b.reponse, b.commentaire ?? null);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
});
