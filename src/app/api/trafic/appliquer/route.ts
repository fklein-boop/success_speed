import { z } from "zod";
import { getDb } from "@/db";
import { assertImporter } from "@/lib/server/import-access";
import { handle } from "@/lib/server/http";
import { appliquerTrafic } from "@/lib/server/trafic";

export const maxDuration = 300;

const Corps = z.object({
  fichier: z.string().max(300),
  lignes: z.array(z.object({ nom: z.string().max(200), valeurs: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().nonnegative()) })).max(2000),
  correspondances: z.record(z.string().max(200), z.string().max(20).nullable()),
});

/** Validation de l'import du trafic : visites enregistrées, conversion et manque à gagner recalculés. */
export const POST = handle(async (req: Request) => {
  const u = await assertImporter();
  return appliquerTrafic(await getDb(), u.id, Corps.parse(await req.json()));
});
