import { z } from "zod";
import { getDb } from "@/db";
import { createImport } from "@/lib/server/imports";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";

const Body = z.object({
  fichier: z.string().min(1).max(255),
  feuille: z.string().nullable().optional(),
  lignesLues: z.number().int().nonnegative(),
  periode: z.object({ debut: z.string().nullable(), fin: z.string().nullable() }),
  anomalies: z.object({
    lignesIgnorees: z.array(z.object({ ligne: z.number(), raison: z.string() })),
    datesFutures: z.array(z.string()),
    montantsNegatifs: z.array(z.string()),
    doublons: z.array(z.string()),
  }),
});

export const POST = handle(async (req: Request) => {
  const u = await assertImporter();
  const body = Body.parse(await req.json());
  const imp = await createImport(await getDb(), u.id, body);
  return { id: imp.id };
});
