/** Valeurs mesurées des critères à seuil : stockées en nombre brut (fraction pour les %). */

const estPourcentage = (unite: string | null | undefined) => !!unite && unite.trim().startsWith("%");

/** Valeur stockée → texte affiché (« 33,5 % », « 4,4 note /5 »). */
export function formatValeur(v: string | number | null | undefined, unite: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (estPourcentage(unite)) {
    const s = (n * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    return `${unite!.includes("évolution") && n > 0 ? "+" : ""}${s} %`;
  }
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${unite ? ` ${unite}` : ""}`;
}

/** Saisie du CSM (« 33,5 » pour 33,5 % ; « 4,4 ») → valeur stockée. null si vide ou illisible. */
export function parseValeurSaisie(s: string, unite: string | null | undefined): number | null {
  const t = s.replace(/[\s%€]/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return estPourcentage(unite) ? n / 100 : n;
}

/** Valeur stockée → valeur à afficher dans le champ de saisie. */
export function valeurPourSaisie(v: string | null | undefined, unite: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Math.round((estPourcentage(unite) ? n * 100 : n) * 1000) / 1000).replace(".", ",");
}

/** Texte du seuil pour l'aide (« objectif ≥ 40 % ; 50 % des points dès 20 % »). */
export function texteSeuil(c: { sens: string | null; seuilPlein: number | null; seuilMoitie: number | null; unite: string | null }) {
  if (c.seuilPlein === null || c.seuilMoitie === null) return "";
  const op = c.sens === "↓" ? "≤" : "≥";
  return `OUI si ${op} ${formatValeur(c.seuilPlein, c.unite)} · PARTIELLEMENT si ${op} ${formatValeur(c.seuilMoitie, c.unite)}`;
}
