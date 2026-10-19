import { Check, CircleHelp, Minus, Send, Wrench, X } from "lucide-react";
import { MATURITE_DESCRIPTION, MATURITE_LIBELLE, statutMaturite, type Statut } from "@/lib/audit/score";

const STYLES: Record<Statut, { c: string; I: typeof Check; l: string }> = {
  OUI: { c: "bg-emeraude text-minuit", I: Check, l: "OUI" },
  PARTIELLEMENT: { c: "bg-ambre text-minuit", I: CircleHelp, l: "PARTIEL" },
  NON: { c: "bg-rouge text-white", I: X, l: "NON" },
  "CORRIGÉ": { c: "bg-horizon text-white", I: Wrench, l: "CORRIGÉ" },
  "N.A.": { c: "bg-gris-clair text-gris-texte", I: Minus, l: "N.A." },
};

/** Statut d'audit : couleur + icône + libellé (jamais la couleur seule). */
export function StatutBadge({ statut, envoye, small }: { statut: Statut | null | undefined; envoye?: boolean; small?: boolean }) {
  const size = small ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-xs";
  if (!statut) {
    if (envoye) return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-horizon font-semibold text-horizon ${size}`}><Send size={11} aria-hidden />Client</span>;
    return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-gris-fonce text-gris-texte ${size}`}>À évaluer</span>;
  }
  const s = STYLES[statut];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ${s.c} ${size}`}><s.I size={11} aria-hidden />{s.l}</span>;
}

/** Niveau de maturité : pastille de couleur + libellé (jamais la couleur seule). Calculé à partir du score. */
export function MaturiteBadge({ score, court }: { score: number | null | undefined; court?: boolean }) {
  const s = statutMaturite(score ?? null);
  if (!s) return null;
  const c = { faible: "bg-rouge", intermediaire: "bg-ambre", avancee: "bg-emeraude" }[s];
  const l = court ? { faible: "Faible", intermediaire: "Intermédiaire", avancee: "Avancée" }[s] : MATURITE_LIBELLE[s];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold" title={MATURITE_DESCRIPTION[s]}>
      <span className={`inline-block size-2.5 rounded-full ${c}`} aria-hidden />{l}
    </span>
  );
}
