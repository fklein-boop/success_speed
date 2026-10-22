import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { DB } from "@/db";
import { audits, clients, criteres, evaluations } from "@/db/schema";
import { lireParametre } from "./parametres";
import { refreshScore } from "./audits";
import { logActivity } from "./activity";

/**
 * Lot D (retours du 22/10/2026) : nettoyage du référentiel, appliqué une seule fois (migration de données,
 * lancée par `scripts/migrate.ts` au déploiement). Chaque critère retiré reçoit une nouvelle version inactive
 * (historique conservé, réactivable dans l'administration). Les audits existants restent lisibles ;
 * leur score est recalculé sur le référentiel actif et l'historique le mentionne.
 */
export const RETIRES_LOT_D: Record<string, string> = {
  "REL-01": "pas de score de satisfaction chez nos clients",
  "REL-02": "pas de score de satisfaction (NPS) chez nos clients",
  "SOC-05": "plus aucun client sur SRA2",
  "REL-03": "devient un champ d'information de la fiche client (interlocuteur digital)",
};
const CLE = "migration_lot_d";

export async function nettoyageLotD(db: DB, maintenant = new Date()): Promise<{ retires: string[]; audits: number; interlocuteurs: number } | null> {
  if (await lireParametre(db, CLE)) return null;
  const retires: string[] = [];
  for (const id of Object.keys(RETIRES_LOT_D)) {
    const [dernier] = await db.select().from(criteres).where(eq(criteres.id, id)).orderBy(desc(criteres.version)).limit(1);
    if (!dernier || !dernier.actif) continue;
    const { createdAt: _c, ...base } = dernier;
    await db.insert(criteres).values({ ...base, version: dernier.version + 1, actif: false });
    retires.push(id);
  }

  // REL-03 → fiche client : commentaire (ou réponse) du dernier audit, si le champ est vide
  let interlocuteurs = 0;
  const rel03 = await db.select({ clientId: audits.clientId, date: audits.date, commentaire: evaluations.commentaire }).from(evaluations)
    .innerJoin(audits, eq(audits.id, evaluations.auditId)).where(and(eq(evaluations.critereId, "REL-03"), isNotNull(evaluations.commentaire))).orderBy(desc(audits.date));
  const vus = new Set<string>();
  for (const r of rel03) {
    if (vus.has(r.clientId) || !r.commentaire?.trim()) continue;
    vus.add(r.clientId);
    const [c] = await db.select({ x: clients.interlocuteurDigital }).from(clients).where(eq(clients.id, r.clientId));
    if (c && !c.x) { await db.update(clients).set({ interlocuteurDigital: r.commentaire.trim().slice(0, 200) }).where(eq(clients.id, r.clientId)); interlocuteurs++; }
  }

  // Scores recalculés sur le référentiel actif, mention dans l'historique de chaque audit concerné
  const date = maintenant.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  const concernes = retires.length ? await db.selectDistinct({ id: evaluations.auditId }).from(evaluations).where(and(inArray(evaluations.critereId, retires), isNotNull(evaluations.statut))) : [];
  const ids = new Set(concernes.map((x) => x.id));
  const tous = await db.select({ id: audits.id, mention: audits.mention }).from(audits);
  for (const a of tous) {
    await refreshScore(db, a.id);
    if (ids.has(a.id)) {
      const note = `Score recalculé le ${date} sur le référentiel actif (${retires.join(", ")} retirés).`;
      await db.update(audits).set({ mention: a.mention ? `${a.mention} · ${note}` : note }).where(eq(audits.id, a.id));
    }
  }
  const { ecrireParametre } = await import("./parametres");
  await ecrireParametre(db, CLE, { le: maintenant.toISOString(), retires, auditsMentionnes: ids.size }, null);
  await logActivity(null, "referentiel_lot_d", "critere", retires.join(","), { audits: tous.length, mentionnes: ids.size, interlocuteurs });
  return { retires, audits: tous.length, interlocuteurs };
}
