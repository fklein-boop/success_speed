import { z } from "zod";
import { getDb } from "@/db";
import { addRows } from "@/lib/server/imports";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";

export const maxDuration = 60;

const Row = z.object({
  idResa: z.string().min(1), idAgence: z.string().min(1), producteur: z.boolean(),
  voyage: z.string().nullable(), nomAgence: z.string().nullable(), fournisseur: z.string().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), heure: z.string().nullable(), pax: z.number().nullable(),
  statut: z.string().min(1), origine: z.string(), total: z.number(), encaisse: z.number(), erreurResalive: z.boolean(),
  idProduit: z.string().max(100).nullable().optional(), canal: z.string().max(60).nullable().optional(),
  montantOptions: z.number().nullable().optional(), montantAssurance: z.number().nullable().optional(),
  dateConfirmation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), emailRenseigne: z.boolean().nullable().optional(),
  payeEnLigne: z.number().nullable().optional(),
});
const Body = z.object({ rows: z.array(Row).max(10000) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertImporter();
  const { id } = await ctx.params;
  const { rows } = Body.parse(await req.json());
  await addRows(await getDb(), Number(id), rows);
  return { ok: true, n: rows.length };
});
