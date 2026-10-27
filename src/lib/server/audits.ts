import { and, asc, desc, eq, gt, inArray, lt, ne, or } from "drizzle-orm";
import type { DB } from "@/db";
import {
  auditPresence, audits, clients, clientSnapshots, clientUrls, criteres, evaluationHistorique, evaluations, parametres, users,
} from "@/db/schema";
import { compareCriteres, computeScore, statutFromSeuil, STATUTS, type CritereScore, type EvalScore, type ScoreResult, type Statut } from "@/lib/audit/score";
import { propositionsDonnees } from "@/lib/audit/donnees";
import { propositionsBackoffice } from "@/lib/audit/backoffice";
import { entreeBackoffice } from "./backoffice";
import { commentaireRequis } from "@/lib/audit/regles";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { getMetricsParams, loadDossiers } from "./recompute";
import auditsV1 from "../../../data/kit/audits_v1.json";

export type Critere = typeof criteres.$inferSelect;
export type Evaluation = typeof evaluations.$inferSelect;
export type Audit = typeof audits.$inferSelect;

export class AuditError extends Error {
  constructor(message: string, public status = 400, public data?: unknown) { super(message); }
}

/**
 * Critères actifs, dernière version de chacun, dans l'ordre du référentiel.
 * Les critères marqués « Plateforme » (lot E : résultat produit par les gabarits SpeedResa, pas par le client)
 * restent affichés mais ne comptent plus : points ramenés à 0, donc ni dans le score ni dans le plan d'action.
 */
export async function loadCriteres(db: DB): Promise<(Critere & { plateforme?: boolean })[]> {
  const all = await db.select().from(criteres).orderBy(asc(criteres.id), desc(criteres.version));
  const seen = new Set<string>();
  const latest = all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, "criteres_plateforme"));
  const plateforme = new Set((p?.valeur as string[] | undefined) ?? []);
  return latest.filter((c) => c.actif).sort(compareCriteres).map((c) => (plateforme.has(c.id) ? { ...c, points: 0, plateforme: true } : c));
}

export const toCritereScore = (c: Critere): CritereScore => ({
  id: c.id, pilier: c.pilier, points: c.points, type: c.type, sens: c.sens,
  seuilPlein: c.seuilPlein, seuilMoitie: c.seuilMoitie, obligationLegale: c.obligationLegale,
});

export function scoreAudit(cs: Critere[], evals: Pick<Evaluation, "critereId" | "statut">[]): ScoreResult {
  const m = new Map<string, EvalScore>(evals.map((e) => [e.critereId, { statut: (e.statut as Statut) ?? null }]));
  return computeScore(cs.map(toCritereScore), m);
}

export async function refreshScore(db: DB, auditId: number) {
  const cs = await loadCriteres(db);
  const evs = await db.select({ critereId: evaluations.critereId, statut: evaluations.statut }).from(evaluations).where(eq(evaluations.auditId, auditId));
  const score = scoreAudit(cs, evs);
  await db.update(audits).set({ score, updatedAt: new Date() }).where(eq(audits.id, auditId));
  return score;
}

// ───────────────────────── Création ─────────────────────────

/** Ouvre le brouillon en cours du client, ou en crée un nouveau pré-rempli avec les données SpeedResa. */
export async function createAudit(db: DB, clientId: string, userId: number): Promise<{ id: number; existant: boolean }> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new AuditError("Client introuvable", 404);
  const [brouillon] = await db.select().from(audits).where(and(eq(audits.clientId, clientId), eq(audits.statut, "brouillon"))).limit(1);
  if (brouillon) {
    // Données rafraîchies à chaque ouverture (nouvel export, trafic GA4) sans toucher aux réponses déjà données
    await appliquerDonneesAudit(db, brouillon.id, clientId);
    return { id: brouillon.id, existant: true };
  }

  const [url] = await db.select().from(clientUrls).where(eq(clientUrls.clientId, clientId)).orderBy(desc(clientUrls.principale)).limit(1);
  const [audit] = await db.insert(audits).values({
    clientId, date: new Date().toISOString().slice(0, 10), statut: "brouillon", auteurId: userId, assigneA: userId, urlAuditee: url?.url ?? null,
  }).returning();
  await appliquerDonneesAudit(db, audit.id, clientId);
  return { id: audit.id, existant: false };
}

/**
 * Propositions « Données Speedmedia » (export dossiers, trafic, exports back-office) dans un brouillon.
 * Une réponse déjà donnée (statut) ou une proposition du scan n'est jamais écrasée, sauf par une donnée
 * en confiance haute sur un critère encore sans réponse. Les critères en attente d'un export reçoivent la mention.
 */
export async function appliquerDonneesAudit(db: DB, auditId: number, clientId: string) {
  const { propositions, attentes } = await donneesAuditClient(db, clientId);
  const cs = await loadCriteres(db);
  const version = new Map(cs.map((c) => [c.id, c.version]));
  const existantes = new Map((await db.select().from(evaluations).where(eq(evaluations.auditId, auditId))).map((e) => [e.critereId, e]));
  for (const p of propositions) {
    if (!version.has(p.critereId)) continue;
    const e = existantes.get(p.critereId);
    const valeur = p.valeur === null ? null : String(p.valeur);
    const vals = { proposition: p, preuve: p.preuve, confiance: p.confiance, valeur, source: "donnees" as const };
    if (!e) await db.insert(evaluations).values({ auditId, critereId: p.critereId, critereVersion: version.get(p.critereId)!, statut: null, ...vals });
    else if (e.statut === null && !e.aEnvoyerClient) {
      const prop = e.proposition as { source?: string; statut?: string | null } | null;
      const remplacer = !prop || prop.source === "donnees" || e.source === "donnees" || (p.statut !== null && p.confiance === "haute");
      if (remplacer) await db.update(evaluations).set(vals).where(eq(evaluations.id, e.id));
    }
  }
  for (const a of attentes) {
    if (!version.has(a.critereId)) continue;
    const e = existantes.get(a.critereId);
    const preuve = { texte: a.texte, source: "Exports back-office SpeedResa" };
    if (!e) await db.insert(evaluations).values({ auditId, critereId: a.critereId, critereVersion: version.get(a.critereId)!, statut: null, valeur: null, source: null, preuve });
    else if (e.statut === null && !e.proposition) await db.update(evaluations).set({ preuve }).where(eq(evaluations.id, e.id));
  }
  await refreshScore(db, auditId);
}

/** Critères « Données Speedmedia » d'un client : export dossiers, trafic, exports back-office. */
export async function donneesAuditClient(db: DB, clientId: string) {
  const [snap] = await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, clientId));
  const [ref] = snap ? [snap] : await db.select().from(clientSnapshots).limit(1);
  const cs = await loadCriteres(db);
  const map = new Map(cs.map((c) => [c.id, toCritereScore(c)]));
  const params = await getMetricsParams(db);
  const rows = (await loadDossiers(db)).filter((d) => d.idAgence === clientId);
  const m = (snap?.data as ClientMetrics | undefined) ?? null;
  // Sans aucun export dossiers importé, rien n'est calculable sur les dossiers
  const propositions = ref ? propositionsDonnees(m, rows, ref.reference, map, params) : [];
  const bo = propositionsBackoffice({ ...(await entreeBackoffice(db, clientId, m, rows)), params }, map);
  for (const p of bo.propositions) if (!propositions.some((x) => x.critereId === p.critereId)) propositions.push(p);
  return { propositions, attentes: bo.attentes.filter((a) => !propositions.some((p) => p.critereId === a.critereId)) };
}

/** Propositions « Données Speedmedia » recalculées (vérification des actions du plan). */
export async function propositionsDonneesClient(db: DB, clientId: string) {
  return (await donneesAuditClient(db, clientId)).propositions;
}

// ───────────────────────── Lecture ─────────────────────────

export async function getAuditState(db: DB, auditId: number) {
  const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
  if (!audit) throw new AuditError("Audit introuvable", 404);
  const [[client], cs, evs, us] = await Promise.all([
    db.select().from(clients).where(eq(clients.id, audit.clientId)),
    loadCriteres(db),
    db.select().from(evaluations).where(eq(evaluations.auditId, auditId)),
    db.select({ id: users.id, nom: users.nom, email: users.email, role: users.role, actif: users.actif }).from(users),
  ]);
  // Audit précédent : le plus récent audit finalisé du client avant celui-ci
  const [precedent] = await db.select().from(audits)
    .where(and(eq(audits.clientId, audit.clientId), eq(audits.statut, "finalise"), ne(audits.id, auditId),
      or(lt(audits.date, audit.date), and(eq(audits.date, audit.date), lt(audits.id, auditId)))))
    .orderBy(desc(audits.date), desc(audits.id)).limit(1);
  const evsPrec = precedent ? await db.select().from(evaluations).where(eq(evaluations.auditId, precedent.id)) : [];
  return { audit, client, criteres: cs, evaluations: evs, precedent: precedent ? { audit: precedent, evaluations: evsPrec } : null, users: us };
}

// ───────────────────────── Enregistrement ─────────────────────────

export interface SaveInput {
  critereId: string;
  statut: Statut | null;
  valeur: number | null;
  commentaire: string | null;
  aEnvoyerClient: boolean;
  /** updatedAt de l'évaluation telle que l'utilisateur l'a vue (détection des modifications concurrentes) */
  base: string | null;
  force?: boolean;
}

export async function saveEvaluation(db: DB, auditId: number, userId: number, input: SaveInput) {
  const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
  if (!audit) throw new AuditError("Audit introuvable", 404);
  if (audit.statut !== "brouillon") throw new AuditError("Cet audit est finalisé : rouvrez-le pour le modifier.", 409);
  if (input.statut !== null && !STATUTS.includes(input.statut)) throw new AuditError("Statut inconnu");
  const cs = await loadCriteres(db);
  const c = cs.find((x) => x.id === input.critereId);
  if (!c) throw new AuditError("Critère inconnu");

  const [existing] = await db.select().from(evaluations).where(and(eq(evaluations.auditId, auditId), eq(evaluations.critereId, c.id)));
  // Modification concurrente : quelqu'un d'autre a enregistré ce critère depuis que l'utilisateur l'a affiché
  if (existing && !input.force && existing.auteurId && existing.auteurId !== userId && existing.statut !== null) {
    const vu = input.base ? new Date(input.base).getTime() : 0;
    if (existing.updatedAt.getTime() > vu + 1) {
      const [auteur] = await db.select({ nom: users.nom, email: users.email }).from(users).where(eq(users.id, existing.auteurId));
      throw new AuditError(`${auteur?.nom || auteur?.email || "Un collègue"} vient de modifier ce critère.`, 409, { evaluation: existing });
    }
  }
  const prop = (existing?.proposition as { statut: Statut | null } | null) ?? null;
  const commentaire = input.commentaire?.trim() || null;
  const requis = commentaireRequis(c, input, prop);
  if (requis && !commentaire) throw new AuditError(requis, 422);

  const source = existing?.source && existing.statut === null && prop?.statut === input.statut ? existing.source : "csm";
  const values = {
    statut: input.statut,
    valeur: input.valeur === null ? (existing?.valeur ?? null) : String(input.valeur),
    commentaire,
    aEnvoyerClient: input.aEnvoyerClient,
    source: input.statut === null ? existing?.source ?? null : source,
    auteurId: userId,
    critereVersion: c.version,
    updatedAt: new Date(),
  };
  const [saved] = existing
    ? await db.update(evaluations).set(values).where(eq(evaluations.id, existing.id)).returning()
    : await db.insert(evaluations).values({ auditId, critereId: c.id, ...values }).returning();
  await db.insert(evaluationHistorique).values({
    auditId, critereId: c.id, statut: saved.statut, valeur: saved.valeur, commentaire: saved.commentaire, aEnvoyerClient: saved.aEnvoyerClient, auteurId: userId,
  });
  const score = await refreshScore(db, auditId);
  return { evaluation: saved, score };
}

/** Valide en un clic les résultats automatiques à confiance haute. */
export async function validerPropositions(db: DB, auditId: number, userId: number) {
  const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
  if (!audit || audit.statut !== "brouillon") throw new AuditError("Audit introuvable ou finalisé", 409);
  const evs = await db.select().from(evaluations).where(eq(evaluations.auditId, auditId));
  const sures = evs.filter((e) => e.statut === null && e.confiance === "haute" && (e.proposition as { statut: Statut | null } | null)?.statut);
  for (const e of sures) {
    const statut = (e.proposition as { statut: Statut }).statut;
    await db.update(evaluations).set({ statut, auteurId: userId, updatedAt: new Date() }).where(eq(evaluations.id, e.id));
    await db.insert(evaluationHistorique).values({ auditId, critereId: e.critereId, statut, valeur: e.valeur, auteurId: userId, commentaire: "Résultat automatique validé" });
  }
  const score = await refreshScore(db, auditId);
  return { valides: sures.map((e) => e.critereId), score };
}

export async function finaliserAudit(db: DB, auditId: number) {
  const [a] = await db.update(audits).set({ statut: "finalise", finaliseLe: new Date(), updatedAt: new Date() })
    .where(and(eq(audits.id, auditId), eq(audits.statut, "brouillon"))).returning();
  if (!a) throw new AuditError("Audit introuvable ou déjà finalisé", 409);
  return a;
}

export async function rouvrirAudit(db: DB, auditId: number) {
  const [a] = await db.select().from(audits).where(eq(audits.id, auditId));
  if (!a) throw new AuditError("Audit introuvable", 404);
  const [autre] = await db.select({ id: audits.id }).from(audits).where(and(eq(audits.clientId, a.clientId), eq(audits.statut, "brouillon")));
  if (autre) throw new AuditError("Un autre audit est déjà en cours pour ce client.", 409);
  await db.update(audits).set({ statut: "brouillon", finaliseLe: null, updatedAt: new Date() }).where(eq(audits.id, auditId));
}

export async function confierAudit(db: DB, auditId: number, userId: number) {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.actif, true)));
  if (!u || u.role === "lecture") throw new AuditError("Ce collègue ne peut pas réaliser d'audit.");
  await db.update(audits).set({ assigneA: userId, updatedAt: new Date() }).where(eq(audits.id, auditId));
  return u;
}

// ───────────────────────── Présence (travail à plusieurs) ─────────────────────────

export async function heartbeat(db: DB, auditId: number, userId: number, critereId: string | null) {
  await db.insert(auditPresence).values({ auditId, userId, critereId, vuLe: new Date() })
    .onConflictDoUpdate({ target: [auditPresence.auditId, auditPresence.userId], set: { critereId, vuLe: new Date() } });
  const presents = await db.select({ userId: auditPresence.userId, critereId: auditPresence.critereId, nom: users.nom, email: users.email })
    .from(auditPresence).innerJoin(users, eq(users.id, auditPresence.userId))
    .where(and(eq(auditPresence.auditId, auditId), ne(auditPresence.userId, userId), gt(auditPresence.vuLe, new Date(Date.now() - 30_000))));
  return presents;
}

/** Évaluations modifiées depuis `depuis` (synchronisation entre collègues). */
export async function changesSince(db: DB, auditId: number, depuis: Date) {
  return db.select().from(evaluations).where(and(eq(evaluations.auditId, auditId), gt(evaluations.updatedAt, depuis)));
}

// ───────────────────────── Historique client ─────────────────────────

export async function auditsDuClient(db: DB, clientId: string) {
  return db.select().from(audits).where(eq(audits.clientId, clientId)).orderBy(desc(audits.date), desc(audits.id));
}

/** Dernier audit finalisé de chaque client (pour le portefeuille et les alertes). */
export async function derniersAuditsFinalises(db: DB) {
  const list = await db.select().from(audits).where(eq(audits.statut, "finalise")).orderBy(desc(audits.date), desc(audits.id));
  const par = new Map<string, Audit[]>();
  for (const a of list) {
    const arr = par.get(a.clientId) ?? [];
    if (arr.length < 2) arr.push(a);
    par.set(a.clientId, arr);
  }
  return par;
}

// ───────────────────────── Import des audits de l'ancienne grille ─────────────────────────

/** Importe les audits du fichier d'origine (onglet « 2. Grille de scoring ») si aucun audit n'existe. */
export async function importAuditsV1(db: DB) {
  const deja = await db.select({ id: audits.id }).from(audits).where(eq(audits.origine, "import_v1")).limit(1);
  if (deja.length) return 0;
  const cs = await loadCriteres(db);
  const ids = new Set((await db.select({ id: clients.id }).from(clients).where(inArray(clients.id, auditsV1.audits.map((a) => a.clientId)))).map((c) => c.id));
  let n = 0;
  for (const a of auditsV1.audits) {
    if (!ids.has(a.clientId)) continue;
    const today = new Date().toISOString().slice(0, 10);
    const [audit] = await db.insert(audits).values({
      clientId: a.clientId,
      date: a.date ?? today,
      statut: "finalise",
      finaliseLe: new Date(),
      origine: "import_v1",
      mention: a.date
        ? "Audit importé de l'ancienne grille (300 points) : seuls les critères repris dans la grille v2 sont renseignés."
        : `Date d'origine inconnue : audit importé de l'ancienne grille le ${today.split("-").reverse().join("/")}. Seuls les critères repris dans la grille v2 sont renseignés.`,
      note: a.actions ?? null,
    }).returning();
    const evs = a.evaluations
      .filter((e) => cs.some((c) => c.id === e.critereId) && (STATUTS as readonly string[]).includes(e.statut))
      .map((e) => ({
        auditId: audit.id, critereId: e.critereId, statut: e.statut, source: "import_v1",
        commentaire: `Ancienne grille, ligne ${e.ligne} : « ${e.libelleV1} »`,
      }));
    if (evs.length) await db.insert(evaluations).values(evs);
    await refreshScore(db, audit.id);
    n++;
  }
  return n;
}
