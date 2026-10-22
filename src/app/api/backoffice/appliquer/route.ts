import { z } from "zod";
import { getDb } from "@/db";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";
import { appliquerExport } from "@/lib/server/backoffice";
import type { LigneBackoffice } from "@/lib/import/backoffice";

export const maxDuration = 120;

const Valeur = z.union([z.string().max(300), z.number(), z.boolean(), z.null(), z.array(z.string().max(120)).max(50)]);
const Body = z.object({
  type: z.enum(["catalogue", "configuration", "connexions", "paybox"]),
  fichier: z.string().max(300),
  importId: z.number().int().positive().optional(),
  lignes: z.array(z.record(z.string().max(40), Valeur)).min(1).max(5000),
});

/** Enregistre un morceau d'export back-office (le premier crée l'import, les suivants passent importId). */
export const POST = handle(async (req: Request) => {
  const u = await assertImporter();
  const b = Body.parse(await req.json());
  const lignes = b.lignes.filter((l) => typeof l.idAgence === "string" && l.idAgence) as LigneBackoffice[];
  const r = await appliquerExport(await getDb(), u.id, b.type, b.fichier, lignes, b.importId ? { importId: b.importId } : undefined);
  return { importId: r.importId, lignes: lignes.length };
});
