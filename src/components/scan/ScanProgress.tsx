"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, CircleDashed, Clock, ExternalLink, HelpCircle, Image as ImageIcon, Loader2, X } from "lucide-react";
import type { Statut } from "@/lib/audit/score";
import { formatValeur } from "@/lib/audit/valeur";
import { StatutBadge } from "@/components/audit/StatutBadge";

interface Resultat {
  critereId: string; etat: string; statutPropose: Statut | null; valeur: string | null; texte: string | null; confiance: string | null; dureeMs: number | null;
  preuve: { texte?: string; url?: string; extrait?: string; requete?: string; capture?: string; source?: string } | null;
}
interface Etat {
  run: { id: number; clientId: string; auditId: number | null; url: string; statut: string; mode: string | null; message: string | null; debut: string | null; fin: string | null; createdAt: string };
  resultats: Resultat[];
  captures: { id: number; nom: string }[];
  criteres: Record<string, { critere: string; pilier: string; unite: string | null; legal: boolean } | undefined>;
}

const ETATS: Record<string, { l: string; I: typeof Check; c: string }> = {
  en_attente: { l: "En attente", I: Clock, c: "text-gris-texte" },
  en_cours: { l: "En cours", I: Loader2, c: "text-horizon" },
  ok: { l: "OK", I: Check, c: "text-[#0b7a5e]" },
  ko: { l: "KO", I: X, c: "text-rouge-texte" },
  non_verifiable: { l: "Non vérifiable", I: HelpCircle, c: "text-gris-texte" },
};
const CAPTURES: Record<string, string> = { "accueil-ordinateur": "Accueil — ordinateur", "accueil-mobile": "Accueil — mobile (390 px)", tunnel: "Tunnel de réservation (dernière étape atteinte)" };

/** Vue de progression en direct d'un pré-audit (rafraîchie toutes les 1,5 s). */
export function ScanProgress({ id, client }: { id: number; client: { id: string; nom: string } }) {
  const [e, setE] = useState<Etat | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const fini = e && !["en_attente", "en_cours"].includes(e.run.statut);

  useEffect(() => {
    let actif = true;
    const tick = async () => {
      const r = await fetch(`/api/scans/${id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (actif && r) setE(r);
      setMaintenant(Date.now());
    };
    void tick();
    const t = setInterval(() => { if (!fini) void tick(); }, 1500);
    return () => { actif = false; clearInterval(t); };
  }, [id, fini]);

  if (!e) return <div className="space-y-3"><div className="squelette h-10 w-1/2" /><div className="squelette h-64" /></div>;
  const n = e.resultats.length;
  const faits = e.resultats.filter((r) => !["en_attente", "en_cours"].includes(r.etat)).length;
  const debut = Date.parse(e.run.debut ?? e.run.createdAt);
  const duree = Math.round(((e.run.fin ? Date.parse(e.run.fin) : maintenant) - debut) / 1000);
  const compte = (et: string) => e.resultats.filter((r) => r.etat === et).length;

  return (
    <div className="space-y-4">
      <Link href={`/clients/${client.id}`} className="inline-flex items-center gap-1 text-sm text-horizon hover:underline"><ArrowLeft size={14} aria-hidden /> {client.nom}</Link>
      <header className="carte p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl">Pré-audit automatique — {client.nom}</h1>
            <p className="mt-1 text-sm text-gris-texte"><a href={e.run.url} target="_blank" rel="noopener noreferrer" className="text-horizon hover:underline">{e.run.url}</a>{e.run.mode && ` · ${e.run.mode === "navigateur" ? "navigateur headless" : "sans navigateur (mode dégradé)"}`}</p>
          </div>
          <div className="text-right text-sm" aria-live="polite">
            <p className="font-titres text-3xl font-bold tabular-nums">{faits}/{n}</p>
            <p className="text-gris-texte">{fini ? `Terminé en ${Math.floor(duree / 60)} min ${duree % 60} s` : e.run.statut === "en_attente" ? "En file d'attente…" : `En cours depuis ${duree} s`}{fini && duree > 180 ? " (objectif : 3 min)" : ""}</p>
          </div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-gris-clair" role="progressbar" aria-valuenow={faits} aria-valuemin={0} aria-valuemax={n} aria-label="Avancement du pré-audit">
          <div className="bg-degrade h-full transition-all" style={{ width: `${(faits / Math.max(1, n)) * 100}%` }} />
        </div>
        <p className="mt-2 text-sm"><span className="text-[#0b7a5e]">✓ {compte("ok")} OK</span> · <span className="text-rouge-texte">✗ {compte("ko")} KO</span> · <span className="text-gris-texte">? {compte("non_verifiable")} non vérifiables</span></p>
        {e.run.message && <p className={`mt-3 flex items-center gap-2 rounded-lg p-3 text-sm ${e.run.statut === "termine" ? "bg-gris-clair/60" : "bg-ambre/15"}`}><AlertTriangle size={16} aria-hidden /> {e.run.message}</p>}
        {!fini && <p className="mt-3 text-xs text-gris-texte">Vous pouvez quitter cette page : le scan continue et une notification vous préviendra à la fin.</p>}
        {fini && e.run.auditId && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/audits/${e.run.auditId}`} className="btn-primaire">Compléter l&apos;audit →</Link>
            <a href={`/api/audits/${e.run.auditId}/export?version=client`} className="btn-secondaire">Télécharger le pré-audit (CSV)</a>
          </div>
        )}
      </header>

      {e.captures.length > 0 && (
        <section className="carte p-4" aria-labelledby="captures-titre">
          <h2 id="captures-titre" className="text-lg">Captures</h2>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {e.captures.map((c) => (
              <a key={c.id} href={`/api/scans/captures/${c.id}`} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/scans/captures/${c.id}`} alt={CAPTURES[c.nom] ?? c.nom} className={`rounded-lg border border-gris-clair object-cover object-top ${c.nom.includes("mobile") ? "h-64 w-32" : "h-64 w-[26rem]"}`} />
                <span className="mt-1 block text-xs text-gris-texte">{CAPTURES[c.nom] ?? c.nom}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="carte" aria-labelledby="ctrl-titre">
        <h2 id="ctrl-titre" className="border-b border-gris-clair p-4 text-lg">Contrôles</h2>
        <ul>
          {e.resultats.map((r) => {
            const s = ETATS[r.etat] ?? ETATS.en_attente;
            const c = e.criteres[r.critereId];
            const cap = r.preuve?.capture ? e.captures.find((x) => x.nom === r.preuve!.capture) : null;
            const det = ouvert === r.critereId;
            return (
              <li key={r.critereId} className="border-t border-gris-clair first:border-t-0">
                <button className="grid w-full grid-cols-[7rem_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-horizon/[0.03]" onClick={() => setOuvert(det ? null : r.critereId)} aria-expanded={det} disabled={!r.texte}>
                  <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${s.c}`}><s.I size={15} className={r.etat === "en_cours" ? "animate-spin" : ""} aria-hidden />{s.l}</span>
                  <span className="min-w-0">
                    <span className="block text-xs text-gris-texte">{r.critereId}{c?.legal ? " · obligation légale" : ""}</span>
                    <span className="block truncate font-semibold">{c?.critere ?? r.critereId}</span>
                    {r.texte && <span className="block text-sm text-gris-texte">{r.texte}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {r.statutPropose && <StatutBadge statut={r.statutPropose} small />}
                    {r.confiance && r.etat !== "non_verifiable" && <span className="text-xs text-gris-texte">confiance {r.confiance}</span>}
                    {r.etat === "en_attente" && <CircleDashed size={14} className="text-gris-fonce" aria-hidden />}
                  </span>
                </button>
                {det && r.preuve && (
                  <div className="mx-4 mb-3 rounded-lg bg-gris-clair/50 p-3 text-sm">
                    <p className="libelle">Preuve</p>
                    <p className="mt-1">{r.preuve.texte}</p>
                    {r.valeur && c?.unite && <p className="mt-1">Valeur mesurée : <strong>{formatValeur(r.valeur, c?.unite)}</strong></p>}
                    {r.preuve.extrait && <blockquote className="mt-2 border-l-4 border-horizon/40 pl-3 text-xs text-gris-texte">{r.preuve.extrait}</blockquote>}
                    {r.preuve.requete && <p className="mt-1 break-all font-mono text-xs text-gris-texte">Requête : {r.preuve.requete.slice(0, 200)}</p>}
                    <p className="mt-2 flex flex-wrap gap-3">
                      {r.preuve.url && <a href={r.preuve.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-horizon hover:underline"><ExternalLink size={12} aria-hidden /> Page vérifiée</a>}
                      {cap && <a href={`/api/scans/captures/${cap.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-horizon hover:underline"><ImageIcon size={12} aria-hidden /> Capture d&apos;écran</a>}
                      {r.preuve.source && <span className="text-xs text-gris-texte">Source : {r.preuve.source}</span>}
                      {r.dureeMs !== null && <span className="text-xs text-gris-texte">{(r.dureeMs / 1000).toFixed(1).replace(".", ",")} s</span>}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
