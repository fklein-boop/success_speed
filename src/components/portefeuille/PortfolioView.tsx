"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Radar, Search } from "lucide-react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Legend } from "recharts";
import type { PortfolioRow } from "@/lib/server/portfolio";
import { fmtDate, fmtEurCompact, fmtPct } from "@/lib/format";
import { Evol, RisqueBadge, SanteJauge, SegmentBadge } from "@/components/Badges";
import { NouvelAudit } from "@/components/audit/NouvelAudit";
import { LancerPreAudit } from "@/components/audit/LancerPreAudit";
import { MaturiteBadge } from "@/components/audit/StatutBadge";

type Tri = "nom" | "sante" | "volume" | "evol" | "risque" | "audit";
const ORDRE_RISQUE: Record<string, number> = { Critique: 0, "À surveiller": 1, Sain: 2 };
const SIX_MOIS = 183 * 86_400_000;

function etatAudit(r: PortfolioRow): "a_faire" | "en_cours" | "a_jour" {
  if (r.auditEnCours) return "en_cours";
  return r.dernierAudit && Date.now() - Date.parse(r.dernierAudit) < SIX_MOIS ? "a_jour" : "a_faire";
}

export function PortfolioView({ rows, userId, csms, editable }: { rows: PortfolioRow[]; userId: number; csms: { id: number; nom: string }[]; editable: boolean }) {
  const router = useRouter();
  const mesClients = rows.some((r) => r.csmId === userId);
  const [q, setQ] = useState("");
  const [csm, setCsm] = useState<string>(mesClients ? String(userId) : "");
  const [segment, setSegment] = useState("");
  const [risque, setRisque] = useState("");
  const [usage, setUsage] = useState("");
  const [audit, setAudit] = useState("");
  const [tri, setTri] = useState<{ col: Tri; asc: boolean }>({ col: "risque", asc: true });
  const nbAudites = rows.filter((r) => r.maturite?.score !== null && r.maturite && r.m).length;
  const [vue, setVue] = useState<"dynamique" | "maturite">(nbAudites >= 5 ? "maturite" : "dynamique");

  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase();
    const out = rows.filter((r) =>
      (!nq || r.nom.toLowerCase().includes(nq) || r.id.toLowerCase().includes(nq) || (r.groupe ?? "").toLowerCase().includes(nq)) &&
      (!csm || (csm === "aucun" ? !r.csmId : String(r.csmId) === csm)) &&
      (!segment || r.m?.segment === segment) &&
      (!risque || r.m?.risque === risque) &&
      (!usage || r.m?.usage === usage) &&
      (!audit || etatAudit(r) === audit));
    const val = (r: PortfolioRow): number | string => {
      switch (tri.col) {
        case "nom": return r.nom.toLowerCase();
        case "sante": return r.m?.sante ?? -1;
        case "volume": return r.m?.volume_12m ?? -1;
        case "evol": return r.m?.evol_90j ?? -99;
        case "audit": return r.dernierAudit ?? "";
        case "risque": return (ORDRE_RISQUE[r.m?.risque ?? ""] ?? 3) * 1000 + (r.m?.sante ?? 0);
      }
    };
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return tri.asc ? c : -c;
    });
  }, [rows, q, csm, segment, risque, usage, audit, tri]);

  const points = (niveau: string) => filtered.filter((r) => r.m && r.m.risque === niveau && r.m.segment !== "Fantôme").map((r) => ({
    id: r.id, nom: r.nom, sante: r.m!.sante, evol: Math.max(-100, Math.min(150, Math.round((r.m!.evol_90j ?? 0) * 100))),
    volume: r.m!.volume_12m, nc: r.m!.evol_90j === null,
  }));

  const Th = ({ col, children, className = "" }: { col: Tri; children: React.ReactNode; className?: string }) => (
    <th scope="col" className={`px-3 py-2 text-left ${className}`} aria-sort={tri.col === col ? (tri.asc ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 font-semibold hover:text-horizon" onClick={() => setTri({ col, asc: tri.col === col ? !tri.asc : col === "nom" || col === "risque" })}>
        {children}{tri.col === col && (tri.asc ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
      </button>
    </th>
  );

  return (
    <>
      <section className="carte p-4" aria-labelledby="matrice-titre">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="matrice-titre" className="text-lg">{vue === "dynamique" ? "Santé × dynamique" : "Maturité × santé"}</h2>
          <div role="tablist" aria-label="Choix de la matrice" className="flex rounded-full bg-gris-clair p-1 text-sm">
            <button role="tab" aria-selected={vue === "maturite"} onClick={() => setVue("maturite")} className={`rounded-full px-3 py-1 ${vue === "maturite" ? "bg-white font-semibold shadow-sm" : ""}`}>Maturité × santé</button>
            <button role="tab" aria-selected={vue === "dynamique"} onClick={() => setVue("dynamique")} className={`rounded-full px-3 py-1 ${vue === "dynamique" ? "bg-white font-semibold shadow-sm" : ""}`}>Santé × dynamique</button>
          </div>
        </div>
        {vue === "maturite" ? (
          <MatriceMaturite rows={filtered} onClick={(id) => router.push(`/clients/${id}`)} />
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                <CartesianGrid stroke="#E3E7EF" />
                <XAxis type="number" dataKey="evol" name="Évolution 90 j" unit=" %" domain={[-100, 150]} ticks={[-100, -50, 0, 50, 100, 150]} tick={{ fill: "#5b6479", fontSize: 12 }}
                  label={{ value: "Évolution du volume 90 j vs N-1 (%)", position: "insideBottom", offset: -15, fill: "#5b6479", fontSize: 12 }} />
                <YAxis type="number" dataKey="sante" name="Santé" domain={[0, 100]} tick={{ fill: "#5b6479", fontSize: 12 }}
                  label={{ value: "Score santé", angle: -90, position: "insideLeft", fill: "#5b6479", fontSize: 12 }} />
                <ZAxis type="number" dataKey="volume" range={[40, 400]} name="Volume 12 mois" />
                <ReferenceLine x={0} stroke="#7B859B" strokeDasharray="4 4" />
                <ReferenceLine y={65} stroke="#7B859B" strokeDasharray="4 4" />
                <ReferenceLine y={45} stroke="#7B859B" strokeDasharray="4 4" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                  const p = payload?.[0]?.payload as ReturnType<typeof points>[number] | undefined;
                  if (!p) return null;
                  return <div className="rounded-lg bg-minuit p-2 text-xs text-white"><strong>{p.nom}</strong><br />Santé {p.sante} · Évol. 90 j {p.nc ? "n.c. (pas de N-1)" : `${p.evol} %`}<br />Volume 12 mois {fmtEurCompact(p.volume)}</div>;
                }} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
                <Scatter name="Critique" legendType="triangle" data={points("Critique")} fill="#E5484D" shape="triangle" onClick={(p) => router.push(`/clients/${(p as unknown as { id: string }).id}`)} cursor="pointer" />
                <Scatter name="À surveiller" legendType="diamond" data={points("À surveiller")} fill="#F5A524" shape="diamond" onClick={(p) => router.push(`/clients/${(p as unknown as { id: string }).id}`)} cursor="pointer" />
                <Scatter name="Sain" legendType="circle" data={points("Sain")} fill="#1EDDAE" stroke="#0b7a5e" onClick={(p) => router.push(`/clients/${(p as unknown as { id: string }).id}`)} cursor="pointer" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
        {vue === "dynamique" && <p className="mt-1 text-xs text-gris-texte">Taille = volume 12 mois. Clients Fantômes exclus. Un client sans base N-1 est placé à 0 %. Cliquez sur un point pour ouvrir la fiche.</p>}
      </section>

      <section id="mes-clients" className="carte scroll-mt-4" aria-labelledby="liste-titre">
        <div className="flex flex-wrap items-end gap-3 border-b border-gris-clair p-4">
          <h2 id="liste-titre" className="mr-auto text-lg">Clients <span className="text-sm font-normal text-gris-texte">({filtered.length})</span></h2>
          <label className="relative">
            <span className="sr-only">Rechercher un client</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gris-texte" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="champ w-52 pl-8" />
          </label>
          <Filtre label="CSM" value={csm} onChange={setCsm} options={[["", "Tous les CSM"], ...(mesClients ? [[String(userId), "Mes clients"] as [string, string]] : []), ["aucun", "Sans CSM"], ...csms.filter((c) => c.id !== userId).map((c) => [String(c.id), c.nom] as [string, string])]} />
          <Filtre label="Segment" value={segment} onChange={setSegment} options={[["", "Tous segments"], ["Champion", "Champion"], ["À activer", "À activer"], ["À risque", "À risque"], ["Fantôme", "Fantôme"]]} />
          <Filtre label="Risque" value={risque} onChange={setRisque} options={[["", "Tous risques"], ["Critique", "Critique"], ["À surveiller", "À surveiller"], ["Sain", "Sain"]]} />
          <Filtre label="Usage" value={usage} onChange={setUsage} options={[["", "Tous usages"], ["Réservation en ligne", "Réservation en ligne"], ["Demandes / devis", "Demandes / devis"], ["Inactif", "Inactif"]]} />
          <Filtre label="Audit" value={audit} onChange={setAudit} options={[["", "Tous audits"], ["a_faire", "À faire"], ["en_cours", "En cours"], ["a_jour", "À jour (< 6 mois)"]]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gris-clair/50 text-xs text-gris-texte">
              <tr>
                <Th col="nom">Client</Th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">CSM</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Segment</th>
                <Th col="sante">Santé</Th>
                <th scope="col" className="px-3 py-2 text-left font-semibold" title="Score de maturité /100 et couverture de l'audit">Maturité</th>
                <Th col="audit">Dernier audit</Th>
                <Th col="volume" className="text-right">Volume 12 m</Th>
                <Th col="evol">Évol. 90 j</Th>
                <Th col="risque">Alerte principale</Th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-gris-clair hover:bg-horizon/[0.03]">
                  <td className="px-3 py-2">
                    <Link href={`/clients/${r.id}`} className="font-semibold text-minuit hover:text-horizon hover:underline">{r.nom}</Link>
                    <div className="text-xs text-gris-texte">{r.id}{r.groupe ? ` · ${r.groupe}` : ""}{r.m ? ` · ${r.m.usage}` : ""}</div>
                  </td>
                  <td className="px-3 py-2 text-gris-texte">{r.csm ?? "—"}</td>
                  <td className="px-3 py-2"><SegmentBadge segment={r.m?.segment} /></td>
                  <td className="px-3 py-2"><SanteJauge sante={r.m?.sante} /></td>
                  <td className="px-3 py-2"><MaturiteCell r={r} /></td>
                  <td className="px-3 py-2 text-gris-texte">{r.dernierAudit ? fmtDate(r.dernierAudit) : "Jamais"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtEurCompact(r.m?.volume_12m)}</td>
                  <td className="px-3 py-2"><Evol x={r.m?.evol_90j} /></td>
                  <td className="max-w-xs px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <RisqueBadge risque={r.m?.risque ?? (r.horsExport ? null : undefined)} />
                      {r.m?.alerte_principale && <span className="text-xs text-gris-texte">{r.m.alerte_principale}</span>}
                      {r.horsExport && <span className="text-xs text-gris-texte">Pas de dossiers dans l&apos;export</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable && (r.auditEnCours
                      ? <NouvelAudit clientId={r.id} enCours={r.auditEnCours} className="btn-secondaire whitespace-nowrap px-3 py-1.5 text-xs" />
                      : <LancerPreAudit clientId={r.id} nom={r.nom} urls={r.urls} className="btn-secondaire whitespace-nowrap px-3 py-1.5 text-xs" />)}
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={10} className="p-8 text-center text-gris-texte">Aucun client ne correspond à ces filtres.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-gris-clair p-3 text-xs text-gris-texte">Part du potentiel captée et opportunités sur la fiche client. {fmtPct(filtered.filter((r) => r.m?.risque === "Critique").length / Math.max(1, filtered.length))} des clients affichés sont critiques.</p>
      </section>
    </>
  );
}

function Filtre({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="libelle">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="champ w-40">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function MaturiteCell({ r }: { r: PortfolioRow }) {
  const m = r.maturite;
  if (!m || m.score === null) return <span className="text-gris-texte" title="Aucun audit finalisé">{r.auditEnCours ? "en cours" : "—"}</span>;
  return (
    <span className="inline-flex flex-col leading-tight" title={`Score de maturité ${Math.round(m.score)}/100, couverture ${Math.round(m.couverture * 100)} %${m.couverture < 0.7 ? " (non fiable)" : ""}`}>
      <span className="flex items-center gap-2"><span className="font-titres font-bold tabular-nums">{Math.round(m.score)}</span><MaturiteBadge score={m.score} court /></span>
      <span className={`text-xs ${m.couverture < 0.7 ? "text-rouge-texte" : "text-gris-texte"}`}>couv. {Math.round(m.couverture * 100)} %</span>
    </span>
  );
}

/** Vue clé : maturité (audit) × santé (données). */
function MatriceMaturite({ rows, onClick }: { rows: PortfolioRow[]; onClick: (id: string) => void }) {
  const pts = (niveau: string) => rows.filter((r) => r.m && r.maturite?.score !== null && r.maturite && r.m.risque === niveau).map((r) => ({
    id: r.id, nom: r.nom, maturite: Math.round(r.maturite!.score!), sante: r.m!.sante, volume: r.m!.volume_12m, couverture: r.maturite!.couverture,
  }));
  const n = rows.filter((r) => r.m && r.maturite?.score !== null && r.maturite).length;
  if (!n) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-center text-gris-texte">
        <Radar size={32} aria-hidden />
        <p className="max-w-md">Aucun client affiché n&apos;a d&apos;audit finalisé. La matrice montrera qui est mûr mais sous-performe, et qui performe malgré une faible maturité.</p>
      </div>
    );
  }
  type P = ReturnType<typeof pts>[number];
  return (
    <>
      <div className="relative h-80">
        <span className="pointer-events-none absolute right-6 top-8 z-10 rounded bg-white/80 px-1 text-xs text-gris-texte">Mûr et performant</span>
        <span className="pointer-events-none absolute bottom-12 right-6 z-10 rounded bg-white/80 px-1 text-xs font-semibold text-rouge-texte">Mûr mais sous-performe : problème commercial ou d&apos;usage</span>
        <span className="pointer-events-none absolute left-20 top-8 z-10 rounded bg-white/80 px-1 text-xs font-semibold text-horizon">Performe malgré une faible maturité : potentiel inexploité</span>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
            <CartesianGrid stroke="#E3E7EF" />
            <XAxis type="number" dataKey="maturite" name="Maturité" domain={[0, 100]} ticks={[0, 35, 73, 100]} tick={{ fill: "#5b6479", fontSize: 12 }}
              label={{ value: "Score de maturité (audit)", position: "insideBottom", offset: -15, fill: "#5b6479", fontSize: 12 }} />
            <YAxis type="number" dataKey="sante" name="Santé" domain={[0, 100]} tick={{ fill: "#5b6479", fontSize: 12 }}
              label={{ value: "Score santé (données)", angle: -90, position: "insideLeft", fill: "#5b6479", fontSize: 12 }} />
            <ZAxis type="number" dataKey="volume" range={[40, 400]} />
            <ReferenceLine x={35} stroke="#7B859B" strokeDasharray="4 4" />
            <ReferenceLine x={73} stroke="#7B859B" strokeDasharray="4 4" />
            <ReferenceLine y={45} stroke="#7B859B" strokeDasharray="4 4" />
            <ReferenceLine y={65} stroke="#7B859B" strokeDasharray="4 4" />
            <Tooltip content={({ payload }) => {
              const p = payload?.[0]?.payload as P | undefined;
              if (!p) return null;
              return <div className="rounded-lg bg-minuit p-2 text-xs text-white"><strong>{p.nom}</strong><br />Maturité {p.maturite}/100 (couverture {Math.round(p.couverture * 100)} %) · Santé {p.sante}<br />Volume 12 mois {fmtEurCompact(p.volume)}</div>;
            }} />
            <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
            <Scatter name="Critique" legendType="triangle" data={pts("Critique")} fill="#E5484D" shape="triangle" onClick={(p) => onClick((p as unknown as P).id)} cursor="pointer" />
            <Scatter name="À surveiller" legendType="diamond" data={pts("À surveiller")} fill="#F5A524" shape="diamond" onClick={(p) => onClick((p as unknown as P).id)} cursor="pointer" />
            <Scatter name="Sain" legendType="circle" data={pts("Sain")} fill="#1EDDAE" stroke="#0b7a5e" onClick={(p) => onClick((p as unknown as P).id)} cursor="pointer" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-gris-texte">{n} client{n > 1 ? "s" : ""} audité{n > 1 ? "s" : ""} (dernier audit finalisé). Seuils : maturité faible sous 35, avancée à partir de 73 ; santé 45 / 65. Taille = volume 12 mois.</p>
    </>
  );
}
