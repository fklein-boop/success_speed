"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Loader2, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { anneeParDefaut, lireTableauTrafic, type LigneTrafic } from "@/lib/import/trafic";

interface Apercu {
  clients: { id: string; nom: string }[];
  lignes: (LigneTrafic & { clientId: string | null; score: number; sur: boolean; demo: boolean; total: number })[];
}

const fr = (k: string) => `${k.slice(5)}/${k.slice(0, 4)}`;

/**
 * Import du trafic mensuel (onglet « 4. Métriques GTM » ou fichier « nom du client | mois… ») :
 * lecture dans le navigateur, aperçu avec rapprochement des noms, validation.
 */
export function ImportTrafic({ reference }: { reference: string }) {
  const router = useRouter();
  const [fichier, setFichier] = useState<{ nom: string; rows: unknown[][]; onglet: string } | null>(null);
  const [annee, setAnnee] = useState<number>(Number(reference.slice(0, 4)));
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [mois, setMois] = useState<string[]>([]);
  const [etat, setEtat] = useState<{ chargement?: boolean; erreur?: string; ok?: string }>({});

  const analyser = async (rows: unknown[][], an: number) => {
    setEtat({ chargement: true });
    try {
      const t = lireTableauTrafic(rows, an);
      if (!t.lignes.length) throw new Error("Aucune ligne de trafic lue.");
      setMois(t.mois);
      const r = await fetch("/api/trafic/apercu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lignes: t.lignes }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erreur ?? "Aperçu impossible");
      setApercu(j);
      setChoix(Object.fromEntries((j as Apercu).lignes.map((l) => [l.nom, l.clientId ?? ""])));
      setEtat({});
    } catch (e) { setApercu(null); setEtat({ erreur: e instanceof Error ? e.message : "Lecture impossible" }); }
  };

  const lire = async (f: File) => {
    setEtat({ chargement: true });
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: false });
      const onglet = wb.SheetNames.find((n) => /gtm|trafic|visite|audience/i.test(n)) ?? wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[onglet], { header: 1, raw: true });
      const entete = rows.find((r) => r.length > 1) ?? [];
      const an = anneeParDefaut(entete.slice(1), reference);
      setFichier({ nom: f.name, rows, onglet });
      setAnnee(an);
      await analyser(rows, an);
    } catch (e) { setEtat({ erreur: e instanceof Error ? e.message : "Fichier illisible" }); }
  };

  const valider = async () => {
    if (!fichier || !apercu) return;
    setEtat({ chargement: true });
    const r = await fetch("/api/trafic/appliquer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      fichier: `${fichier.nom} (${fichier.onglet})`, lignes: apercu.lignes.map(({ nom, valeurs }) => ({ nom, valeurs })),
      correspondances: Object.fromEntries(apercu.lignes.map((l) => [l.nom, choix[l.nom] || null])),
    }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setEtat({ erreur: j.erreur ?? "Import impossible" }); return; }
    setEtat({ ok: `Trafic importé : ${j.clients} client(s), ${j.mois.length} mois (${fr(j.mois[0])} à ${fr(j.mois[j.mois.length - 1])}). Conversion et manque à gagner recalculés.` });
    setApercu(null); setFichier(null);
    router.refresh();
  };

  const rattachees = apercu ? apercu.lignes.filter((l) => choix[l.nom]).length : 0;
  return (
    <section className="carte p-4" aria-labelledby="trafic-titre">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="trafic-titre" className="flex items-center gap-2 text-lg"><BarChart3 size={18} className="text-horizon" aria-hidden /> Trafic mensuel des sites</h2>
          <p className="max-w-2xl text-sm text-gris-texte">Onglet « 4. Métriques GTM » du fichier Excel, ou tout tableau « nom du client | mois… ». Il sert à calculer la conversion (dossiers confirmés ÷ visites) et le manque à gagner. Les 0 sont lus comme « non mesuré ».</p>
        </div>
        <label className="btn-secondaire cursor-pointer">
          <Upload size={15} aria-hidden /> Choisir le fichier
          <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void lire(f); e.target.value = ""; }} />
        </label>
      </div>
      {etat.erreur && <p role="alert" className="mt-3 text-sm text-rouge-texte">{etat.erreur}</p>}
      {etat.ok && <p role="status" className="mt-3 text-sm text-[#0b7a5e]">{etat.ok}</p>}
      {etat.chargement && !apercu && <p className="mt-3 inline-flex items-center gap-2 text-sm text-gris-texte"><Loader2 size={14} className="animate-spin" aria-hidden /> Lecture…</p>}

      {apercu && fichier && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <p><strong>{fichier.nom}</strong> · onglet « {fichier.onglet} » · {apercu.lignes.length} ligne(s) · mois : {mois.map(fr).join(", ")}</p>
            <label className="flex items-center gap-2">Année des colonnes sans année
              <input type="number" min={2020} max={2100} value={annee} className="champ !w-24" onChange={(e) => { const a = Number(e.target.value); setAnnee(a); if (a > 2000) void analyser(fichier.rows, a); }} />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr><th className="px-3 py-2 font-semibold">Nom dans le fichier</th><th className="px-3 py-2 font-semibold">Visites ({mois.length} mois)</th><th className="px-3 py-2 font-semibold">Client</th></tr></thead>
              <tbody>
                {apercu.lignes.map((l) => (
                  <tr key={l.nom} className="border-t border-gris-clair">
                    <td className="px-3 py-1.5">{l.nom}{l.demo && <span className="ml-2 text-xs text-gris-texte">(compte de démonstration)</span>}</td>
                    <td className="px-3 py-1.5 tabular-nums">{l.total.toLocaleString("fr-FR")} <span className="text-xs text-gris-texte">({Object.keys(l.valeurs).length} mois mesurés)</span></td>
                    <td className="px-3 py-1.5">
                      <label className="sr-only" htmlFor={`t-${l.nom}`}>Client correspondant à « {l.nom} »</label>
                      <select id={`t-${l.nom}`} value={choix[l.nom] ?? ""} onChange={(e) => setChoix((c) => ({ ...c, [l.nom]: e.target.value }))} className="champ !w-auto !py-1">
                        <option value="">— Ignorer cette ligne —</option>
                        {apercu.clients.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.id})</option>)}
                      </select>
                      {choix[l.nom] && !l.sur && choix[l.nom] === l.clientId && <span className="ml-2 rounded bg-ambre/20 px-1.5 text-xs">à confirmer</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primaire" disabled={etat.chargement || !rattachees} onClick={valider}>{etat.chargement && <Loader2 size={14} className="animate-spin" aria-hidden />} Valider : {rattachees} ligne(s) rattachée(s)</button>
            <button className="btn-discret" onClick={() => { setApercu(null); setFichier(null); }}>Annuler</button>
            <span className="text-xs text-gris-texte">Vos choix de rattachement sont mémorisés pour les prochains imports.</span>
          </div>
        </div>
      )}
    </section>
  );
}
