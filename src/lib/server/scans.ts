import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { actions, audits, clients, clientUrls, dossiers, evaluations, scanCaptures, scanResults, scanRuns } from "@/db/schema";
import { DEFAULT_METRICS_PARAMS } from "@/lib/metrics/params";
import type { ScanDonnees } from "@/scan/types";
import { statsDisponibilite } from "./disponibilite";
import { executerDetecteurs } from "@/scan/runner";
import { DETECTEURS, DETECTEURS_LEGERS } from "@/scan/registry";
import { verifierUrl } from "@/scan/fetcher";
import { AuditError, createAudit, loadCriteres } from "./audits";
import { recomputeAll } from "./recompute";
import { logActivity } from "./activity";

/** Crée un pré-audit : audit en cours (ouvert ou créé) + scan en file d'attente. */
export async function creerScan(db: DB, clientId: string, url: string, userId: number | null, type: "complet" | "leger" | "verification" = "complet", criteresVerif: string[] = []) {
  const urls = (await db.select().from(clientUrls).where(eq(clientUrls.clientId, clientId))).map((u) => u.url);
  // Scan uniquement sur les domaines du référentiel client
  if (!urls.includes(url)) throw new AuditError("Cette URL n'est pas enregistrée pour ce client.", 403);
  try { await verifierUrl(url); } catch (e) { throw new AuditError(e instanceof Error ? e.message : "URL refusée", 400); }
  const enCours = await db.select({ id: scanRuns.id }).from(scanRuns)
    .where(and(eq(scanRuns.clientId, clientId), sql`${scanRuns.statut} in ('en_attente','en_cours')`, gt(scanRuns.createdAt, new Date(Date.now() - 15 * 60_000))));
  if (enCours.length && type !== "verification") return { id: enCours[0].id, existant: true };
  const audit = type === "complet" ? await createAudit(db, clientId, userId ?? 0) : null;
  const ids = type === "complet" ? DETECTEURS.map((d) => d.critereId) : type === "leger" ? DETECTEURS_LEGERS : criteresVerif.filter((id) => DETECTEURS.some((d) => d.critereId === id));
  if (!ids.length) throw new AuditError("Aucun contrôle automatique pour ce critère.", 400);
  const [run] = await db.insert(scanRuns).values({ clientId, auditId: audit?.id ?? null, url, demandePar: userId, type, statut: "en_attente" }).returning();
  await db.insert(scanResults).values(ids.map((critereId) => ({ scanRunId: run.id, critereId, etat: "en_attente" })));
  if (audit) await db.update(audits).set({ urlAuditee: url }).where(eq(audits.id, audit.id));
  return { id: run.id, existant: false };
}

/** Réserve atomiquement le prochain scan en attente (worker). */
export async function reserverProchainScan(db: DB): Promise<number | null> {
  const r = await db.execute<{ id: number }>(sql`
    update scan_runs set statut = 'en_cours', debut = now()
    where id = (select id from scan_runs where statut = 'en_attente' order by id limit 1 for update skip locked)
    returning id`);
  const rows = ((r as unknown as { rows?: { id: number }[] }).rows ?? (r as unknown as { id: number }[]));
  return rows[0]?.id ?? null;
}

/** Exécute un scan et reporte les résultats dans l'audit sous forme de propositions. */
export async function executerScan(db: DB, runId: number, opts: { dejaReserve?: boolean } = {}) {
  if (!opts.dejaReserve) {
    const [pris] = await db.update(scanRuns).set({ statut: "en_cours", debut: new Date() })
      .where(and(eq(scanRuns.id, runId), eq(scanRuns.statut, "en_attente"))).returning();
    if (!pris) return;
  }
  const [run] = await db.select().from(scanRuns).where(eq(scanRuns.id, runId));
  const ids = (await db.select({ c: scanResults.critereId }).from(scanResults).where(eq(scanResults.scanRunId, runId))).map((x) => x.c);
  const detecteurs = DETECTEURS.filter((d) => ids.includes(d.critereId));

  let sortie;
  try {
    sortie = await executerDetecteurs(run.url, {
      detecteurs,
      donnees: await donneesScan(db, run.clientId),
      onProgress: async (p) => {
        await db.update(scanResults).set({
          etat: p.etat,
          statutPropose: p.resultat?.statut ?? null,
          valeur: p.resultat?.valeur === undefined || p.resultat?.valeur === null ? null : String(p.resultat.valeur),
          texte: p.resultat?.texte ?? null,
          preuve: p.resultat?.preuve ?? null,
          confiance: p.resultat?.confiance ?? null,
          dureeMs: p.dureeMs ?? null,
        }).where(and(eq(scanResults.scanRunId, runId), eq(scanResults.critereId, p.critereId)));
      },
    });
  } catch (e) {
    await db.update(scanRuns).set({ statut: "erreur", fin: new Date(), message: e instanceof Error ? e.message : "Erreur" }).where(eq(scanRuns.id, runId));
    return;
  }

  for (const c of sortie.captures) await db.insert(scanCaptures).values({ scanRunId: runId, nom: c.nom, data: c.data });
  const captures = new Map((await db.select({ id: scanCaptures.id, nom: scanCaptures.nom }).from(scanCaptures).where(eq(scanCaptures.scanRunId, runId))).map((c) => [c.nom, c.id]));

  // Propositions dans l'audit (sans jamais écraser une réponse déjà validée)
  if (run.auditId) {
    const cs = await loadCriteres(db);
    const existantes = new Map((await db.select().from(evaluations).where(eq(evaluations.auditId, run.auditId))).map((e) => [e.critereId, e]));
    for (const [critereId, r] of sortie.resultats) {
      const c = cs.find((x) => x.id === critereId);
      if (!c) continue;
      const preuve = { ...r.preuve, captureId: r.preuve.capture ? captures.get(r.preuve.capture) ?? null : null, scanRunId: runId };
      const proposition = { statut: r.statut, valeur: r.valeur ?? null, texte: r.texte, confiance: r.confiance, source: "scan", preuve };
      const valeur = r.valeur === undefined || r.valeur === null ? null : String(r.valeur);
      const e = existantes.get(critereId);
      if (e) {
        await db.update(evaluations).set({ proposition, preuve, confiance: r.confiance, ...(e.statut === null ? { valeur, source: "auto" } : {}) }).where(eq(evaluations.id, e.id));
      } else {
        await db.insert(evaluations).values({ auditId: run.auditId, critereId, critereVersion: c.version, statut: null, valeur, source: "auto", confiance: r.confiance, proposition, preuve });
      }
    }
  }
  await db.update(scanRuns).set({ statut: sortie.statut, mode: sortie.mode, message: sortie.message, fin: new Date() }).where(eq(scanRuns.id, runId));
  // Re-vérification d'une action « faite » : résultat reporté sur l'action
  for (const [critereId, r] of sortie.resultats) {
    await db.update(actions).set({ verifStatut: r.statut ?? "non_verifiable", verifTexte: r.texte, verifLe: new Date() })
      .where(and(eq(actions.verifScanId, runId), eq(actions.critereId, critereId)));
  }
  await logActivity(run.demandePar, "scan_termine", "scan", String(runId), { clientId: run.clientId, statut: sortie.statut, mode: sortie.mode });
  // TECH-06 alimente les alertes de départ (rescan mensuel : recalcul une seule fois en fin de campagne)
  if (sortie.resultats.has("TECH-06") && run.type !== "leger") await recomputeAll(db).catch(() => null);
}

/** Top ventes sur 12 mois : noms de voyages les plus réservés (dossiers confirmés d'abord). */
export async function topVentes(db: DB, clientId: string, n = 5) {
  const depuis = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const base = and(eq(dossiers.idAgence, clientId), gte(dossiers.date, depuis), isNotNull(dossiers.voyage), sql`trim(${dossiers.voyage}) <> ''`);
  const requete = (filtre: ReturnType<typeof and>) => db.select({ voyage: dossiers.voyage, nb: sql<number>`count(*)::int` })
    .from(dossiers).where(filtre).groupBy(dossiers.voyage).orderBy(sql`count(*) desc`).limit(n);
  let rows = await requete(and(base, inArray(dossiers.statut, DEFAULT_METRICS_PARAMS.statutsConfirmes)));
  if (rows.length < n) {
    const autres = (await requete(base)).filter((r) => !rows.some((x) => x.voyage === r.voyage));
    rows = [...rows, ...autres].slice(0, n);
  }
  return rows.map((r) => ({ voyage: r.voyage!, nb: r.nb }));
}

/** Données de l'application utiles au moteur de scan (qui reste indépendant de la base). */
async function donneesScan(db: DB, clientId: string): Promise<ScanDonnees> {
  const [c] = await db.select({ nom: clients.nom, placeId: clients.googlePlaceId }).from(clients).where(eq(clients.id, clientId));
  return {
    client: c ? { nom: c.nom, placeId: c.placeId } : undefined,
    topVentes: await topVentes(db, clientId),
    disponibilite: await statsDisponibilite(db, clientId),
    empreintes: await (await import("./parametres")).empreintes(db),
    // Fiche Google trouvée par le scan avec le même site web : enregistrée si aucune n'est encore validée
    onPlaceTrouvee: async (placeId) => {
      await db.update(clients).set({ googlePlaceId: placeId }).where(and(eq(clients.id, clientId), sql`${clients.googlePlaceId} is null`));
    },
  };
}

export async function etatScan(db: DB, runId: number) {
  const [run] = await db.select().from(scanRuns).where(eq(scanRuns.id, runId));
  if (!run) throw new AuditError("Scan introuvable", 404);
  // Un scan bloqué (fonction interrompue) est signalé au bout de 10 minutes
  if ((run.statut === "en_cours" || run.statut === "en_attente") && run.createdAt.getTime() < Date.now() - 10 * 60_000) {
    await db.update(scanRuns).set({ statut: "erreur", message: "Scan interrompu (délai dépassé).", fin: new Date() }).where(eq(scanRuns.id, runId));
    run.statut = "erreur";
    run.message = "Scan interrompu (délai dépassé).";
  }
  const resultats = await db.select().from(scanResults).where(eq(scanResults.scanRunId, runId)).orderBy(asc(scanResults.id));
  const captures = await db.select({ id: scanCaptures.id, nom: scanCaptures.nom }).from(scanCaptures).where(eq(scanCaptures.scanRunId, runId));
  return { run, resultats, captures };
}

/** Dernier résultat TECH-06 fiable de chaque client (alertes churn). */
export async function dernierTech06(db: DB) {
  const rows = await db.select({ clientId: scanRuns.clientId, statut: scanResults.statutPropose, confiance: scanResults.confiance, texte: scanResults.texte, fin: scanRuns.fin })
    .from(scanResults).innerJoin(scanRuns, eq(scanRuns.id, scanResults.scanRunId))
    .where(and(eq(scanResults.critereId, "TECH-06"), sql`${scanRuns.statut} = 'termine'`))
    .orderBy(desc(scanRuns.fin));
  const par = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!par.has(r.clientId)) par.set(r.clientId, r);
  return par;
}

export async function scansRecents(db: DB, userId: number, depuis: Date) {
  return db.select({ id: scanRuns.id, clientId: scanRuns.clientId, statut: scanRuns.statut, fin: scanRuns.fin, auditId: scanRuns.auditId })
    .from(scanRuns).where(and(eq(scanRuns.demandePar, userId), gt(scanRuns.fin, depuis), lt(scanRuns.fin, new Date(Date.now() + 1000))));
}

// ───────────────────────── Scans planifiés ─────────────────────────

/**
 * Rescan léger mensuel (cookies, mentions légales, module SpeedResa, certificat, PageSpeed)
 * de tous les clients actifs ayant un site : les scans sont mis en file.
 */
export async function planifierRescanMensuel(db: DB) {
  const sites = await db.select({ clientId: clientUrls.clientId, url: clientUrls.url }).from(clientUrls)
    .innerJoin(clients, eq(clients.id, clientUrls.clientId)).where(and(eq(clientUrls.principale, true), eq(clients.actif, true)));
  let crees = 0, ignores = 0;
  for (const s of sites) {
    try { const r = await creerScan(db, s.clientId, s.url, null, "leger"); if (r.existant) ignores++; else crees++; }
    catch { ignores++; }
  }
  return { crees, ignores };
}

/** Exécute les scans en attente dans la limite de temps donnée (sans worker : tâche planifiée quotidienne). */
export async function traiterFileScans(db: DB, budgetMs: number) {
  const fin = Date.now() + budgetMs;
  let faits = 0, legers = 0;
  while (Date.now() < fin - 60_000) {
    const id = await reserverProchainScan(db);
    if (id === null) break;
    const [run] = await db.select({ type: scanRuns.type }).from(scanRuns).where(eq(scanRuns.id, id));
    await executerScan(db, id, { dejaReserve: true }).catch(() => null);
    faits++;
    if (run?.type === "leger") legers++;
  }
  if (legers) await recomputeAll(db).catch(() => null);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(scanRuns).where(eq(scanRuns.statut, "en_attente"));
  return { faits, restants: n };
}

export async function etatCampagnes(db: DB) {
  const rows = await db.select({ statut: scanRuns.statut, n: sql<number>`count(*)::int`, dernier: sql<string>`max(${scanRuns.createdAt})` })
    .from(scanRuns).where(and(eq(scanRuns.type, "leger"), gt(scanRuns.createdAt, new Date(Date.now() - 40 * 86_400_000)))).groupBy(scanRuns.statut);
  return rows;
}
