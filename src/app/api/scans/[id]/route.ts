import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { loadCriteres } from "@/lib/server/audits";
import { etatScan } from "@/lib/server/scans";
import { handle } from "@/lib/server/http";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertUser();
  const { id } = await ctx.params;
  const db = await getDb();
  const [s, cs] = await Promise.all([etatScan(db, Number(id)), loadCriteres(db)]);
  const libelle = new Map(cs.map((c) => [c.id, { critere: c.critere, pilier: c.pilier, unite: c.unite, legal: c.obligationLegale }]));
  return { ...s, criteres: Object.fromEntries(s.resultats.map((r) => [r.critereId, libelle.get(r.critereId)])) };
});
