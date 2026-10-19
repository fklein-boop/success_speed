import { statutFromSeuil, type Statut } from "./score";

interface CritereSeuil { type: string; sens: string | null; seuilPlein: number | null; seuilMoitie: number | null }

/**
 * Commentaire obligatoire quand on contredit un résultat automatique ou le statut calculé par le seuil.
 * Renvoie le message à afficher, ou null si le commentaire est facultatif.
 */
export function commentaireRequis(c: CritereSeuil, input: { statut: Statut | null; valeur: number | null }, proposition: { statut: Statut | null } | null): string | null {
  if (!input.statut || input.statut === "N.A.") return null;
  if (proposition?.statut && proposition.statut !== input.statut) return "Vous contredisez le résultat automatique : expliquez pourquoi en commentaire.";
  if (c.type === "Seuil" && input.valeur !== null) {
    const calc = statutFromSeuil(input.valeur, c);
    if (calc && calc !== input.statut && input.statut !== "CORRIGÉ") return `La valeur saisie donne « ${calc} » : un commentaire est obligatoire pour retenir un autre statut.`;
  }
  return null;
}
