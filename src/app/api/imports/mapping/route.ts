import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { parametres } from "@/db/schema";
import { CHAMPS } from "@/lib/import/dossiers";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";

const CLE = "import_mapping_dossiers";

/** Correspondances de colonnes mémorisées : nom de colonne normalisé → champ. */
export const GET = handle(async () => {
  await assertImporter();
  const db = await getDb();
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, CLE));
  return { mapping: p?.valeur ?? {} };
});

export const POST = handle(async (req: Request) => {
  const u = await assertImporter();
  const champs = Object.keys(CHAMPS) as [string, ...string[]];
  const { mapping } = z.object({ mapping: z.record(z.string(), z.enum(champs)) }).parse(await req.json());
  const db = await getDb();
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, CLE));
  const valeur = { ...((p?.valeur as object) ?? {}), ...mapping };
  await db.insert(parametres).values({ cle: CLE, valeur, modifiePar: u.id })
    .onConflictDoUpdate({ target: parametres.cle, set: { valeur, modifiePar: u.id, modifieLe: new Date() } });
  return { ok: true };
});
