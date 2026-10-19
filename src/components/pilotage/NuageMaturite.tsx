"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

const COULEUR: Record<string, string> = { Champion: "#1EDDAE", "À activer": "#0A56FC", "À risque": "#F5A524", "Fantôme": "#E5484D" };

/** Nuage maturité (dernier audit) × évolution du volume 90 j (données). */
export function NuageMaturite({ points }: { points: { nom: string; maturite: number; evol90: number; segment: string }[] }) {
  const parSegment = Object.keys(COULEUR).map((s) => ({ s, data: points.filter((p) => p.segment === s).map((p) => ({ ...p, evol: Math.max(-100, Math.min(200, Math.round(p.evol90 * 100))) })) }));
  return (
    <div>
      <div className="h-80" role="img" aria-label={`Nuage de points : maturité numérique et évolution du volume sur 90 jours pour ${points.length} clients audités`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid stroke="#E3E7EF" />
            <XAxis type="number" dataKey="maturite" name="Maturité" domain={[0, 100]} unit="" label={{ value: "Score de maturité /100", position: "insideBottom", offset: -10, fontSize: 12 }} tick={{ fontSize: 12 }} />
            <YAxis type="number" dataKey="evol" name="Évolution 90 j" unit=" %" tick={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#7B859B" />
            <ReferenceLine x={73} stroke="#7B859B" strokeDasharray="4 4" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
              const p = payload?.[0]?.payload as { nom: string; maturite: number; evol: number; segment: string } | undefined;
              return p ? <div className="rounded-lg border border-gris-clair bg-white p-2 text-xs shadow"><p className="font-semibold">{p.nom}</p><p>Maturité {Math.round(p.maturite)}/100 · {p.evol > 0 ? "+" : ""}{p.evol} % sur 90 j · {p.segment}</p></div> : null;
            }} />
            {parSegment.map(({ s, data }) => <Scatter key={s} name={s} data={data} fill={COULEUR[s]} stroke="#000033" strokeWidth={0.5} />)}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 flex flex-wrap gap-3 text-xs text-gris-texte">
        {Object.entries(COULEUR).map(([s, c]) => <span key={s} className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-full ring-1 ring-minuit" style={{ background: c }} />{s}</span>)}
        <span>Ligne pointillée : seuil de maturité avancée (73).</span>
      </p>
    </div>
  );
}
