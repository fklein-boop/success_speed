"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Search } from "lucide-react";

interface Apercu {
  clients: { id: string; nom: string }[];
  valeurs: { valeur: string; sessions: number; clientId: string | null; score: number; sur: boolean }[];
  nonRenseigne: number;
  periode: { startDate: string; endDate: string };
}

const fr = (k: string) => `${k.slice(5, 7)}/${k.slice(0, 4)}`;

/**
 * Rattachement des valeurs de « Nom du client » aux clients, puis synchronisation.
 * Les choix sont mémorisés (partagés avec l'import du fichier GTM) : le relevé mensuel automatique les réutilise.
 */
export function SynchroGa4({ pret }: { pret: boolean }) {
  const router = useRouter();
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [etat, setEtat] = useState<{ chargement?: "apercu" | "synchro"; erreur?: string; ok?: string }>({});

  const charger = async () => {
    setEtat({ chargement: "apercu" });
    const r = await fetch("/api/ga4/apercu");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setEtat({ erreur: j.erreur ?? "Lecture de Google Analytics impossible" }); return; }
    setApercu(j);
    setChoix(Object.fromEntries((j as Apercu).valeurs.map((v) => [v.valeur, v.clientId ?? ""])));
    setEtat({});
  };

  const synchroniser = async () => {
    setEtat({ chargement: "synchro" });
    const correspondances = apercu ? Object.fromEntries(apercu.valeurs.map((v) => [v.valeur, choix[v.valeur] || null])) : undefined;
    const r = await fetch("/api/ga4/synchroniser", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ correspondances }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setEtat({ erreur: j.erreur ?? "Synchronisation impossible" }); return; }
    setEtat({ ok: `Synchronisé : ${j.clients} client(s)${j.mois.length ? `, ${j.mois.length} mois (${fr(j.mois[0])} à ${fr(j.mois.at(-1))})` : ""}. Conversion, abandon panier et manque à gagner recalculés.${j.enAttente.length ? ` ${j.enAttente.length} valeur(s) restent à rattacher.` : ""}` });
    setApercu(null);
    router.refresh();
  };

  const rattachees = apercu ? apercu.valeurs.filter((v) => choix[v.valeur]).length : 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-secondaire" disabled={!pret || !!etat.chargement} onClick={charger}>
          {etat.chargement === "apercu" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />} Vérifier les rattachements
        </button>
        <button className="btn-primaire" disabled={!pret || !!etat.chargement} onClick={synchroniser}>
          {etat.chargement === "synchro" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} {apercu ? `Valider et synchroniser (${rattachees} rattachée(s))` : "Synchroniser maintenant"}
        </button>
      </div>
      {etat.erreur && <p role="alert" className="text-sm text-rouge-texte">{etat.erreur}</p>}
      {etat.ok && <p role="status" className="text-sm text-[#0b7a5e]">{etat.ok}</p>}

      {apercu && (
        <div className="space-y-2">
          <p className="text-sm text-gris-texte">
            {apercu.valeurs.length} valeur(s) de « Nom du client » du {apercu.periode.startDate.split("-").reverse().join("/")} au {apercu.periode.endDate.split("-").reverse().join("/")}.
            {apercu.nonRenseigne > 0 && ` ${apercu.nonRenseigne.toLocaleString("fr-FR")} session(s) sans nom du client (non comptées).`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr><th className="px-3 py-2 font-semibold">Nom du client (GA4)</th><th className="px-3 py-2 font-semibold">Sessions (13 mois)</th><th className="px-3 py-2 font-semibold">Client</th></tr></thead>
              <tbody>
                {apercu.valeurs.map((v) => (
                  <tr key={v.valeur} className="border-t border-gris-clair">
                    <td className="px-3 py-1.5">{v.valeur}</td>
                    <td className="px-3 py-1.5 tabular-nums">{v.sessions.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-1.5">
                      <label className="sr-only" htmlFor={`g-${v.valeur}`}>Client correspondant à « {v.valeur} »</label>
                      <select id={`g-${v.valeur}`} value={choix[v.valeur] ?? ""} onChange={(e) => setChoix((c) => ({ ...c, [v.valeur]: e.target.value }))} className="champ !w-auto !py-1">
                        <option value="">— Ignorer —</option>
                        {apercu.clients.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.id})</option>)}
                      </select>
                      {choix[v.valeur] && !v.sur && choix[v.valeur] === v.clientId && <span className="ml-2 rounded bg-ambre/20 px-1.5 text-xs">à confirmer</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gris-texte">Vos choix sont mémorisés : le relevé automatique du 2 de chaque mois les réutilise. Une nouvelle valeur incertaine reste « à rattacher » jusqu&apos;à votre validation.</p>
        </div>
      )}
    </div>
  );
}
