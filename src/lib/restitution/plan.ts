import type { Statut } from "@/lib/audit/score";
import { criteresDuLevier, LEVIERS, type LevierEnRetard } from "./leviers";

/**
 * Plan d'action priorisé (§ 7) : impact = points du critère × part manquante × poids du levier
 * en retard ; effort = estimation de l'offre associée (faible / moyen / fort).
 */
export type Effort = "faible" | "moyen" | "fort";
export const EFFORT_VALEUR: Record<Effort, number> = { faible: 1, moyen: 2, fort: 3 };

export interface CriterePlan {
  id: string; pilier: string; critere: string; points: number; obligationLegale: boolean; offreSiNon: string | null;
}

export interface ActionProposee {
  critereId: string;
  libelle: string;
  pilier: string;
  offre: string | null;
  statutCritere: Statut;
  impact: number;
  effort: Effort;
  priorite: number;
  levier: string | null;
  obligationLegale: boolean;
}

/** Statut retenu pour la restitution : la réponse validée, à défaut le résultat automatique (pré-audit). */
export function statutEffectif(e: { statut: string | null; proposition?: unknown } | undefined, finalise: boolean): Statut | null {
  if (!e) return null;
  if (e.statut) return e.statut as Statut;
  if (finalise) return null;
  const p = e.proposition as { statut?: Statut | null } | null | undefined;
  return p?.statut ?? null;
}

export function construirePlan(criteres: CriterePlan[], statuts: Map<string, Statut | null>, enRetard: LevierEnRetard[], efforts: Record<string, Effort>): ActionProposee[] {
  const out: ActionProposee[] = [];
  for (const c of criteres) {
    const s = statuts.get(c.id);
    // Critère « plateforme » (0 point) : chantier produit Speedmedia, pas une action du client
    if ((s !== "NON" && s !== "PARTIELLEMENT") || c.points <= 0) continue;
    const leviers = enRetard.filter((l) => { const def = LEVIERS.find((x) => x.code === l.code); return def ? criteresDuLevier(def, c.id) : false; });
    const poids = Math.max(1, ...leviers.map((l) => l.poids));
    const effort = (c.offreSiNon && efforts[c.offreSiNon]) || "moyen";
    const impact = Math.round(c.points * (s === "NON" ? 1 : 0.5) * poids * 10) / 10;
    out.push({
      critereId: c.id,
      libelle: c.critere,
      pilier: c.pilier,
      offre: c.offreSiNon,
      statutCritere: s,
      impact,
      effort,
      // Les obligations légales à NON passent toujours en tête
      priorite: Math.round(((impact / EFFORT_VALEUR[effort]) + (c.obligationLegale && s === "NON" ? 100 : 0)) * 10) / 10,
      levier: leviers.sort((a, b) => b.poids - a.poids)[0]?.libelle ?? null,
      obligationLegale: c.obligationLegale,
    });
  }
  return out.sort((a, b) => b.priorite - a.priorite || a.critereId.localeCompare(b.critereId));
}

/** Quadrant impact × effort, pour l'affichage. */
export function quadrant(a: { impact: number; effort: Effort; obligationLegale?: boolean; statutCritere?: Statut }): string {
  if (a.obligationLegale && a.statutCritere === "NON") return "Obligation légale";
  const fortImpact = a.impact >= 10;
  if (a.effort === "faible") return fortImpact ? "Gain rapide" : "Petit gain";
  if (a.effort === "fort") return fortImpact ? "Projet structurant" : "À planifier";
  return fortImpact ? "Prioritaire" : "À planifier";
}

/** Taille du plan recommandé : toutes les obligations légales + les N actions les plus prioritaires. */
export const TAILLE_PLAN = 8;

/** Plan recommandé : obligations légales à traiter, puis les actions les plus prioritaires. */
export function planRecommande(plan: ActionProposee[], n = TAILLE_PLAN): ActionProposee[] {
  const legales = plan.filter((a) => a.obligationLegale);
  return [...legales, ...plan.filter((a) => !a.obligationLegale).slice(0, n)];
}
