"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Maximize2, Scale, Wrench, X } from "lucide-react";
import type { Presentation } from "@/lib/server/presentation";
import { fmtDate } from "@/lib/format";
import { moisFrise } from "@/lib/restitution/feuille";

/**
 * Présentation au client pendant le rendez-vous (lot B5) : plein écran, couleurs SpeedResa, gros caractères.
 * Flèches gauche / droite pour naviguer, F pour le plein écran, Échap pour sortir.
 */
export function PresentationClient({ p, retour }: { p: Presentation; retour: string }) {
  const router = useRouter();
  const total = p.piliers.length + 2;
  const [i, setI] = useState(0);
  const aller = useCallback((d: number) => setI((x) => Math.min(total - 1, Math.max(0, x + d))), [total]);
  const sortir = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen(); router.push(retour); }, [router, retour]);
  const pleinEcran = () => { void document.documentElement.requestFullscreen?.().catch(() => null); };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight" || ev.key === "PageDown" || ev.key === " ") { ev.preventDefault(); aller(1); }
      else if (ev.key === "ArrowLeft" || ev.key === "PageUp") { ev.preventDefault(); aller(-1); }
      else if (ev.key === "Escape" && !document.fullscreenElement) sortir();
      else if (ev.key.toLowerCase() === "f") pleinEcran();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aller, sortir]);

  const pilier = i >= 1 && i <= p.piliers.length ? p.piliers[i - 1] : null;
  const rond = (x: number | null) => (x === null ? "—" : Math.round(x));
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-minuit text-white" role="dialog" aria-modal="true" aria-label={`Présentation de l'audit de ${p.client}`}>
      <div className="flex items-center justify-between px-8 py-4 text-sm text-white/70">
        <span className="font-titres text-lg font-bold text-white">speed<span className="text-lagon">resa</span></span>
        <span>{p.client} · {p.preAudit ? "pré-audit" : "audit"} du {fmtDate(p.date)}</span>
        <span className="flex items-center gap-2">
          <button onClick={pleinEcran} className="rounded-full p-2 hover:bg-white/10" title="Plein écran (F)" aria-label="Plein écran"><Maximize2 size={18} /></button>
          <button onClick={sortir} className="rounded-full p-2 hover:bg-white/10" title="Quitter (Échap)" aria-label="Quitter la présentation"><X size={20} /></button>
        </span>
      </div>
      <div className="bg-degrade h-1" aria-hidden />

      <main className="flex flex-1 items-center justify-center overflow-y-auto px-8 py-10">
        {i === 0 && (
          <div className="max-w-4xl text-center">
            <p className="text-2xl text-white/70">Maturité numérique</p>
            <h1 className="mt-2 font-titres text-6xl font-bold">{p.client}</h1>
            <p className="mt-10 font-titres text-[9rem] font-bold leading-none tabular-nums">{rond(p.score)}<span className="text-4xl text-white/60">/100</span></p>
            {p.niveau && <p className="mt-4 text-3xl text-lagon">{p.niveau}</p>}
            {p.scoreVise !== null && p.score !== null && p.scoreVise > p.score && <p className="mt-6 text-2xl text-white/80">Objectif après le plan d&apos;action : <strong>{rond(p.scoreVise)}/100</strong></p>}
            {p.synthese && <p className="mx-auto mt-10 max-w-3xl text-xl leading-relaxed text-white/85">{p.synthese}</p>}
          </div>
        )}

        {pilier && (
          <div className="w-full max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <h1 className="font-titres text-5xl font-bold">{pilier.pilier}</h1>
              <div className="text-right">
                <p className="font-titres text-7xl font-bold tabular-nums">{rond(pilier.score)}<span className="text-3xl text-white/60">/100</span></p>
                {pilier.moyenne !== null && <p className="text-xl text-white/70">Moyenne des clients SpeedResa : {rond(pilier.moyenne)}/100</p>}
              </div>
            </div>
            <div className="mt-3 h-4 overflow-hidden rounded-full bg-white/15"><div className="bg-degrade h-full" style={{ width: `${pilier.score}%` }} /></div>
            <div className="mt-10 grid gap-10 lg:grid-cols-2">
              <section>
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-emeraude"><CheckCircle2 size={26} aria-hidden /> Ce qui est en place</h2>
                {pilier.enPlace.length ? <ul className="mt-4 space-y-3 text-xl">{pilier.enPlace.slice(0, 7).map((x) => <li key={x}>{x}</li>)}{pilier.enPlace.length > 7 && <li className="text-white/60">et {pilier.enPlace.length - 7} autre(s)</li>}</ul> : <p className="mt-4 text-xl text-white/60">Rien encore sur ce pilier.</p>}
                {pilier.enCours.length > 0 && <p className="mt-4 text-lg text-white/70">En cours : {pilier.enCours.join(", ")}</p>}
              </section>
              <section>
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-ambre"><Wrench size={26} aria-hidden /> Ce qui manque, et la solution</h2>
                {pilier.manque.length ? (
                  <ul className="mt-4 space-y-4 text-xl">
                    {pilier.manque.slice(0, 6).map((m) => (
                      <li key={m.critere}>
                        <p>{m.legal && <Scale size={18} className="mr-1 inline text-rouge" aria-label="Obligation légale" />}{m.critere}{m.partiel && <span className="text-white/60"> (en partie)</span>}</p>
                        {m.solution && <p className="mt-1 text-lg text-lagon">→ {m.solution}</p>}
                      </li>
                    ))}
                    {pilier.manque.length > 6 && <li className="text-white/60">et {pilier.manque.length - 6} autre(s) point(s)</li>}
                  </ul>
                ) : <p className="mt-4 text-xl text-white/60">Rien à signaler.</p>}
              </section>
            </div>
          </div>
        )}

        {i === total - 1 && p.feuille && (
          <div className="w-full max-w-6xl">
            <h1 className="font-titres text-5xl font-bold">Notre feuille de route</h1>
            <div className="mt-8 grid grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))] items-center gap-y-3 text-lg">
              <span />
              {moisFrise(p.feuille.valideeLe ? new Date(p.feuille.valideeLe) : new Date()).map((m) => <span key={m} className="text-center text-base text-white/60">{m}</span>)}
              {p.feuille.chantiers.map((c, k) => (
                <Fragment key={c.titre}>
                  <span className="pr-4"><span className="font-titres font-bold text-lagon">{k + 1}</span> {c.titre}<span className="block text-sm text-white/60">{c.porteur} · {c.echeance}{c.offre ? ` · ${c.offre}` : ""}</span></span>
                  <span className="col-span-6 grid grid-cols-6"><span className={`h-5 rounded-full ${c.priorite === "haute" ? "bg-emeraude" : c.priorite === "moyenne" ? "bg-horizon" : "bg-lagon/70"}`} style={{ gridColumn: `${c.debut + 1} / span ${c.duree}` }} /></span>
                </Fragment>
              ))}
            </div>
          </div>
        )}
        {i === total - 1 && !p.feuille && (
          <div className="w-full max-w-5xl">
            <h1 className="font-titres text-5xl font-bold">Nos priorités ensemble</h1>
            {p.priorites.length ? (
              <ol className="mt-8 space-y-4 text-2xl">
                {p.priorites.slice(0, 6).map((x, k) => <li key={x.critere} className="flex gap-4"><span className="font-titres font-bold text-lagon">{k + 1}</span><span>{x.critere}{x.offre && <span className="block text-lg text-white/70">{x.offre}</span>}</span></li>)}
              </ol>
            ) : <p className="mt-8 text-2xl text-white/80">Nous construisons ensemble le plan d&apos;action à partir des points ci-dessus.</p>}
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between px-8 py-4">
        <button onClick={() => aller(-1)} disabled={i === 0} className="flex items-center gap-2 rounded-full px-4 py-2 text-lg hover:bg-white/10 disabled:opacity-30"><ArrowLeft aria-hidden /> Précédent</button>
        <div className="flex gap-2" aria-label={`Diapositive ${i + 1} sur ${total}`}>{Array.from({ length: total }, (_, k) => <button key={k} onClick={() => setI(k)} aria-label={`Aller à la diapositive ${k + 1}`} className={`h-2.5 rounded-full transition-all ${k === i ? "w-8 bg-lagon" : "w-2.5 bg-white/30"}`} />)}</div>
        <button onClick={() => aller(1)} disabled={i === total - 1} className="flex items-center gap-2 rounded-full px-4 py-2 text-lg hover:bg-white/10 disabled:opacity-30">Suivant <ArrowRight aria-hidden /></button>
      </footer>
    </div>
  );
}
