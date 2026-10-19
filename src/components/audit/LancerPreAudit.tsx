"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanSearch, X } from "lucide-react";

/**
 * « Lancer le pré-audit » : demande l'URL si elle manque, propose le choix s'il y en a plusieurs,
 * puis ouvre la vue de progression. Le scan continue même si l'on quitte la page.
 */
export function LancerPreAudit({ clientId, nom, urls, className = "btn-primaire", label = "Lancer le pré-audit" }: {
  clientId: string; nom: string; urls: string[]; className?: string; label?: string;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [url, setUrl] = useState(urls[0] ?? "");
  const [attente, setAttente] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dlg = useRef<HTMLDivElement>(null);

  async function lancer(u: string, nouvelle: boolean) {
    setAttente(true);
    setErr(null);
    const res = await fetch("/api/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, url: u, nouvelleUrl: nouvelle }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d.erreur ?? "Lancement impossible"); setAttente(false); setOuvert(true); return; }
    router.push(`/scans/${d.id}`);
  }

  useEffect(() => {
    if (!ouvert) return;
    dlg.current?.querySelector<HTMLElement>("input, button")?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOuvert(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [ouvert]);

  return (
    <>
      <button className={className} disabled={attente} onClick={() => (urls.length === 1 ? lancer(urls[0], false) : setOuvert(true))}>
        <ScanSearch size={14} aria-hidden /> {attente ? "Lancement…" : label}
      </button>
      {ouvert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-minuit/60 p-4" role="presentation" onClick={(e) => e.target === e.currentTarget && setOuvert(false)}>
          <div ref={dlg} role="dialog" aria-modal="true" aria-labelledby="pa-titre" className="carte w-full max-w-lg p-6 text-left shadow-xl">
            <div className="flex items-start justify-between">
              <h2 id="pa-titre" className="text-xl">Pré-audit — {nom}</h2>
              <button className="btn-discret -mr-2 -mt-1" onClick={() => setOuvert(false)} aria-label="Fermer"><X size={18} /></button>
            </div>
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void lancer(url, !urls.includes(url)); }}>
              {urls.length > 1 ? (
                <fieldset>
                  <legend className="text-sm">Ce client a plusieurs sites. Lequel auditer ?</legend>
                  <div className="mt-2 space-y-2">
                    {urls.map((u) => (
                      <label key={u} className="flex items-center gap-2 text-sm"><input type="radio" name="url" value={u} checked={url === u} onChange={() => setUrl(u)} className="accent-[#0A56FC]" /> {u}</label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <label className="flex flex-col gap-1 text-sm">
                  <span>Aucune URL n&apos;est enregistrée pour ce client. Saisissez l&apos;adresse de son site :</span>
                  <input className="champ" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.exemple.fr" required inputMode="url" />
                  <span className="text-xs text-gris-texte">Elle sera ajoutée à la fiche du client.</span>
                </label>
              )}
              {err && <p role="alert" className="text-sm text-rouge-texte">{err}</p>}
              <p className="text-xs text-gris-texte">Le scan prend 1 à 3 minutes. Vous pouvez quitter la page : il continue en tâche de fond et vous serez prévenu à la fin.</p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-discret" onClick={() => setOuvert(false)}>Annuler</button>
                <button className="btn-primaire" disabled={attente || !url}>Lancer →</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
