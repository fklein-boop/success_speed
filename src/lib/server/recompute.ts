import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { agenceAliases, alertes, audits, clients, rdv, scanResults, scanRuns, clientSnapshots, dossiers, metriquesClientMensuelles, parametres } from "@/db/schema";
import { computePortfolio, monthlySeries, type ClientMetrics, type Dossier } from "@/lib/metrics/compute";
import { mergeParams, type MetricsParams } from "@/lib/metrics/params";
import { manqueAGagner, traficClient, type MoisWeb } from "@/lib/metrics/trafic";
import { sitesEnPanne } from "./disponibilite";
import { configsParClient, derniereConnexionParClient } from "./backoffice";

export async function getMetricsParams(db: DB): Promise<MetricsParams> {
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, "metrics"));
  return mergeParams(p?.valeur);
}

export interface RecomputeDiff {
  reference: string | null;
  nouveauxCritiques: { id: string; nom: string; alerte: string }[];
  reprises: { id: string; nom: string }[];
  chutes: { id: string; nom: string; avant: number; apres: number }[];
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Charge les dossiers (agences rattachées résolues vers leur client). */
export async function loadDossiers(db: DB): Promise<Dossier[]> {
  const al = await db.select().from(agenceAliases);
  const alias = new Map(al.map((a) => [a.idAgence, a.clientId]));
  const rows = await db
    .select({
      idAgence: dossiers.idAgence, idResa: dossiers.idResa, date: dossiers.date, statut: dossiers.statut,
      origine: dossiers.origine, total: dossiers.total, erreurResalive: dossiers.erreurResalive,
      canal: dossiers.canal, idProduit: dossiers.idProduit, montantOptions: dossiers.montantOptions, montantAssurance: dossiers.montantAssurance,
      emailRenseigne: dossiers.emailRenseigne, payeEnLigne: dossiers.payeEnLigne,
    })
    .from(dossiers);
  return rows.map((d) => ({ ...d, idAgence: alias.get(d.idAgence) ?? d.idAgence, origine: d.origine ?? "" }));
}

/**
 * Recalcule indicateurs, scores santé, alertes et opportunités de tout le portefeuille,
 * puis renvoie les changements par rapport au calcul précédent.
 */
export async function recomputeAll(db: DB, importId: number | null = null): Promise<RecomputeDiff> {
  const params = await getMetricsParams(db);
  const all = await loadDossiers(db);
  // Les comptes « hors export » (site fourni sans dossiers) ne sont pas notés tant qu'ils n'ont aucun dossier
  const avecDossiers = new Set(all.map((d) => d.idAgence));
  const cl = (await db.select().from(clients).where(eq(clients.actif, true))).filter((c) => !c.horsExport || avecDossiers.has(c.id));
  const { reference, metrics } = computePortfolio(
    cl.map((c) => ({ id: c.id, vaGlobalEstime: c.vaGlobalEstime })),
    all,
    params,
  );
  await ajouterAlertesAudit(db, metrics, params.alertes.baisseMaturitePoints);
  await ajouterAlertesComptes(db, metrics, cl);
  if (reference) await ajouterTrafic(db, metrics, all, reference, params);
  const nom = new Map(cl.map((c) => [c.id, c.nom]));
  const before = new Map((await db.select().from(clientSnapshots)).map((s) => [s.clientId, s]));
  const diff: RecomputeDiff = { reference, nouveauxCritiques: [], reprises: [], chutes: [] };
  if (!reference) return diff;

  for (const m of metrics) {
    const b = before.get(m.id);
    if (!b) continue;
    if (m.risque === "Critique" && b.risque !== "Critique") diff.nouveauxCritiques.push({ id: m.id, nom: nom.get(m.id)!, alerte: m.alerte_principale });
    if (b.risque === "Critique" && m.risque !== "Critique") diff.reprises.push({ id: m.id, nom: nom.get(m.id)! });
    if (b.sante - m.sante >= 10) diff.chutes.push({ id: m.id, nom: nom.get(m.id)!, avant: b.sante, apres: m.sante });
  }

  // Instantanés (on retire ceux des comptes qui ne sont plus calculés)
  const calcules = metrics.map((m) => m.id);
  if (calcules.length) await db.delete(clientSnapshots).where(notInArray(clientSnapshots.clientId, calcules));
  for (const part of chunk(metrics, 200)) {
    await db
      .insert(clientSnapshots)
      .values(part.map((m) => ({
        clientId: m.id, reference, importId, sante: m.sante, segment: m.segment, risque: m.risque, usage: m.usage,
        data: m as unknown as Record<string, unknown>, calculeLe: new Date(),
      })))
      .onConflictDoUpdate({
        target: clientSnapshots.clientId,
        set: {
          reference: sql`excluded.reference`, importId: sql`excluded.import_id`, sante: sql`excluded.sante`,
          segment: sql`excluded.segment`, risque: sql`excluded.risque`, usage: sql`excluded.usage`,
          data: sql`excluded.data`, calculeLe: sql`excluded.calcule_le`,
        },
      });
  }

  // Séries mensuelles (le trafic `visites` est conservé)
  const byClient = new Map<string, Dossier[]>();
  for (const d of all) {
    let a = byClient.get(d.idAgence);
    if (!a) byClient.set(d.idAgence, (a = []));
    a.push(d);
  }
  const ids = new Set(cl.map((c) => c.id));
  const series = [...byClient].filter(([id]) => ids.has(id)).flatMap(([clientId, rows]) =>
    monthlySeries(rows, params).map((s) => ({ clientId, mois: s.mois, volume: s.volume, confirme: s.confirme, dossiers: s.dossiers })));
  await db.update(metriquesClientMensuelles).set({ volume: 0, confirme: 0, dossiers: 0 });
  for (const part of chunk(series, 1000)) {
    await db.insert(metriquesClientMensuelles).values(part).onConflictDoUpdate({
      target: [metriquesClientMensuelles.clientId, metriquesClientMensuelles.mois],
      set: { volume: sql`excluded.volume`, confirme: sql`excluded.confirme`, dossiers: sql`excluded.dossiers` },
    });
  }

  await syncAlertes(db, metrics, importId);
  return diff;
}

/** Ouvre les nouvelles alertes « données » et clôt celles qui ne s'appliquent plus. */
async function syncAlertes(db: DB, metrics: ClientMetrics[], importId: number | null) {
  const open = await db.select().from(alertes).where(and(isNull(alertes.closeLe), inArray(alertes.source, ["donnees", "audit", "scan"])));
  const openKey = new Map(open.map((a) => [`${a.clientId}|${a.code}`, a]));
  const current = new Set<string>();
  const toInsert: (typeof alertes.$inferInsert)[] = [];
  for (const m of metrics) {
    for (const a of m.alertes) {
      const k = `${m.id}|${a.code}`;
      current.add(k);
      const o = openKey.get(k);
      if (!o) toInsert.push({ clientId: m.id, code: a.code, niveau: a.niveau, message: a.message, importId, source: a.code === "legal_non" || a.code === "baisse_maturite" ? "audit" : a.code === "module_absent" || a.code === "site_indisponible" || a.code === "fiche_google_fermee" ? "scan" : "donnees" });
      else if (o.message !== a.message || o.niveau !== a.niveau)
        await db.update(alertes).set({ message: a.message, niveau: a.niveau }).where(eq(alertes.id, o.id));
    }
  }
  for (const part of chunk(toInsert, 500)) await db.insert(alertes).values(part);
  const toClose = open.filter((a) => !current.has(`${a.clientId}|${a.code}`));
  for (const a of toClose) await db.update(alertes).set({ closeLe: new Date() }).where(eq(alertes.id, a.id));
}

/**
 * Alertes « À surveiller » issues de l'audit (§ 4) : critère légal à NON au dernier audit finalisé,
 * score de maturité en baisse de plus de N points entre les deux derniers audits finalisés.
 */
async function ajouterAlertesAudit(db: DB, metrics: ClientMetrics[], baissePoints: number) {
  const list = await db.select({ clientId: audits.clientId, score: audits.score }).from(audits)
    .where(eq(audits.statut, "finalise")).orderBy(desc(audits.date), desc(audits.id));
  const par = new Map<string, { score: number | null; legauxNon: string[] }[]>();
  for (const a of list) {
    const arr = par.get(a.clientId) ?? [];
    const s = a.score as { score: number | null; legauxNon?: string[] } | null;
    if (arr.length < 2) arr.push({ score: s?.score ?? null, legauxNon: s?.legauxNon ?? [] });
    par.set(a.clientId, arr);
  }
  // TECH-06 (dernier scan terminé) : module SpeedResa absent ou concurrent détecté = alerte rouge
  const scans = await db.select({ clientId: scanRuns.clientId, statut: scanResults.statutPropose, confiance: scanResults.confiance, texte: scanResults.texte })
    .from(scanResults).innerJoin(scanRuns, eq(scanRuns.id, scanResults.scanRunId))
    .where(and(eq(scanResults.critereId, "TECH-06"), eq(scanRuns.statut, "termine"))).orderBy(desc(scanRuns.fin));
  const tech06 = new Map<string, (typeof scans)[number]>();
  for (const s of scans) if (!tech06.has(s.clientId)) tech06.set(s.clientId, s);

  // Monitoring : site inaccessible depuis au moins une heure = alerte rouge
  const pannes = await sitesEnPanne(db);

  for (const m of metrics) {
    const p = pannes.get(m.id);
    if (p) {
      m.alertes.unshift({ niveau: "critique", code: "site_indisponible", message: `Site inaccessible depuis le ${p.depuis.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}${p.erreur ? ` (${p.erreur})` : ""}` });
      m.risque = "Critique";
    }
    const t = tech06.get(m.id);
    // Confiance basse (contrôle sans navigateur) : pas d'alerte, pour éviter les fausses alarmes
    if (t?.statut === "NON" && t.confiance !== "basse") {
      m.alertes.unshift({ niveau: "critique", code: "module_absent", message: /concurrente/i.test(t.texte ?? "") ? (t.texte ?? "Solution concurrente détectée") : "Module SpeedResa non détecté sur le site" });
      m.risque = "Critique";
    }
    const [dernier, precedent] = par.get(m.id) ?? [];
    if (!dernier) { m.alerte_principale = m.alertes[0]?.message ?? ""; continue; }
    if (dernier.legauxNon.length)
      m.alertes.push({ niveau: "surveiller", code: "legal_non", message: `Critère légal à NON au dernier audit : ${dernier.legauxNon.join(", ")}` });
    if (precedent && dernier.score !== null && precedent.score !== null && precedent.score - dernier.score > baissePoints)
      m.alertes.push({ niveau: "surveiller", code: "baisse_maturite", message: `Score de maturité en baisse de ${Math.round(precedent.score - dernier.score)} points entre les deux derniers audits` });
    m.alertes.sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === "critique" ? -1 : 1));
    m.alerte_principale = m.alertes[0]?.message ?? "";
    if (m.risque === "Sain" && m.alertes.length) m.risque = "À surveiller";
  }
}

/**
 * Alertes de compte (§ 4 et retours du 22/10) : échéance de contrat à moins de 90 jours sans rendez-vous planifié,
 * aucune connexion au back-office depuis 30 jours (exports configuration / connexions), fiche Google fermée.
 */
async function ajouterAlertesComptes(db: DB, metrics: ClientMetrics[], cl: (typeof clients.$inferSelect)[]) {
  const [configs, cnx, rdvs] = await Promise.all([
    configsParClient(db), derniereConnexionParClient(db),
    db.select({ clientId: rdv.clientId }).from(rdv).where(gte(rdv.date, new Date())),
  ]);
  const avecRdv = new Set(rdvs.map((r) => r.clientId));
  const parId = new Map(cl.map((c) => [c.id, c]));
  const auj = Date.now();
  const jours = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - auj) / 86400_000);
  const fr = (iso: string) => iso.split("-").reverse().join("/");
  for (const m of metrics) {
    const c = parId.get(m.id);
    const conf = configs.get(m.id);
    const fin = conf?.dateFinContrat ?? c?.echeanceContrat ?? null;
    if (fin) {
      const j = jours(fin);
      if (j >= 0 && j <= 90 && !avecRdv.has(m.id)) m.alertes.unshift({ niveau: "critique", code: "contrat_echeance", message: `Fin de contrat le ${fr(fin)} (dans ${j} jours) sans rendez-vous planifié` });
    }
    // Connexions : export connexions en priorité, sinon colonnes de la configuration
    const derniere = [cnx.get(m.id), conf?.derniereConnexionBo ?? null].filter((x): x is string => !!x).sort().at(-1) ?? null;
    const sansConnexion = derniere ? jours(derniere) < -30 : !!conf && !((conf.connexions30j ?? 0) > 0);
    if (sansConnexion)
      m.alertes.unshift({ niveau: "critique", code: "sans_connexion_bo", message: derniere ? `Aucune connexion au back-office depuis le ${fr(derniere)}` : "Aucune connexion au back-office depuis 30 jours" });
    if (c?.googleStatut === "CLOSED_PERMANENTLY") m.alertes.unshift({ niveau: "critique", code: "fiche_google_fermee", message: "Fiche Google indiquée « définitivement fermé »" });
    else if (c?.googleStatut === "CLOSED_TEMPORARILY") m.alertes.push({ niveau: "surveiller", code: "fiche_google_fermee", message: "Fiche Google indiquée « temporairement fermé »" });
    if (m.alertes.some((a) => a.niveau === "critique")) m.risque = "Critique";
    else if (m.risque === "Sain" && m.alertes.length) m.risque = "À surveiller";
    m.alertes.sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === "critique" ? -1 : 1));
    m.alerte_principale = m.alertes[0]?.message ?? "";
  }
}

/** Trafic et conversion (visites importées × dossiers), puis manque à gagner par rapport aux Champions. */
async function ajouterTrafic(db: DB, metrics: ClientMetrics[], all: Dossier[], reference: string, params: MetricsParams) {
  const t = metriquesClientMensuelles;
  const v = await db.select({ clientId: t.clientId, mois: t.mois, visites: t.visites, debuts: t.debutsReservation, achats: t.achatsWeb, ca: t.caWeb, source: t.sourceTrafic })
    .from(t).where(sql`${t.visites} is not null`);
  if (!v.length) return;
  const visites = new Map<string, Map<string, number>>();
  const web = new Map<string, Map<string, MoisWeb>>();
  for (const r of v) {
    const m = visites.get(r.clientId) ?? new Map<string, number>(); m.set(r.mois, r.visites!); visites.set(r.clientId, m);
    if (r.source === "ga4") { const w = web.get(r.clientId) ?? new Map<string, MoisWeb>(); w.set(r.mois, { debuts: r.debuts, achats: r.achats, ca: r.ca }); web.set(r.clientId, w); }
  }
  const parClient = new Map<string, Dossier[]>();
  for (const d of all) { const a = parClient.get(d.idAgence) ?? []; a.push(d); parClient.set(d.idAgence, a); }
  const lignes = metrics.filter((m) => visites.has(m.id)).map((m) => ({ m, segment: m.segment, trafic: traficClient(m, parClient.get(m.id) ?? [], visites.get(m.id)!, reference, params, web.get(m.id)) }));
  manqueAGagner(lignes);
  for (const l of lignes) Object.assign(l.m, l.trafic);
}
