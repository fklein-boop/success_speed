import { and, gte, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { agenceAliases, clients, dossiers, groupes } from "@/db/schema";
import { PRODUCTION_DEFAUT, TARIFS_DEFAUT, bornesMois, syntheseAgence, type SyntheseAgence, type TableProduction, type Tarifs } from "@/lib/facturation/calcul";
import { AuditError } from "./audits";
import { ecrireParametre, lireParametre } from "./parametres";

/** Facturation des commissions mensuelles : données du mois, réglages (tarifs, table de production). */
const CLE_TARIFS = "facturation_tarifs", CLE_PROD = "facturation_production";

export async function reglagesFacturation(db: DB): Promise<{ tarifs: Tarifs; production: TableProduction }> {
  return {
    tarifs: { ...TARIFS_DEFAUT, ...((await lireParametre<Partial<Tarifs>>(db, CLE_TARIFS)) ?? {}) },
    production: (await lireParametre<TableProduction>(db, CLE_PROD)) ?? PRODUCTION_DEFAUT,
  };
}
export async function enregistrerReglages(db: DB, userId: number, tarifs: Tarifs, production: TableProduction) {
  for (const v of Object.values(tarifs)) if (!Number.isFinite(v) || v < 0 || v > 100) throw new AuditError("Tarif invalide.", 400);
  await ecrireParametre(db, CLE_TARIFS, tarifs, userId);
  await ecrireParametre(db, CLE_PROD, production, userId);
}

export interface AgenceFacturee extends SyntheseAgence { nom: string; clientId: string; groupe: string | null }

/** Synthèse de chaque agence active sur le mois (dossiers par date de réservation), et couverture des données. */
export async function facturationMois(db: DB, mois: string) {
  if (!/^\d{4}-\d{2}$/.test(mois)) throw new AuditError("Mois invalide.", 400);
  const { debut, fin } = bornesMois(mois);
  const { tarifs, production } = await reglagesFacturation(db);
  const rows = await db.select({
    idAgence: dossiers.idAgence, producteur: dossiers.producteur, pax: dossiers.pax, origine: dossiers.origine, erreurResalive: dossiers.erreurResalive,
    fournisseur: dossiers.fournisseur, total: dossiers.total, date: dossiers.date, nomAgence: dossiers.nomAgence,
  }).from(dossiers).where(and(gte(dossiers.date, debut), lte(dossiers.date, fin)));
  const [{ max }] = await db.select({ max: sql<string | null>`max(${dossiers.date})` }).from(dossiers);
  const [al, cl, gs] = await Promise.all([db.select().from(agenceAliases), db.select({ id: clients.id, nom: clients.nom, groupeId: clients.groupeId }).from(clients), db.select().from(groupes)]);
  const alias = new Map(al.map((a) => [a.idAgence, a.clientId]));
  const client = new Map(cl.map((c) => [c.id, c]));
  const groupe = new Map(gs.map((g) => [g.id, g.nom]));
  const nomExport = new Map(rows.map((r) => [r.idAgence, r.nomAgence]));
  const ids = [...new Set(rows.map((r) => r.idAgence))].sort();
  const lignes = rows.map((r) => ({ ...r, origine: r.origine ?? "" }));
  const agences: AgenceFacturee[] = ids.map((id) => {
    const cid = alias.get(id) ?? id;
    const c = client.get(cid);
    return { ...syntheseAgence(id, lignes, production), clientId: cid, nom: c?.nom ?? nomExport.get(id) ?? id, groupe: c?.groupeId ? groupe.get(c.groupeId) ?? null : null };
  }).filter((a) => a.demandes + a.resaliveKo + a.resaliveOkPax > 0);
  return { mois, debut, fin, donneesJusquau: max ? String(max).slice(0, 10) : null, complet: !!max && String(max).slice(0, 10) >= fin, tarifs, production, agences };
}
