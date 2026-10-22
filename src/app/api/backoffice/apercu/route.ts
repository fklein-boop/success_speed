import { z } from "zod";
import { getDb } from "@/db";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";
import { apercuExport } from "@/lib/server/backoffice";

const Body = z.object({
  type: z.enum(["catalogue", "configuration", "connexions", "paybox"]),
  lignes: z.array(z.object({ idAgence: z.string().min(1).max(20), date: z.string().nullable().optional() })).max(200000),
});

/** Aperçu d'un export back-office : lignes, clients reconnus, agences inconnues, période. */
export const POST = handle(async (req: Request) => {
  await assertImporter();
  const { type, lignes } = Body.parse(await req.json());
  return apercuExport(await getDb(), type, lignes);
});
