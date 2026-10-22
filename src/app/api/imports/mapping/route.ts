import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { parametres } from "@/db/schema";
import { CHAMPS } from "@/lib/import/dossiers";
import { COLONNES, type TypeBackoffice } from "@/lib/import/backoffice";
import { handle } from "@/lib/server/http";
import { assertImporter } from "@/lib/server/import-access";

const TYPES = ["dossiers", "catalogue", "configuration", "connexions", "paybox"] as const;
const cle = (t: string) => `import_mapping_${t}`;
const typeDe = (req: Request) => z.enum(TYPES).catch("dossiers").parse(new URL(req.url).searchParams.get("type") ?? "dossiers");

/** Correspondances de colonnes mémorisées par type d'export : nom de colonne normalisé → champ. */
export const GET = handle(async (req: Request) => {
  await assertImporter();
  const db = await getDb();
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, cle(typeDe(req))));
  return { mapping: p?.valeur ?? {} };
});

export const POST = handle(async (req: Request) => {
  const u = await assertImporter();
  const type = typeDe(req);
  const champs = Object.keys(type === "dossiers" ? CHAMPS : COLONNES[type as TypeBackoffice]) as [string, ...string[]];
  const { mapping } = z.object({ mapping: z.record(z.string(), z.enum(champs)) }).parse(await req.json());
  const db = await getDb();
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, cle(type)));
  const valeur = { ...((p?.valeur as object) ?? {}), ...mapping };
  await db.insert(parametres).values({ cle: cle(type), valeur, modifiePar: u.id })
    .onConflictDoUpdate({ target: parametres.cle, set: { valeur, modifiePar: u.id, modifieLe: new Date() } });
  return { ok: true };
});
