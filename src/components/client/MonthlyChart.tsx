"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtEurCompact } from "@/lib/format";

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Volume et confirmé mensuels, année N vs N-1 (12 mois glissants jusqu'à la date de référence). */
export function MonthlyChart({ data, reference }: { data: { mois: string; volume: number; confirme: number; visites?: number | null }[]; reference: string }) {
  const by = new Map(data.map((d) => [d.mois, d]));
  const [y, m] = reference.split("-").map(Number);
  const rows = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - 11 + i, 1));
    const k = d.toISOString().slice(0, 7);
    const k1 = `${d.getUTCFullYear() - 1}-${k.slice(5)}`;
    return {
      label: `${MOIS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
      volume: by.get(k)?.volume ?? 0,
      confirme: by.get(k)?.confirme ?? 0,
      volumeN1: by.get(k1)?.volume ?? null,
      visites: by.get(k)?.visites ?? null,
    };
  });
  const avecVisites = rows.some((r) => r.visites);
  return (
    <div className="mt-2 h-72" role="img" aria-label="Courbe mensuelle du volume d'affaires et du confirmé, comparée à l'année précédente, et visites du site quand le trafic est importé">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#E3E7EF" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#5b6479", fontSize: 11 }} />
          <YAxis yAxisId="eur" tickFormatter={(v) => fmtEurCompact(v)} tick={{ fill: "#5b6479", fontSize: 11 }} width={70} />
          {avecVisites && <YAxis yAxisId="visites" orientation="right" tickFormatter={(v) => Number(v).toLocaleString("fr-FR")} tick={{ fill: "#5b6479", fontSize: 11 }} width={55} />}
          <Tooltip formatter={(v, nom) => (nom === "Visites" ? `${Number(v).toLocaleString("fr-FR")} visites` : fmtEurCompact(Number(v)))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="eur" type="monotone" dataKey="volume" name="Volume N" stroke="#0A56FC" strokeWidth={2.5} dot={false} />
          <Line yAxisId="eur" type="monotone" dataKey="confirme" name="Confirmé N" stroke="#00CCCC" strokeWidth={2} dot={false} />
          <Line yAxisId="eur" type="monotone" dataKey="volumeN1" name="Volume N-1" stroke="#7B859B" strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls />
          {avecVisites && <Line yAxisId="visites" type="monotone" dataKey="visites" name="Visites" stroke="#1EDDAE" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
