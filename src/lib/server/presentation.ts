import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { audits } from "@/db/schema";
import { computeScore, MATURITE_LIBELLE, statutMaturite, type Statut } from "@/lib/audit/score";
import { AuditError, getAuditState, toCritereScore } from "./audits";
import { chargerRestitution, modeleClient, type RestitutionAvecAudit } from "./restitution";

/**
 * Présentation au client (lot B5) : vue d'ensemble par pilier montrée pendant le rendez-vous.
 * Aucune donnée interne : ni score santé, ni alertes, ni chiffres de vente, ni commentaires, ni auteurs.
 * Reprend le modèle client du PDF (moyennes du portefeuille, priorités) quand l'audit présenté est l'audit de référence.
 */
export async function presentationClient(db: DB, clientId: string, auditId?: number) {
  let id = auditId;
  if (!id) {
    const r = await chargerRestitution(db, clientId);
    if (!r.audit) throw new AuditError("Aucun audit pour ce client.", 404);
    id = r.audit.id;
  }
  const [a] = await db.select({ clientId: audits.clientId }).from(audits).where(eq(audits.id, id));
  if (!a || a.clientId !== clientId) throw new AuditError("Audit introuvable", 404);
  const st = await getAuditState(db, id);
  const cs = st.criteres.filter((c) => c.actif);
  const statuts = new Map(st.evaluations.map((e) => [e.critereId, e.statut as Statut | null]));
  const score = computeScore(cs.map(toCritereScore), new Map([...statuts].map(([k, s]) => [k, { statut: s }])));
  const restit = await chargerRestitution(db, clientId);
  const modele = restit.audit?.id === id ? modeleClient(restit as RestitutionAvecAudit) : null;
  const moyenne = new Map((modele?.piliers ?? []).map((p) => [p.pilier, p.moyenne]));
  const piliers = score.piliers.filter((p) => p.score !== null).map((p) => {
    const crit = cs.filter((c) => c.pilier === p.pilier);
    return {
      pilier: p.pilier,
      score: p.score!,
      moyenne: moyenne.get(p.pilier) ?? null,
      enPlace: crit.filter((c) => statuts.get(c.id) === "OUI").map((c) => c.critere),
      enCours: crit.filter((c) => statuts.get(c.id) === "CORRIGÉ").map((c) => c.critere),
      manque: crit.filter((c) => statuts.get(c.id) === "NON" || statuts.get(c.id) === "PARTIELLEMENT")
        .sort((x, y) => Number(y.obligationLegale) - Number(x.obligationLegale) || y.points - x.points)
        .map((c) => ({ critere: c.critere, partiel: statuts.get(c.id) === "PARTIELLEMENT", legal: c.obligationLegale, solution: c.offreSiNon })),
    };
  });
  const niveau = statutMaturite(score.score);
  return {
    client: st.client.nom, date: st.audit.date, preAudit: st.audit.statut !== "finalise",
    score: score.score, scoreVise: score.scoreApres, niveau: niveau ? MATURITE_LIBELLE[niveau] : null,
    piliers, priorites: modele?.priorites ?? [], synthese: modele?.synthese ?? null, feuille: modele?.feuille ?? null,
  };
}
export type Presentation = Awaited<ReturnType<typeof presentationClient>>;
