import { Sparkles } from "lucide-react";

/** « Pourquoi ce client sous-performe » : leviers en retard × critères à NON, explication et plan 30 jours (interne). */
export function Pourquoi({ causes, explication, plan30, source, maturite }: {
  causes: { levier: string; poids: number; constat: string; criteres: string[] }[];
  explication: string; plan30: string[]; source: string | null; maturite: number | null;
}) {
  const titre = causes.length ? "Pourquoi ce client sous-performe" : maturite !== null && maturite < 50 ? "Performance correcte malgré une maturité faible" : "Pas de retard de performance détecté";
  return (
    <section className="carte p-4" aria-labelledby="pourquoi-titre">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pourquoi-titre" className="text-lg">{titre}</h2>
        <span className="text-xs text-gris-texte">{source === "claude" ? <><Sparkles size={12} className="inline" aria-hidden /> Rédigé par Claude</> : source === "manuel" ? "Modifié par le CSM" : "Analyse automatique (modèle)"} · interne, jamais envoyé au client</span>
      </div>
      <p className="mt-2 text-sm">{explication}</p>
      {causes.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {causes.map((c) => (
            <li key={c.levier} className="rounded-lg bg-gris-clair/50 p-2.5">
              <p className="font-semibold">{c.levier} <span className={`ml-1 rounded px-1.5 text-xs ${c.poids >= 3 ? "bg-rouge-texte text-white" : "bg-ambre/30"}`}>{c.poids >= 3 ? "critique" : "en retard"}</span></p>
              <p className="text-gris-texte">{c.constat}</p>
              <p className="mt-1">{c.criteres.length ? <>Critères en cause : {c.criteres.join(" · ")}</> : <span className="text-gris-texte">Aucun critère d&apos;audit à NON sur ce levier : cause probablement commerciale ou d&apos;usage.</span>}</p>
            </li>
          ))}
        </ul>
      )}
      {plan30.length > 0 && (
        <div className="mt-3">
          <p className="libelle">Plan sur 30 jours</p>
          <ol className="mt-1 list-inside list-decimal space-y-0.5 text-sm">{plan30.map((p) => <li key={p}>{p.replace(/^Semaine \d+ : /, "")}</li>)}</ol>
        </div>
      )}
    </section>
  );
}
