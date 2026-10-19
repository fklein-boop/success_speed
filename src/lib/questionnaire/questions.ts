import config from "../../../config/questionnaire.json";
import { statutFromSeuil, type Statut } from "@/lib/audit/score";

/**
 * Questionnaire client : choix des questions et interprétation des réponses.
 * Fonctions pures, testées. Les règles par critère sont dans config/questionnaire.json.
 */
export type TypeQuestion = "oui_non" | "nombre" | "pourcentage" | "note10";
export const REPONSES_OUI_NON = ["oui", "en_partie", "non", "ne_sais_pas"] as const;
export const LIBELLE_REPONSE: Record<string, string> = { oui: "Oui", en_partie: "En partie", non: "Non", ne_sais_pas: "Je ne sais pas" };

export interface Question {
  critereId: string;
  question: string;
  type: TypeQuestion;
  unite?: string;
  aide?: string;
}

interface Regle { type?: TypeQuestion; unite?: string; question?: string; aide?: string; reponses?: Record<string, Statut | null>; seuils?: { plein: number; moitie: number } }
const REGLES = (config as { criteres: Record<string, Regle> }).criteres;

export interface CritereQ {
  id: string; critere: string; source: string; questionClient: string | null; sens: string | null; seuilPlein: number | null; seuilMoitie: number | null; unite: string | null; actif?: boolean;
}

/** Question par défaut quand ni question_client ni reformulation ne sont disponibles. */
export function questionParDefaut(critere: string): string {
  const c = critere.split(/ ?[:(]/)[0].trim();
  return `Ce point est-il en place dans votre agence : ${c.charAt(0).toLowerCase()}${c.slice(1)} ?`;
}

/**
 * Questions d'un audit : critères de source « Client » (sauf si le CSM y a déjà répondu)
 * et critères que le CSM a choisi d'envoyer au client.
 */
export function questionsPourAudit(
  criteres: CritereQ[],
  evals: Map<string, { statut: string | null; source: string | null; aEnvoyerClient: boolean }>,
  reformulations: Record<string, string> = {},
): Question[] {
  const out: Question[] = [];
  for (const c of criteres) {
    if (c.actif === false) continue;
    const e = evals.get(c.id);
    const client = /Client/.test(c.source);
    const repondu = !!e?.statut && e.source === "csm";
    if (!(e?.aEnvoyerClient || (client && !repondu))) continue;
    const r = REGLES[c.id] ?? {};
    const type: TypeQuestion = r.type ?? (c.unite === "%" ? "pourcentage" : c.unite === "note /10" ? "note10" : "oui_non");
    out.push({
      critereId: c.id,
      question: r.question ?? c.questionClient ?? reformulations[c.id] ?? questionParDefaut(c.critere),
      type,
      ...(r.unite ? { unite: r.unite } : {}),
      ...(r.aide ? { aide: r.aide } : {}),
    });
  }
  return out;
}

/** Valide une réponse brute selon le type de question. Renvoie null si invalide. */
export function normaliserReponse(q: Pick<Question, "type">, brute: string): string | null {
  const t = brute.trim();
  if (q.type === "oui_non") return (REPONSES_OUI_NON as readonly string[]).includes(t) ? t : null;
  if (t === "ne_sais_pas") return t;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  if (q.type === "pourcentage" && n > 100) return null;
  if (q.type === "note10" && (n > 10 || !Number.isInteger(n))) return null;
  if (q.type === "nombre" && n > 1000) return null;
  return String(n);
}

/** Statut proposé pour l'audit à partir de la réponse du client (null = informative, à arbitrer par le CSM). */
export function statutDepuisReponse(c: Pick<CritereQ, "id" | "sens" | "seuilPlein" | "seuilMoitie">, q: Pick<Question, "type">, reponse: string): { statut: Statut | null; valeur: number | null } {
  const r = REGLES[c.id] ?? {};
  if (reponse === "ne_sais_pas") return { statut: null, valeur: null };
  if (q.type === "oui_non") {
    const defaut: Record<string, Statut | null> = { oui: "OUI", en_partie: "PARTIELLEMENT", non: "NON" };
    const table = r.reponses ?? defaut;
    return { statut: reponse in table ? table[reponse] : null, valeur: null };
  }
  const n = Number(reponse);
  if (q.type === "pourcentage") return { statut: statutFromSeuil(n / 100, c), valeur: n / 100 };
  if (q.type === "note10") return { statut: statutFromSeuil(n, c), valeur: n };
  if (r.seuils) return { statut: n >= r.seuils.plein ? "OUI" : n >= r.seuils.moitie ? "PARTIELLEMENT" : "NON", valeur: n };
  return { statut: null, valeur: n };
}

/** Texte de la réponse pour l'historique et le commentaire de l'évaluation. */
export function texteReponse(q: Pick<Question, "type" | "unite">, reponse: string): string {
  if (q.type === "oui_non" || reponse === "ne_sais_pas") return LIBELLE_REPONSE[reponse] ?? reponse;
  if (q.type === "pourcentage") return `${reponse} %`;
  if (q.type === "note10") return `${reponse}/10`;
  return `${reponse}${q.unite ? ` ${q.unite}` : ""}`;
}
