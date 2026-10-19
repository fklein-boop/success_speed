import { AlertOctagon, AlertTriangle, CheckCircle2, Ghost, Rocket, Trophy, TrendingDown } from "lucide-react";

/** Statuts en couleur, mais jamais seulement en couleur : icône + libellé. */
export function RisqueBadge({ risque }: { risque: string | null | undefined }) {
  if (!risque) return <span className="text-gris-texte">—</span>;
  const s = {
    Critique: { c: "bg-rouge text-white", I: AlertOctagon },
    "À surveiller": { c: "bg-ambre text-minuit", I: AlertTriangle },
    Sain: { c: "bg-emeraude text-minuit", I: CheckCircle2 },
  }[risque] ?? { c: "bg-gris-clair text-minuit", I: CheckCircle2 };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.c}`}><s.I size={12} aria-hidden />{risque}</span>;
}

export function SegmentBadge({ segment }: { segment: string | null | undefined }) {
  if (!segment) return <span className="text-gris-texte">—</span>;
  const s = {
    Champion: { c: "border-horizon text-horizon", I: Trophy },
    "À activer": { c: "border-gris-fonce text-minuit", I: Rocket },
    "À risque": { c: "border-rouge-texte text-rouge-texte", I: TrendingDown },
    Fantôme: { c: "border-gris-fonce text-gris-texte", I: Ghost },
  }[segment] ?? { c: "border-gris-fonce", I: Rocket };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.c}`}><s.I size={12} aria-hidden />{segment}</span>;
}

export function SanteJauge({ sante }: { sante: number | null | undefined }) {
  if (sante === null || sante === undefined) return <span className="text-gris-texte">—</span>;
  const c = sante >= 65 ? "bg-emeraude" : sante >= 45 ? "bg-ambre" : "bg-rouge";
  return (
    <span className="inline-flex items-center gap-2" title={`Score santé ${sante}/100 (calculé à partir des données SpeedResa)`}>
      <span className="font-titres w-7 text-right font-bold tabular-nums">{sante}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-gris-clair" aria-hidden><span className={`block h-full ${c}`} style={{ width: `${sante}%` }} /></span>
    </span>
  );
}

export function Evol({ x }: { x: number | null | undefined }) {
  if (x === null || x === undefined) return <span className="text-gris-texte" title="Pas de base de comparaison">n.c.</span>;
  const pct = Math.round(x * 100);
  const cls = pct >= 0 ? "text-[#0b7a5e]" : "text-rouge-texte";
  return <span className={`tabular-nums font-semibold ${cls}`}>{pct > 0 ? "▲ +" : pct < 0 ? "▼ " : ""}{pct}&nbsp;%</span>;
}
