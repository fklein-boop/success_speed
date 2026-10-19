import { and, desc, eq, inArray } from "drizzle-orm";
import type { ScoreResult } from "@/lib/audit/score";
import type { DB } from "@/db";
import { audits, clients, clientSnapshots, clientUrls, groupes, imports, users } from "@/db/schema";
import type { ClientMetrics } from "@/lib/metrics/compute";

export interface PortfolioRow {
  id: string;
  nom: string;
  modele: string | null;
  groupe: string | null;
  csmId: number | null;
  csm: string | null;
  urls: string[];
  horsExport: boolean;
  vaCompteeDansTotaux: boolean;
  m: ClientMetrics | null;
  dernierAudit: string | null;
  /** Dernier audit finalisé */
  maturite: { score: number | null; scoreApres: number | null; couverture: number; statut: string | null; auditId: number } | null;
  /** Audit en cours (brouillon) */
  auditEnCours: number | null;
}

export async function loadPortfolio(db: DB) {
  const [cl, snaps, urls, us, gs, au] = await Promise.all([
    db.select().from(clients).where(eq(clients.actif, true)),
    db.select().from(clientSnapshots),
    db.select().from(clientUrls),
    db.select({ id: users.id, nom: users.nom, email: users.email }).from(users),
    db.select().from(groupes),
    db.select({ id: audits.id, clientId: audits.clientId, date: audits.date, statut: audits.statut, score: audits.score }).from(audits).orderBy(desc(audits.date), desc(audits.id)),
  ]);
  const snap = new Map(snaps.map((s) => [s.clientId, s]));
  const userName = new Map(us.map((u) => [u.id, u.nom || u.email]));
  const groupe = new Map(gs.map((g) => [g.id, g.nom]));
  const lastAudit = new Map<string, (typeof au)[number]>();
  const enCours = new Map<string, number>();
  for (const a of au) {
    if (a.statut === "finalise" && !lastAudit.has(a.clientId)) lastAudit.set(a.clientId, a);
    if (a.statut === "brouillon") enCours.set(a.clientId, a.id);
  }
  const rows: PortfolioRow[] = cl.map((c) => ({
    id: c.id,
    nom: c.nom,
    modele: c.modele,
    groupe: c.groupeId ? groupe.get(c.groupeId) ?? null : null,
    csmId: c.csmId,
    csm: c.csmId ? userName.get(c.csmId) ?? null : null,
    urls: urls.filter((u) => u.clientId === c.id).sort((a, b) => Number(b.principale) - Number(a.principale)).map((u) => u.url),
    horsExport: c.horsExport,
    vaCompteeDansTotaux: c.vaCompteeDansTotaux,
    m: (snap.get(c.id)?.data as ClientMetrics | undefined) ?? null,
    dernierAudit: lastAudit.get(c.id)?.date ?? null,
    maturite: (() => {
      const a = lastAudit.get(c.id);
      const s = a?.score as ScoreResult | null | undefined;
      return a && s ? { score: s.score, scoreApres: s.scoreApres, couverture: s.couverture, statut: s.statut, auditId: a.id } : null;
    })(),
    auditEnCours: enCours.get(c.id) ?? null,
  }));
  const reference = snaps[0]?.reference ?? null;
  const [lastImport] = await db.select().from(imports).where(and(eq(imports.type, "dossiers"), inArray(imports.statut, ["applique"]))).orderBy(desc(imports.appliqueLe)).limit(1);
  return { rows, reference, lastImport: lastImport ?? null, kpis: computeKpis(rows, reference) };
}

export function computeKpis(rows: PortfolioRow[], reference: string | null) {
  const withM = rows.filter((r) => r.m);
  const sum = (f: (m: ClientMetrics) => number) => withM.reduce((s, r) => s + f(r.m!), 0);
  const volume12 = sum((m) => m.volume_12m);
  const confirme12 = sum((m) => m.va_confirme_12m);
  const ytd = sum((m) => m.volume_ytd);
  const ytdN1 = sum((m) => m.volume_ytd_n1);
  const critiques = withM.filter((r) => r.m!.risque === "Critique").length;
  const surveiller = withM.filter((r) => r.m!.risque === "À surveiller").length;
  // Potentiel : l'estimation d'un groupe n'est comptée qu'une fois
  const vaTotal = withM.filter((r) => r.vaCompteeDansTotaux).reduce((s, r) => s + (r.m!.va_global_estime ?? 0), 0);
  const volumeAvecVa = withM.filter((r) => r.m!.va_global_estime).reduce((s, r) => s + r.m!.volume_12m, 0);
  // Dépendance : poids du premier groupe client (les comptes d'un même groupe sont additionnés)
  const parGroupe = new Map<string, number>();
  for (const r of withM) {
    const k = r.groupe ?? r.nom;
    parGroupe.set(k, (parGroupe.get(k) ?? 0) + r.m!.volume_12m);
  }
  const [premier] = [...parGroupe].sort((a, b) => b[1] - a[1]);
  const six = reference ? new Date(Date.parse(reference) - 183 * 86_400_000).toISOString().slice(0, 10) : null;
  const audites = rows.filter((r) => r.dernierAudit && six && r.dernierAudit >= six).length;
  return {
    volume12, confirme12, ytd, ytdN1,
    evolYtd: ytdN1 > 0 ? ytd / ytdN1 - 1 : null,
    critiques, surveiller, nbClients: rows.length,
    partCaptee: vaTotal > 0 ? volumeAvecVa / vaTotal : null,
    vaTotal,
    premierGroupe: premier ? { nom: premier[0], part: volume12 > 0 ? premier[1] / volume12 : 0 } : null,
    couvertureAudit: rows.length ? audites / rows.length : 0,
    audites,
  };
}
