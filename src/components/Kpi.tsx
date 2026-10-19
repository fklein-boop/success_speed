import { Info } from "lucide-react";

/** Indicateur en grand chiffre. Chaque chiffre est explicable : définition, période, source. */
export function Kpi({ label, valeur, sous, definition, accent }: { label: string; valeur: React.ReactNode; sous?: React.ReactNode; definition: string; accent?: "rouge" | "ambre" }) {
  return (
    <div className="carte group relative p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="libelle">{label}</span>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-full text-gris-texte hover:text-horizon" aria-label={`Définition : ${label}`}><Info size={14} aria-hidden /></summary>
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg bg-minuit p-3 text-xs leading-relaxed text-white shadow-lg">{definition}</div>
        </details>
      </div>
      <div className={`font-titres mt-2 text-2xl font-bold tabular-nums ${accent === "rouge" ? "text-rouge-texte" : ""}`}>{valeur}</div>
      {sous && <div className="mt-1 text-xs text-gris-texte">{sous}</div>}
    </div>
  );
}
