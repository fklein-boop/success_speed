import { z } from "zod";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { saveEvaluation } from "@/lib/server/audits";
import { STATUTS } from "@/lib/audit/score";
import { handle } from "@/lib/server/http";

const Body = z.object({
  critereId: z.string(),
  statut: z.enum(STATUTS).nullable(),
  valeur: z.number().finite().nullable(),
  commentaire: z.string().max(2000).nullable(),
  aEnvoyerClient: z.boolean(),
  base: z.string().nullable(),
  force: z.boolean().optional(),
});

/** Enregistrement d'un critère (sauvegarde automatique, critère par critère). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser(["superadmin", "csm"]);
  const { id } = await ctx.params;
  return saveEvaluation(await getDb(), Number(id), u.id, Body.parse(await req.json()));
});
