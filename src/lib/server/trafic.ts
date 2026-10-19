import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { clients, clientSnapshots, clientUrls, imports, metriquesClientMensuelles } from "@/db/schema";
import { normaliser, rapprocher, type ClientRef, type LigneTrafic } from "@/lib/import/trafic";
import { DEFAULT_METRICS_PARAMS } from "@/lib/metrics/params";
import { AuditError } from "./audits";
import { lireParametre, ecrireParametre } from "./parametres";
import { recomputeAll } from "./recompute";
import { logActivity } from "./activity";

/** Correspondances nom → client, partagées par le fichier GTM et Google Analytics 4 ("" = ignorer). */
export const CLE_MEMO = "trafic_correspondances";

export async function clientsRef(db: DB): Promise<ClientRef[]> {
  const [cl, urls] = await Promise.all([
    db.select({ id: clients.id, nom: clients.nom }).from(clients).where(eq(clients.actif, true)),
    db.select({ clientId: clientUrls.clientId, url: clientUrls.url }).from(clientUrls),
  ]);
  return cl.map((c) => ({ ...c, urls: urls.filter((u) => u.clientId === c.id).map((u) => u.url) }));
}

/** Date des données (pour l'année par défaut des colonnes « May », « June »…). */
export async function referenceDonnees(db: DB): Promise<string> {
  const [s] = await db.select({ r: clientSnapshots.reference }).from(clientSnapshots).limit(1);
  return s?.r ?? new Date().toISOString().slice(0, 10);
}

/** Aperçu : client proposé pour chaque ligne du fichier (correspondances mémorisées en priorité). */
export async function apercuTrafic(db: DB, lignes: LigneTrafic[]) {
  const cl = await clientsRef(db);
  const memo = (await lireParametre<Record<string, string>>(db, CLE_MEMO)) ?? {};
  const demo = new Set(DEFAULT_METRICS_PARAMS.agencesDemo.map((x) => x.toLowerCase()));
  return {
    clients: cl.map((c) => ({ id: c.id, nom: c.nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    lignes: lignes.map((l) => {
      // Comptes de démonstration (D01 - RECETTE…) ignorés d'office
      const estDemo = [...demo].some((d) => normaliser(l.nom).startsWith(d));
      const r = estDemo ? { clientId: null, score: 0, sur: true } : rapprocher(l.nom, cl, memo);
      return { ...l, ...r, demo: estDemo, total: Object.values(l.valeurs).reduce((a, b) => a + b, 0) };
    }),
  };
}

/**
 * Enregistre les visites (ligne → client choisi dans l'aperçu ; plusieurs lignes d'un même client s'additionnent),
 * mémorise les correspondances choisies, recalcule conversion, manque à gagner et leviers.
 */
export async function appliquerTrafic(db: DB, userId: number, x: { fichier: string; lignes: LigneTrafic[]; correspondances: Record<string, string | null> }) {
  const valides = new Set((await clientsRef(db)).map((c) => c.id));
  const parCle = new Map<string, number>();
  const clientsTouches = new Set<string>();
  for (const l of x.lignes) {
    const cid = x.correspondances[l.nom];
    if (!cid) continue;
    if (!valides.has(cid)) throw new AuditError(`Client inconnu : ${cid}`, 400);
    clientsTouches.add(cid);
    for (const [mois, v] of Object.entries(l.valeurs)) {
      if (!/^\d{4}-\d{2}$/.test(mois) || !Number.isFinite(v) || v < 0) throw new AuditError("Données de trafic invalides.", 400);
      parCle.set(`${cid}|${mois}`, (parCle.get(`${cid}|${mois}`) ?? 0) + Math.round(v));
    }
  }
  if (!parCle.size) throw new AuditError("Aucune ligne rattachée à un client.", 400);

  // Mémoriser les choix pour les prochains imports (y compris « ignorer »)
  const memo = (await lireParametre<Record<string, string>>(db, CLE_MEMO)) ?? {};
  for (const [nom, cid] of Object.entries(x.correspondances)) memo[normaliser(nom)] = cid ?? "";
  await ecrireParametre(db, CLE_MEMO, memo, userId);

  const mois = [...new Set([...parCle.keys()].map((k) => k.split("|")[1]))].sort();
  for (const [k, visites] of parCle) {
    const [clientId, m] = k.split("|");
    // Les mois déjà mesurés par Google Analytics 4 ne sont pas écrasés par le fichier
    await db.insert(metriquesClientMensuelles).values({ clientId, mois: m, visites, sourceTrafic: "fichier" })
      .onConflictDoUpdate({ target: [metriquesClientMensuelles.clientId, metriquesClientMensuelles.mois], set: { visites, sourceTrafic: "fichier" }, setWhere: sql`coalesce(${metriquesClientMensuelles.sourceTrafic}, 'fichier') <> 'ga4'` });
  }
  const [imp] = await db.insert(imports).values({
    type: "trafic", fichier: x.fichier, userId, statut: "applique", periodeDebut: `${mois[0]}-01`, periodeFin: `${mois[mois.length - 1]}-01`,
    stats: { clients: clientsTouches.size, mois: mois.length, valeurs: parCle.size, lignesIgnorees: x.lignes.filter((l) => !x.correspondances[l.nom]).map((l) => l.nom) },
    appliqueLe: new Date(),
  }).returning();
  await recomputeAll(db);
  await logActivity(userId, "import_trafic", "import", String(imp.id), { clients: clientsTouches.size, mois });
  return { clients: clientsTouches.size, mois, valeurs: parCle.size };
}

export async function historiqueTrafic(db: DB) {
  return db.select().from(imports).where(and(eq(imports.type, "trafic"), inArray(imports.statut, ["applique"]))).orderBy(desc(imports.appliqueLe)).limit(10);
}

/** Effacer le trafic importé par fichier (en cas d'erreur de rattachement) ; les mesures Google Analytics 4 sont conservées. */
export async function effacerTrafic(db: DB, userId: number) {
  await db.update(metriquesClientMensuelles).set({ visites: null, sourceTrafic: null })
    .where(sql`${metriquesClientMensuelles.visites} is not null and coalesce(${metriquesClientMensuelles.sourceTrafic}, 'fichier') <> 'ga4'`);
  await recomputeAll(db);
  await logActivity(userId, "trafic_efface", "import", "", {});
}
