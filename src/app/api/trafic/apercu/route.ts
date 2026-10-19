import { z } from "zod";
import { getDb } from "@/db";
import { assertImporter } from "@/lib/server/import-access";
import { handle } from "@/lib/server/http";
import { apercuTrafic } from "@/lib/server/trafic";

const Ligne = z.object({ nom: z.string().max(200), valeurs: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().nonnegative()) });

/** Aperçu de l'import du trafic : client proposé pour chaque ligne. */
export const POST = handle(async (req: Request) => {
  await assertImporter();
  const { lignes } = z.object({ lignes: z.array(Ligne).max(2000) }).parse(await req.json());
  return apercuTrafic(await getDb(), lignes);
});
