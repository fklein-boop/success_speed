/**
 * Score de maturité (02_REGLES_DE_CALCUL.md § 6). Module pur, utilisé côté serveur et dans
 * l'écran de complétion (score en direct).
 */

export const STATUTS = ["OUI", "PARTIELLEMENT", "NON", "CORRIGÉ", "N.A."] as const;
export type Statut = (typeof STATUTS)[number];

export const STATUT_LIBELLE: Record<Statut, string> = {
  OUI: "OUI", PARTIELLEMENT: "PARTIELLEMENT", NON: "NON", "CORRIGÉ": "CORRIGÉ", "N.A.": "Non applicable",
};

export interface CritereScore {
  id: string;
  pilier: string;
  points: number;
  type: string; // "Oui/Non" | "Seuil"
  sens: string | null; // "↑" | "↓"
  seuilPlein: number | null;
  seuilMoitie: number | null;
  obligationLegale?: boolean;
}

export interface EvalScore {
  statut: Statut | null;
}

const PART: Record<Statut, number | null> = { OUI: 1, PARTIELLEMENT: 0.5, NON: 0, "CORRIGÉ": 0, "N.A.": null };

/** Statut d'un critère à seuil à partir de la valeur mesurée. */
export function statutFromSeuil(valeur: number | null | undefined, c: Pick<CritereScore, "sens" | "seuilPlein" | "seuilMoitie">): Statut | null {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur) || c.seuilPlein === null || c.seuilMoitie === null) return null;
  if (c.sens === "↓") return valeur <= c.seuilPlein ? "OUI" : valeur <= c.seuilMoitie ? "PARTIELLEMENT" : "NON";
  return valeur >= c.seuilPlein ? "OUI" : valeur >= c.seuilMoitie ? "PARTIELLEMENT" : "NON";
}

/** Niveaux de maturité (seuils 35 et 73 repris de la grille d'origine, 100/300 et 220/300 ramenés sur 100). */
export type StatutMaturite = "faible" | "intermediaire" | "avancee";
export const MATURITE_LIBELLE: Record<StatutMaturite, string> = {
  faible: "Maturité faible",
  intermediaire: "Maturité intermédiaire",
  avancee: "Maturité avancée",
};
export const MATURITE_DESCRIPTION: Record<StatutMaturite, string> = {
  faible: "Fondamentaux numériques à construire ; risque de départ accru.",
  intermediaire: "Bases en place, leviers de performance encore sous-exploités.",
  avancee: "Pratiques numériques au niveau des meilleurs clients du portefeuille.",
};
export function statutMaturite(score: number | null): StatutMaturite | null {
  if (score === null) return null;
  return score < 35 ? "faible" : score < 73 ? "intermediaire" : "avancee";
}

export interface ScoreBloc {
  score: number | null; // /100
  scoreApres: number | null; // CORRIGÉ compté à 100 %
  pointsObtenus: number;
  pointsApres: number;
  pointsEvalues: number;
  nbEvalues: number;
  nbApplicables: number;
  couverture: number; // 0..1
}

export interface ScoreResult extends ScoreBloc {
  statut: StatutMaturite | null;
  fiable: boolean;
  piliers: ({ pilier: string } & ScoreBloc)[];
  legauxNon: string[];
}

function bloc(cs: CritereScore[], evals: Map<string, EvalScore>): ScoreBloc {
  let pointsObtenus = 0, pointsApres = 0, pointsEvalues = 0, nbEvalues = 0, nbApplicables = 0;
  for (const c of cs) {
    const s = evals.get(c.id)?.statut ?? null;
    if (s === "N.A.") continue;
    nbApplicables++;
    if (s === null) continue;
    nbEvalues++;
    pointsEvalues += c.points;
    pointsObtenus += c.points * (PART[s] ?? 0);
    pointsApres += c.points * (s === "CORRIGÉ" ? 1 : PART[s] ?? 0);
  }
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    score: pointsEvalues ? r((pointsObtenus / pointsEvalues) * 100) : null,
    scoreApres: pointsEvalues ? r((pointsApres / pointsEvalues) * 100) : null,
    pointsObtenus, pointsApres, pointsEvalues, nbEvalues, nbApplicables,
    couverture: nbApplicables ? nbEvalues / nbApplicables : 0,
  };
}

export const SEUIL_FIABILITE = 0.7;

export function computeScore(criteres: CritereScore[], evals: Map<string, EvalScore>): ScoreResult {
  const g = bloc(criteres, evals);
  const piliers = [...new Set(criteres.map((c) => c.pilier))].map((p) => ({ pilier: p, ...bloc(criteres.filter((c) => c.pilier === p), evals) }));
  return {
    ...g,
    statut: statutMaturite(g.score),
    fiable: g.couverture >= SEUIL_FIABILITE,
    piliers,
    legauxNon: criteres.filter((c) => c.obligationLegale && evals.get(c.id)?.statut === "NON").map((c) => c.id),
  };
}

/** Critères gagnés / perdus entre deux audits. */
export function compareAudits(avant: Map<string, EvalScore>, apres: Map<string, EvalScore>) {
  const rang = (s: Statut | null | undefined) => (s === "OUI" ? 2 : s === "PARTIELLEMENT" ? 1 : s === "NON" || s === "CORRIGÉ" ? 0 : null);
  const gagnes: string[] = [], perdus: string[] = [];
  for (const [id, e] of apres) {
    const a = rang(avant.get(id)?.statut), b = rang(e.statut);
    if (a === null || b === null) continue;
    if (b > a) gagnes.push(id);
    else if (b < a) perdus.push(id);
  }
  return { gagnes, perdus };
}

const PREFIXES = ["VIS", "PROD", "PERF", "TRK", "LEG", "TECH", "RES", "SOC", "DIST", "INN", "REL"];

/** Ordre du référentiel : pilier (ordre de la grille), puis numéro. */
export function compareCriteres(a: { id: string }, b: { id: string }) {
  const [pa, na] = a.id.split("-");
  const [pb, nb] = b.id.split("-");
  const ia = PREFIXES.indexOf(pa), ib = PREFIXES.indexOf(pb);
  if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return Number(na) - Number(nb);
}
