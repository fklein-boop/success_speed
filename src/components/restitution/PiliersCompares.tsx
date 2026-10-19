import type { ScoreResult } from "@/lib/audit/score";

interface Moyennes { n: number; piliers: Record<string, number> }

/** Score par pilier comparé à la moyenne du portefeuille et à celle des Champions (affichées à partir de 3 audits). */
export function PiliersCompares({ score, portefeuille, champions, min }: { score: ScoreResult; portefeuille: Moyennes; champions: Moyennes; min: number }) {
  const showP = portefeuille.n >= min, showC = champions.n >= min;
  return (
    <div>
      <ul className="space-y-2.5">
        {score.piliers.filter((p) => p.score !== null).map((p) => {
          const mp = showP ? portefeuille.piliers[p.pilier] : undefined, mc = showC ? champions.piliers[p.pilier] : undefined;
          return (
            <li key={p.pilier}>
              <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                <span className="font-semibold">{p.pilier}</span>
                <span className="tabular-nums"><strong>{Math.round(p.score!)}</strong>/100
                  {mp !== undefined && <span className="text-gris-texte"> · portefeuille {Math.round(mp)}</span>}
                  {mc !== undefined && <span className="text-gris-texte"> · Champions {Math.round(mc)}</span>}
                </span>
              </div>
              <div className="relative mt-1 h-2.5 rounded-full bg-gris-clair" aria-hidden>
                <div className="h-full rounded-full bg-horizon" style={{ width: `${Math.max(2, p.score!)}%` }} />
                {mp !== undefined && <span className="absolute -top-1 h-4.5 w-0.5 bg-minuit" style={{ left: `${mp}%` }} title="Moyenne du portefeuille" />}
                {mc !== undefined && <span className="absolute -top-1 h-4.5 w-1 rounded bg-emeraude ring-1 ring-minuit" style={{ left: `${mc}%` }} title="Moyenne des Champions" />}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-gris-texte">
        {showP || showC ? <>Repères : <span className="inline-block h-3 w-0.5 bg-minuit align-middle" /> moyenne du portefeuille ({portefeuille.n} audits){showC && <>, <span className="inline-block h-3 w-1 rounded bg-emeraude align-middle ring-1 ring-minuit" /> moyenne des Champions ({champions.n})</>}. </> : null}
        {!showP && `Moyennes affichées à partir de ${min} audits finalisés (${portefeuille.n} à ce jour).`}
        {showP && !showC && ` Moyenne des Champions affichée à partir de ${min} Champions audités (${champions.n}).`}
      </p>
    </div>
  );
}
