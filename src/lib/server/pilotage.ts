import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { actions, alertes, audits, clients, clientSnapshots, disponibiliteMesures, envoisClient, evaluationHistorique, evaluations, questionnaires, rdv, scanRuns } from "@/db/schema";
import type { ScoreResult } from "@/lib/audit/score";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { loadCriteres } from "./audits";
import { sitesEnPanne } from "./disponibilite";

const JOUR = 86_400_000;

// ───────────────────────── À faire cette semaine ─────────────────────────

export interface AFaire {
  critiquesSansRdv: { id: string; nom: string; alerte: string }[];
  auditsARelancer: { id: string; nom: string; raison: string; auditId: number | null }[];
  questionnairesEnAttente: { id: string; nom: string; envoyeLe: Date; relances: number }[];
  legauxNonCommuniques: { id: string; nom: string; criteres: string[]; auditId: number }[];
}

/**
 * File « À faire cette semaine » d'un CSM (ou de tout le portefeuille si csmId est null) :
 * clients critiques sans RDV, audits à relancer, questionnaires en attente, points légaux non communiqués.
 */
export async function aFaire(db: DB, csmId: number | null): Promise<AFaire> {
  const cl = (await db.select({ id: clients.id, nom: clients.nom, csmId: clients.csmId }).from(clients).where(eq(clients.actif, true)))
    .filter((c) => csmId === null || c.csmId === csmId);
  const ids = cl.map((c) => c.id);
  const vide: AFaire = { critiquesSansRdv: [], auditsARelancer: [], questionnairesEnAttente: [], legauxNonCommuniques: [] };
  if (!ids.length) return vide;
  const nom = new Map(cl.map((c) => [c.id, c.nom]));
  const [snaps, rdvs, aud, qs, envois] = await Promise.all([
    db.select({ clientId: clientSnapshots.clientId, data: clientSnapshots.data }).from(clientSnapshots).where(inArray(clientSnapshots.clientId, ids)),
    db.select({ clientId: rdv.clientId, date: rdv.date }).from(rdv).where(inArray(rdv.clientId, ids)),
    db.select({ id: audits.id, clientId: audits.clientId, date: audits.date, statut: audits.statut, score: audits.score, updatedAt: audits.updatedAt }).from(audits).where(inArray(audits.clientId, ids)).orderBy(desc(audits.date), desc(audits.id)),
    db.select().from(questionnaires).where(and(inArray(questionnaires.clientId, ids), eq(questionnaires.statut, "en_attente"))),
    db.select({ clientId: envoisClient.clientId, createdAt: envoisClient.createdAt }).from(envoisClient).where(inArray(envoisClient.clientId, ids)),
  ]);
  const maintenant = Date.now();
  const out: AFaire = { ...vide, critiquesSansRdv: [], auditsARelancer: [], questionnairesEnAttente: [], legauxNonCommuniques: [] };

  for (const s of snaps) {
    const m = s.data as ClientMetrics;
    if (m.risque !== "Critique") continue;
    // RDV à venir ou tenu dans les 30 derniers jours
    const suivi = rdvs.some((r) => r.clientId === s.clientId && r.date && r.date.getTime() > maintenant - 30 * JOUR);
    if (!suivi) out.critiquesSansRdv.push({ id: s.clientId, nom: nom.get(s.clientId)!, alerte: m.alerte_principale });
  }
  for (const id of ids) {
    const list = aud.filter((a) => a.clientId === id);
    const brouillon = list.find((a) => a.statut === "brouillon");
    const dernierFin = list.find((a) => a.statut === "finalise");
    const risque = (snaps.find((s) => s.clientId === id)?.data as ClientMetrics | undefined)?.risque;
    if (brouillon && brouillon.updatedAt.getTime() < maintenant - 14 * JOUR) out.auditsARelancer.push({ id, nom: nom.get(id)!, raison: `Audit en cours sans modification depuis ${Math.floor((maintenant - brouillon.updatedAt.getTime()) / JOUR)} jours`, auditId: brouillon.id });
    // Audit de plus de 6 mois à refaire pour un client à risque (les clients jamais audités sont suivis par la couverture d'audit)
    else if (!brouillon && risque && risque !== "Sain" && dernierFin && Date.parse(dernierFin.date) < maintenant - 183 * JOUR)
      out.auditsARelancer.push({ id, nom: nom.get(id)!, raison: `Client ${risque.toLowerCase()}, dernier audit le ${new Date(dernierFin.date).toLocaleDateString("fr-FR")}`, auditId: null });
    if (dernierFin) {
      const legaux = (dernierFin.score as ScoreResult | null)?.legauxNon ?? [];
      const communique = envois.some((e) => e.clientId === id && e.createdAt.toISOString().slice(0, 10) >= dernierFin.date);
      if (legaux.length && !communique) out.legauxNonCommuniques.push({ id, nom: nom.get(id)!, criteres: legaux, auditId: dernierFin.id });
    }
  }
  for (const q of qs) {
    if (!q.envoyeLe || q.envoyeLe.getTime() > maintenant - 3 * JOUR) continue;
    out.questionnairesEnAttente.push({ id: q.clientId!, nom: nom.get(q.clientId!) ?? q.clientId!, envoyeLe: q.envoyeLe, relances: Number(!!q.relance1Le) + Number(!!q.relance2Le) });
  }
  out.critiquesSansRdv.sort((a, b) => a.nom.localeCompare(b.nom));
  return out;
}

// ───────────────────────── Fil des alertes ─────────────────────────

export async function filAlertes(db: DB, jours = 60) {
  const depuis = new Date(Date.now() - jours * JOUR);
  const rows = await db.select({
    id: alertes.id, clientId: alertes.clientId, nom: clients.nom, csmId: clients.csmId, code: alertes.code, niveau: alertes.niveau,
    message: alertes.message, source: alertes.source, ouverteLe: alertes.ouverteLe, closeLe: alertes.closeLe,
  }).from(alertes).innerJoin(clients, eq(clients.id, alertes.clientId))
    .where(sql`${alertes.closeLe} is null or ${alertes.ouverteLe} >= ${depuis} or ${alertes.closeLe} >= ${depuis}`)
    .orderBy(desc(alertes.ouverteLe));
  return rows;
}

// ───────────────────────── Benchmark (§ 7) ─────────────────────────

/** Effectif en dessous duquel on affiche l'avertissement « corrélation, pas causalité ». */
export const EFFECTIF_FIABLE = 10;

export async function benchmark(db: DB) {
  const cs = await loadCriteres(db);
  const fin = await db.select({ id: audits.id, clientId: audits.clientId, date: audits.date, score: audits.score }).from(audits)
    .where(eq(audits.statut, "finalise")).orderBy(desc(audits.date), desc(audits.id));
  const dernier = new Map<string, (typeof fin)[number]>();
  for (const a of fin) if (!dernier.has(a.clientId)) dernier.set(a.clientId, a);
  const auditIds = [...dernier.values()].map((a) => a.id);
  const evs = auditIds.length ? await db.select({ auditId: evaluations.auditId, critereId: evaluations.critereId, statut: evaluations.statut }).from(evaluations).where(inArray(evaluations.auditId, auditIds)) : [];
  const snaps = new Map((await db.select({ clientId: clientSnapshots.clientId, data: clientSnapshots.data }).from(clientSnapshots)).map((s) => [s.clientId, s.data as ClientMetrics]));
  const clientDeAudit = new Map([...dernier].map(([cid, a]) => [a.id, cid]));

  const parCritere = cs.map((c) => {
    const lignes = evs.filter((e) => e.critereId === c.id && e.statut && e.statut !== "N.A.").map((e) => ({ clientId: clientDeAudit.get(e.auditId)!, oui: e.statut === "OUI" || e.statut === "CORRIGÉ" }));
    const champ = lignes.filter((l) => snaps.get(l.clientId)?.segment === "Champion");
    const autres = lignes.filter((l) => snaps.get(l.clientId) && snaps.get(l.clientId)!.segment !== "Champion");
    const taux = (x: typeof lignes) => (x.length ? x.filter((l) => l.oui).length / x.length : null);
    const evol = (x: typeof lignes) => { const v = x.map((l) => snaps.get(l.clientId)?.evol_90j).filter((n): n is number => typeof n === "number"); return { n: v.length, moyenne: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }; };
    const tc = taux(champ), ta = taux(autres);
    return {
      id: c.id, critere: c.critere, pilier: c.pilier,
      champions: { n: champ.length, taux: tc }, autres: { n: autres.length, taux: ta },
      ecart: tc !== null && ta !== null ? tc - ta : null,
      evolOui: evol(lignes.filter((l) => l.oui)), evolNon: evol(lignes.filter((l) => !l.oui)),
    };
  });
  const nuage = [...dernier].map(([cid, a]) => {
    const m = snaps.get(cid);
    const s = a.score as ScoreResult | null;
    return m && s?.score !== null && s?.score !== undefined && m.evol_90j !== null ? { clientId: cid, maturite: s.score, evol90: m.evol_90j, segment: m.segment } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const noms = new Map((await db.select({ id: clients.id, nom: clients.nom }).from(clients)).map((c) => [c.id, c.nom]));
  return {
    nbAudits: dernier.size,
    ecarts: parCritere.filter((p) => p.ecart !== null).sort((a, b) => Math.abs(b.ecart!) - Math.abs(a.ecart!)).slice(0, 5),
    parCritere,
    nuage: nuage.map((n) => ({ ...n, nom: noms.get(n.clientId) ?? n.clientId })),
  };
}

// ───────────────────────── Opportunités consolidées ─────────────────────────

export async function opportunites(db: DB) {
  const cl = new Map((await db.select({ id: clients.id, nom: clients.nom, csmId: clients.csmId }).from(clients).where(eq(clients.actif, true))).map((c) => [c.id, c]));
  const snaps = await db.select({ clientId: clientSnapshots.clientId, data: clientSnapshots.data }).from(clientSnapshots);
  const out: { clientId: string; nom: string; csmId: number | null; source: "données" | "audit"; type: string; detail: string; offre: string | null; statut: string | null }[] = [];
  for (const s of snaps) {
    const c = cl.get(s.clientId);
    if (!c) continue;
    for (const o of (s.data as ClientMetrics).opportunites) out.push({ clientId: c.id, nom: c.nom, csmId: c.csmId, source: "données", type: o.libelle, detail: o.detail, offre: null, statut: null });
  }
  const acts = await db.select().from(actions).where(sql`${actions.statut} not in ('fait', 'abandonne')`);
  for (const a of acts) {
    const c = cl.get(a.clientId);
    if (!c) continue;
    out.push({ clientId: c.id, nom: c.nom, csmId: c.csmId, source: "audit", type: "Plan d'action", detail: `${a.critereId ?? ""} ${a.libelle}`.trim(), offre: a.offre, statut: a.statut });
  }
  return out;
}

// ───────────────────────── Durées (objectifs : pré-audit < 3 min, complétion < 10 min) ─────────────────────────

const mediane = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Durée des pré-audits (début → fin du scan complet) et temps de complétion des audits finalisés :
 * somme des intervalles entre deux enregistrements du CSM, chaque intervalle plafonné à 5 minutes
 * (on ne compte pas les pauses).
 */
export async function durees(db: DB, jours = 90) {
  const depuis = new Date(Date.now() - jours * JOUR);
  const scans = await db.select({ debut: scanRuns.debut, fin: scanRuns.fin }).from(scanRuns)
    .where(and(eq(scanRuns.type, "complet"), eq(scanRuns.statut, "termine"), gte(scanRuns.createdAt, depuis)));
  const ds = scans.filter((s) => s.debut && s.fin).map((s) => (s.fin!.getTime() - s.debut!.getTime()) / 1000);
  const fins = await db.select({ id: audits.id }).from(audits).where(and(eq(audits.statut, "finalise"), gte(audits.finaliseLe, depuis)));
  const dc: number[] = [];
  for (const a of fins) {
    const h = await db.select({ at: evaluationHistorique.createdAt }).from(evaluationHistorique)
      .where(and(eq(evaluationHistorique.auditId, a.id), sql`${evaluationHistorique.auteurId} is not null`)).orderBy(evaluationHistorique.createdAt);
    if (h.length < 2) continue;
    let t = 0;
    for (let i = 1; i < h.length; i++) t += Math.min(300, (h[i].at.getTime() - h[i - 1].at.getTime()) / 1000);
    dc.push(t + 20);
  }
  return {
    preAudit: { n: ds.length, mediane: mediane(ds), sousObjectif: ds.length ? ds.filter((d) => d <= 180).length / ds.length : null },
    completion: { n: dc.length, mediane: mediane(dc), sousObjectif: dc.length ? dc.filter((d) => d <= 600).length / dc.length : null },
  };
}

// ───────────────────────── Monitoring de disponibilité ─────────────────────────

export async function etatMonitoring(db: DB) {
  const depuis30 = new Date(Date.now() - 30 * JOUR);
  const stats = await db.select({
    clientId: disponibiliteMesures.clientId, url: sql<string>`max(${disponibiliteMesures.url})`,
    mesures: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${disponibiliteMesures.ok})::int`,
    derniere: sql<string>`max(${disponibiliteMesures.at})`, tempsMoyen: sql<number>`avg(${disponibiliteMesures.dureeMs})::int`,
  }).from(disponibiliteMesures).where(gte(disponibiliteMesures.at, depuis30)).groupBy(disponibiliteMesures.clientId);
  const enPanne = await sitesEnPanne(db);
  const noms = new Map((await db.select({ id: clients.id, nom: clients.nom }).from(clients)).map((c) => [c.id, c.nom]));
  return stats.map((s) => ({ ...s, nom: noms.get(s.clientId) ?? s.clientId, taux: s.mesures ? s.ok / s.mesures : null, panne: enPanne.get(s.clientId) ?? null }))
    .sort((a, b) => (a.taux ?? 1) - (b.taux ?? 1));
}

