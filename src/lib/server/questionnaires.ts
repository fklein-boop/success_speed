import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { audits, clients, evaluationHistorique, evaluations, parametres, questionnaires, reponses, users } from "@/db/schema";
import { normaliserReponse, questionsPourAudit, statutDepuisReponse, texteReponse, type Question } from "@/lib/questionnaire/questions";
import { analyserIa, iaDisponible } from "@/scan/ia";
import { AuditError, loadCriteres, refreshScore } from "./audits";
import { emailLayout, sendEmail } from "./email";
import { logActivity } from "./activity";

/** Lien valable 30 jours ; relances automatiques à J+3 et J+7 si le client n'a pas répondu. */
export const VALIDITE_JOURS = 30;
export const RELANCES_JOURS = [3, 7] as const;
const JOUR = 86_400_000;

// ───────────────────────── Jeton ─────────────────────────

function secret() {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET manquant");
  return "secret-de-developpement-local";
}
const sha256 = (t: string) => createHmac("sha256", "questionnaire-empreinte").update(t).digest("hex");

/** Jeton dérivé (HMAC) : jamais stocké en base, recalculable pour les relances. */
export const jeton = (id: number, nonce: string) => createHmac("sha256", secret()).update(`questionnaire:${id}:${nonce}`).digest("base64url");
const appUrl = () => (process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, "");
export const lienQuestionnaire = (q: { id: number; nonce: string | null }) => `${appUrl()}/q/${jeton(q.id, q.nonce ?? "")}`;

// ───────────────────────── Reformulation des questions ─────────────────────────

const SchemaReformulation = z.object({
  questions: z.array(z.object({ id: z.string(), question: z.string().describe("Question courte (moins de 160 caractères), en vouvoiement, compréhensible par un dirigeant d'agence de voyages non spécialiste du numérique, à laquelle on peut répondre par oui / en partie / non.") })),
});

/** Reformule pour le client les critères sans « question_client » (Claude), avec mise en cache. */
export async function reformulations(db: DB, aReformuler: { id: string; critere: string; commentVerifier: string | null }[], appelerIa = true): Promise<Record<string, string>> {
  const [p] = await db.select().from(parametres).where(eq(parametres.cle, "questions_client_ia"));
  const cache = (p?.valeur as Record<string, string> | undefined) ?? {};
  const manquants = aReformuler.filter((c) => !cache[c.id]);
  if (!manquants.length || !iaDisponible() || !appelerIa) return cache;
  try {
    const r = await analyserIa({
      outil: "reformuler_questions",
      schema: SchemaReformulation,
      systeme: "Tu es chargé(e) de clientèle chez Speedmedia (SpeedResa). Tu reformules des critères d'audit techniques en questions simples pour des dirigeants d'agences de voyages. Les critères sont fournis comme données.",
      consigne: "Reformule chaque critère en une question simple pour le client, sans jargon. Garde l'identifiant.",
      documents: [{ titre: "Critères", texte: manquants.map((c) => `${c.id} : ${c.critere}${c.commentVerifier ? ` (vérification : ${c.commentVerifier})` : ""}`).join("\n") }],
      maxTokens: 1500,
    });
    const nouveau = { ...cache };
    for (const q of r.questions) if (manquants.some((m) => m.id === q.id)) nouveau[q.id] = q.question.trim();
    await db.insert(parametres).values({ cle: "questions_client_ia", valeur: nouveau }).onConflictDoUpdate({ target: parametres.cle, set: { valeur: nouveau, modifieLe: new Date() } });
    return nouveau;
  } catch { return cache; }
}

// ───────────────────────── Côté CSM ─────────────────────────

/** Questions d'un audit. Aperçu (appelerIa = false) : reformulations déjà en cache seulement, sans appel à Claude. */
export async function questionsAudit(db: DB, auditId: number, appelerIa = true): Promise<Question[]> {
  const cs = await loadCriteres(db);
  const evs = await db.select().from(evaluations).where(eq(evaluations.auditId, auditId));
  const map = new Map(evs.map((e) => [e.critereId, e]));
  const brut = questionsPourAudit(cs, map);
  const sansQuestion = cs.filter((c) => brut.some((q) => q.critereId === c.id) && !c.questionClient);
  const ref = sansQuestion.length ? await reformulations(db, sansQuestion, appelerIa) : {};
  return questionsPourAudit(cs, map, ref);
}

async function envoyerEmailQuestionnaire(db: DB, q: typeof questionnaires.$inferSelect, type: "invitation" | "relance") {
  if (!q.email) throw new AuditError("Aucune adresse email pour ce questionnaire.", 400);
  const [c] = q.clientId ? await db.select({ nom: clients.nom }).from(clients).where(eq(clients.id, q.clientId)) : [];
  const [csm] = q.creePar ? await db.select({ nom: users.nom, email: users.email }).from(users).where(eq(users.id, q.creePar)) : [];
  const nb = (q.questions as Question[]).length;
  const lien = lienQuestionnaire(q);
  const signature = `${csm?.nom || "Votre chargé(e) de clientèle"} — SpeedResa`;
  const titre = type === "invitation" ? "Quelques questions sur votre activité en ligne" : "Petit rappel : vos réponses nous aident à vous conseiller";
  const paragraphes = type === "invitation"
    ? ["Bonjour,", `Pour compléter l'audit de la présence numérique de ${c?.nom ?? "votre agence"}, nous avons besoin de votre éclairage sur ${nb} point(s) que nous ne pouvons pas vérifier depuis votre site.`, "Cela prend 3 à 5 minutes, depuis un ordinateur ou un téléphone, sans créer de compte.", signature]
    : ["Bonjour,", `Il reste ${nb} question(s) rapide(s) pour finaliser l'audit de ${c?.nom ?? "votre agence"}. Vos réponses nous permettront de vous proposer les recommandations les plus utiles.`, signature];
  const r = await sendEmail({
    to: q.email,
    subject: type === "invitation" ? `${c?.nom ?? "Votre agence"} : 3 minutes pour compléter votre audit` : `Rappel : votre questionnaire d'audit SpeedResa`,
    text: `${paragraphes.join("\n\n")}\n\nRépondre au questionnaire : ${lien}\n\nCe lien personnel est valable jusqu'au ${q.expireLe.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.`,
    html: emailLayout({ titre, paragraphes, bouton: { label: "Répondre au questionnaire", url: lien }, pied: `Ce lien personnel est valable jusqu'au ${q.expireLe.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}. Ne le transférez pas.` }),
    replyTo: csm?.email,
  });
  if (!r.ok) throw new AuditError(`Envoi impossible : ${r.erreur ?? "erreur du service d'email"}`, 502);
}

/**
 * Crée le questionnaire d'un audit (un seul actif par audit : le précédent est annulé,
 * son lien cesse de fonctionner) et l'envoie par email si une adresse est fournie.
 */
export async function creerQuestionnaire(db: DB, auditId: number, userId: number, opts: { email?: string | null; envoyer: boolean; criteres?: string[] }) {
  const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
  if (!audit) throw new AuditError("Audit introuvable", 404);
  const email = opts.email?.trim().toLowerCase() || null;
  if (email && !z.email().safeParse(email).success) throw new AuditError("Adresse email invalide.", 400);
  if (opts.envoyer && !email) throw new AuditError("Indiquez l'adresse email du client.", 400);
  // Répartition choisie par le CSM (lot B2) : ces critères partent au client, les autres restent au CSM
  if (opts.criteres) {
    if (!opts.criteres.length) throw new AuditError("Sélectionnez au moins une question pour le client.", 400);
    if (audit.statut !== "brouillon") throw new AuditError("Audit finalisé : rouvrez-le pour poser des questions au client.", 409);
    const cs = await loadCriteres(db);
    const evs = new Map((await db.select().from(evaluations).where(eq(evaluations.auditId, auditId))).map((e) => [e.critereId, e]));
    for (const id of opts.criteres) {
      const c = cs.find((x) => x.id === id && x.actif);
      if (!c) throw new AuditError(`Critère inconnu : ${id}`, 400);
      const e = evs.get(id);
      if (e?.statut) continue;
      if (e) await db.update(evaluations).set({ aEnvoyerClient: true, updatedAt: new Date() }).where(eq(evaluations.id, e.id));
      else await db.insert(evaluations).values({ auditId, critereId: id, critereVersion: c.version, statut: null, aEnvoyerClient: true, auteurId: userId });
    }
  }
  let questions = await questionsAudit(db, auditId);
  if (opts.criteres) questions = questions.filter((q) => opts.criteres!.includes(q.critereId));
  if (!questions.length) throw new AuditError("Aucune question à poser : tous les critères « client » ont déjà une réponse.", 400);
  await db.update(questionnaires).set({ statut: "annule" }).where(and(eq(questionnaires.auditId, auditId), eq(questionnaires.statut, "en_attente")));
  const nonce = randomBytes(16).toString("base64url");
  const [q] = await db.insert(questionnaires).values({
    auditId, clientId: audit.clientId, tokenHash: `provisoire-${nonce}`, nonce, email, questions, statut: "en_attente",
    expireLe: new Date(Date.now() + VALIDITE_JOURS * JOUR), creePar: userId,
  }).returning();
  const [maj] = await db.update(questionnaires).set({ tokenHash: sha256(jeton(q.id, nonce)) }).where(eq(questionnaires.id, q.id)).returning();
  if (opts.envoyer) {
    await envoyerEmailQuestionnaire(db, maj, "invitation");
    await db.update(questionnaires).set({ envoyeLe: new Date() }).where(eq(questionnaires.id, q.id));
  }
  await logActivity(userId, "questionnaire_cree", "audit", String(auditId), { questionnaire: q.id, questions: questions.length, envoye: opts.envoyer });
  return { id: q.id, lien: lienQuestionnaire(maj), questions: questions.length };
}

/** (Ré)envoie l'invitation, éventuellement à une nouvelle adresse. */
export async function envoyerQuestionnaire(db: DB, id: number, userId: number, email?: string | null) {
  const [q] = await db.select().from(questionnaires).where(eq(questionnaires.id, id));
  if (!q || q.statut !== "en_attente") throw new AuditError("Questionnaire introuvable ou déjà terminé.", 404);
  const e = email?.trim().toLowerCase() || q.email;
  if (!e || !z.email().safeParse(e).success) throw new AuditError("Adresse email invalide.", 400);
  const [maj] = await db.update(questionnaires).set({ email: e }).where(eq(questionnaires.id, id)).returning();
  await envoyerEmailQuestionnaire(db, maj, "invitation");
  await db.update(questionnaires).set({ envoyeLe: new Date(), relance1Le: null, relance2Le: null }).where(eq(questionnaires.id, id));
  await logActivity(userId, "questionnaire_envoye", "questionnaire", String(id), { auditId: q.auditId });
}

export async function annulerQuestionnaire(db: DB, id: number, userId: number) {
  await db.update(questionnaires).set({ statut: "annule" }).where(and(eq(questionnaires.id, id), eq(questionnaires.statut, "en_attente")));
  await logActivity(userId, "questionnaire_annule", "questionnaire", String(id), {});
}

/** Questionnaires d'un client, avec réponses et lien (pour le CSM). */
export async function questionnairesDuClient(db: DB, clientId: string) {
  const qs = await db.select().from(questionnaires).where(eq(questionnaires.clientId, clientId)).orderBy(desc(questionnaires.createdAt));
  return Promise.all(qs.map(async (q) => ({
    ...q,
    questions: (q.questions as Question[]) ?? [],
    lien: q.statut === "en_attente" && q.nonce ? lienQuestionnaire(q) : null,
    reponses: await db.select().from(reponses).where(eq(reponses.questionnaireId, q.id)),
  })));
}

// ───────────────────────── Côté client (lien magique) ─────────────────────────

export type EtatLien = "ouvert" | "repondu" | "expire" | "annule" | "inconnu";

export async function questionnaireParJeton(db: DB, token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return { etat: "inconnu" as EtatLien, q: null };
  const [q] = await db.select().from(questionnaires).where(eq(questionnaires.tokenHash, sha256(token)));
  if (!q) return { etat: "inconnu" as EtatLien, q: null };
  const etat: EtatLien = q.statut === "annule" ? "annule" : q.statut === "repondu" ? "repondu" : q.expireLe < new Date() ? "expire" : "ouvert";
  return { etat, q };
}

/** Vue du client : uniquement ses questions et ses réponses (aucune donnée interne). */
export async function vueClient(db: DB, token: string) {
  const { etat, q } = await questionnaireParJeton(db, token);
  if (!q) return { etat, client: null, csm: null, questions: [] as Question[], reponses: {} as Record<string, { reponse: string | null; commentaire: string | null }> };
  if (etat === "ouvert" && !q.ouvertLe) await db.update(questionnaires).set({ ouvertLe: new Date() }).where(eq(questionnaires.id, q.id));
  const [c] = q.clientId ? await db.select({ nom: clients.nom }).from(clients).where(eq(clients.id, q.clientId)) : [];
  const [csm] = q.creePar ? await db.select({ nom: users.nom }).from(users).where(eq(users.id, q.creePar)) : [];
  const rs = await db.select().from(reponses).where(eq(reponses.questionnaireId, q.id));
  return {
    etat, client: c?.nom ?? null, csm: csm?.nom ?? null,
    questions: etat === "ouvert" ? (q.questions as Question[]) : [],
    reponses: Object.fromEntries(rs.map((r) => [r.critereId, { reponse: r.reponse, commentaire: r.commentaire }])),
  };
}

/** Enregistre une réponse (sauvegarde au fil de l'eau, le client peut revenir plus tard). */
export async function enregistrerReponse(db: DB, token: string, critereId: string, brute: string, commentaire: string | null) {
  const { etat, q } = await questionnaireParJeton(db, token);
  if (!q || etat !== "ouvert") throw new AuditError(etat === "repondu" ? "Vous avez déjà envoyé vos réponses : merci !" : "Ce lien n'est plus valable.", 410);
  const question = (q.questions as Question[]).find((x) => x.critereId === critereId);
  if (!question) throw new AuditError("Question inconnue.", 400);
  const reponse = brute === "" ? null : normaliserReponse(question, brute);
  if (brute !== "" && reponse === null) throw new AuditError("Réponse invalide.", 400);
  const com = commentaire?.trim().slice(0, 1000) || null;
  await db.insert(reponses).values({ questionnaireId: q.id, critereId, reponse, commentaire: com })
    .onConflictDoUpdate({ target: [reponses.questionnaireId, reponses.critereId], set: { reponse, commentaire: com, updatedAt: new Date() } });
}

/**
 * Le client envoie ses réponses : le lien est clos, les réponses alimentent l'audit
 * (source « client »), le CSM est prévenu par email.
 */
export async function soumettreQuestionnaire(db: DB, token: string) {
  const { etat, q } = await questionnaireParJeton(db, token);
  if (!q || etat !== "ouvert") throw new AuditError(etat === "repondu" ? "Vos réponses ont déjà été envoyées." : "Ce lien n'est plus valable.", 410);
  const rs = await db.select().from(reponses).where(eq(reponses.questionnaireId, q.id));
  if (!rs.some((r) => r.reponse)) throw new AuditError("Répondez au moins à une question avant d'envoyer.", 400);
  const [fait] = await db.update(questionnaires).set({ statut: "repondu", reponduLe: new Date() })
    .where(and(eq(questionnaires.id, q.id), eq(questionnaires.statut, "en_attente"))).returning();
  if (!fait) throw new AuditError("Vos réponses ont déjà été envoyées.", 410);
  const bilan = await reporterReponses(db, fait);
  await logActivity(null, "questionnaire_repondu", "questionnaire", String(q.id), { auditId: q.auditId, ...bilan });
  // Prévenir le CSM
  if (q.creePar) {
    const [csm] = await db.select({ email: users.email }).from(users).where(eq(users.id, q.creePar));
    const [c] = q.clientId ? await db.select({ nom: clients.nom }).from(clients).where(eq(clients.id, q.clientId)) : [];
    if (csm) {
      const url = `${appUrl()}/audits/${q.auditId}`;
      const texte = `${c?.nom ?? "Le client"} a répondu au questionnaire : ${bilan.reportees} réponse(s) reportée(s) dans l'audit, ${bilan.aArbitrer} à arbitrer.`;
      await sendEmail({ to: csm.email, subject: `Questionnaire reçu — ${c?.nom ?? "client"}`, text: `${texte}\n\n${url}`, html: emailLayout({ titre: "Questionnaire client reçu", paragraphes: [texte], bouton: { label: "Ouvrir l'audit", url } }) }).catch(() => null);
    }
  }
  return bilan;
}

/**
 * Reporte les réponses dans l'audit :
 * - sur un audit en cours, la réponse devient le statut du critère (source « client ») si le CSM ne l'a pas déjà tranché ;
 * - sinon (CSM déjà passé, audit finalisé, réponse informative), elle est ajoutée en proposition / commentaire à arbitrer.
 */
export async function reporterReponses(db: DB, q: typeof questionnaires.$inferSelect) {
  const [audit] = await db.select().from(audits).where(eq(audits.id, q.auditId));
  const cs = await loadCriteres(db);
  const rs = await db.select().from(reponses).where(eq(reponses.questionnaireId, q.id));
  const questions = (q.questions as Question[]) ?? [];
  const date = (q.reponduLe ?? new Date()).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  let reportees = 0, aArbitrer = 0;
  for (const r of rs) {
    const question = questions.find((x) => x.critereId === r.critereId);
    const c = cs.find((x) => x.id === r.critereId);
    if (!question || !c || !r.reponse) continue;
    const { statut, valeur } = statutDepuisReponse(c, question, r.reponse);
    const texte = `Réponse client (${date}) : ${texteReponse(question, r.reponse)}${r.commentaire ? ` — « ${r.commentaire} »` : ""}`;
    const [e] = await db.select().from(evaluations).where(and(eq(evaluations.auditId, q.auditId), eq(evaluations.critereId, c.id)));
    // Lot B2 : la réponse du client arrive dans « À valider » (proposition), le CSM la valide ou la corrige
    const peutEcrire = audit.statut === "brouillon" && statut !== null && (!e || e.statut === null);
    const proposition = { statut, valeur, texte, confiance: "moyenne", source: "client", preuve: { texte, source: "Questionnaire client" } };
    if (peutEcrire) {
      const valeurs = { proposition, preuve: proposition.preuve, confiance: "moyenne", valeur: valeur === null ? e?.valeur ?? null : String(valeur), source: "client", commentaire: texte, aEnvoyerClient: false, critereVersion: c.version, updatedAt: new Date() };
      if (e) await db.update(evaluations).set(valeurs).where(eq(evaluations.id, e.id));
      else await db.insert(evaluations).values({ auditId: q.auditId, critereId: c.id, statut: null, ...valeurs });
      await db.insert(evaluationHistorique).values({ auditId: q.auditId, critereId: c.id, statut: null, valeur: valeurs.valeur, commentaire: texte, aEnvoyerClient: false, auteurId: null });
      reportees++;
    } else {
      // Réponse à arbitrer par le CSM : on garde le résultat automatique, la réponse va en commentaire
      const commentaire = e?.commentaire ? `${e.commentaire}\n${texte}` : texte;
      if (e) await db.update(evaluations).set({ commentaire, aEnvoyerClient: false, ...(e.statut === null && statut !== null && !e.proposition ? { proposition } : {}), updatedAt: new Date() }).where(eq(evaluations.id, e.id));
      else if (audit.statut === "brouillon") await db.insert(evaluations).values({ auditId: q.auditId, critereId: c.id, critereVersion: c.version, statut: null, commentaire, source: "client", proposition: statut !== null ? proposition : null });
      aArbitrer++;
    }
  }
  if (audit.statut === "brouillon") await refreshScore(db, q.auditId);
  return { reportees, aArbitrer };
}

// ───────────────────────── Relances ─────────────────────────

/** Relances automatiques à J+3 et J+7 après l'envoi (tâche planifiée quotidienne). */
export async function relancerQuestionnaires(db: DB, maintenant = new Date()) {
  const enAttente = await db.select().from(questionnaires).where(and(eq(questionnaires.statut, "en_attente"), ne(questionnaires.email, ""), lt(questionnaires.envoyeLe, maintenant)));
  let envoyees = 0;
  for (const q of enAttente) {
    if (!q.envoyeLe || !q.email || q.expireLe < maintenant) continue;
    const age = (maintenant.getTime() - q.envoyeLe.getTime()) / JOUR;
    const champ = age >= RELANCES_JOURS[1] && !q.relance2Le ? "relance2Le" : age >= RELANCES_JOURS[0] && !q.relance1Le ? "relance1Le" : null;
    if (!champ) continue;
    try {
      await envoyerEmailQuestionnaire(db, q, "relance");
      // Une relance J+7 envoyée sans J+3 (envoi tardif de la tâche) marque aussi J+3
      await db.update(questionnaires).set(champ === "relance2Le" ? { relance2Le: maintenant, relance1Le: q.relance1Le ?? maintenant } : { relance1Le: maintenant }).where(eq(questionnaires.id, q.id));
      envoyees++;
    } catch { /* on réessaiera demain */ }
  }
  return { envoyees };
}

