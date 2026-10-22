"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, GripVertical, Loader2, Sparkles, Trash2, X } from "lucide-react";
import {
  HORIZON, LIBELLE_PORTEUR, LIBELLE_SUIVI, PORTEURS, PRIORITES, SUIVIS, libelleEcheance, moisFrise, type Chantier,
} from "@/lib/restitution/feuille";
import { enregistrerFeuilleAction, proposerFeuilleAction, suiviChantierAction, validerFeuilleAction } from "@/app/(app)/clients/[id]/restitution/actions";

interface Props {
  clientId: string;
  editable: boolean;
  iaDisponible: boolean;
  equipes: string[];
  libelles: Record<string, string>;
  feuille: { statut: string; synthese: string; chantiers: Chantier[]; source: string | null; valideeLe: string | null } | null;
  avancement: Record<string, { faites: number; total: number }>;
}

const COUL: Record<string, string> = { haute: "bg-emeraude", moyenne: "bg-horizon", basse: "bg-lagon" };

/**
 * Feuille de route (lot C2) : Claude propose les chantiers, le CSM les ajuste — idéalement avec le client pendant
 * le rendez-vous — puis valide. Réordonner (glisser-déposer ou flèches), changer porteur et échéance, fusionner,
 * scinder (déplacer un critère vers un nouveau chantier), retirer un critère.
 */
export function FeuilleRoute({ clientId, editable, iaDisponible, equipes, libelles, feuille, avancement }: Props) {
  const [synthese, setSynthese] = useState(feuille?.synthese ?? "");
  const [ch, setCh] = useState<Chantier[]>(feuille?.chantiers ?? []);
  const [modifie, setModifie] = useState(false);
  const [glisse, setGlisse] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; erreur?: string } | null>(null);
  const validee = feuille?.statut === "validee" && !modifie;

  const maj = (f: (l: Chantier[]) => Chantier[]) => { setCh((l) => f(l)); setModifie(true); };
  const majCh = (i: number, p: Partial<Chantier>) => maj((l) => l.map((c, k) => {
    if (k !== i) return c;
    const n = { ...c, ...p };
    if (p.debut !== undefined || p.duree !== undefined) { n.duree = Math.min(n.duree, HORIZON - n.debut); n.echeance = libelleEcheance(n.debut, n.duree); }
    return n;
  }));
  const deplacer = (de: number, vers: number) => maj((l) => { const n = [...l]; const [x] = n.splice(de, 1); n.splice(vers, 0, x); return n; });
  const deplacerCritere = (i: number, id: string, cible: string) => maj((l) => {
    const n = l.map((c, k) => (k === i ? { ...c, criteres: c.criteres.filter((x) => x !== id) } : c));
    if (cible === "nouveau") n.splice(i + 1, 0, { ...l[i], id: `c${Date.now().toString(36)}`, titre: `${libelles[id]?.split(/[:(]/)[0].trim() ?? id}`, criteres: [id], suivi: "propose" });
    else { const t = n.findIndex((c) => c.id === cible); if (t >= 0) n[t] = { ...n[t], criteres: [...n[t].criteres, id] }; }
    return n.filter((c) => c.criteres.length);
  });
  const fusionner = (i: number, cible: string) => maj((l) => {
    const t = l.findIndex((c) => c.id === cible);
    if (t < 0) return l;
    const n = l.map((c, k) => (k === t ? { ...c, criteres: [...c.criteres, ...l[i].criteres] } : c));
    return n.filter((_, k) => k !== i);
  });
  const agir = (f: () => Promise<{ ok?: boolean; message?: string; erreur?: string } | null>, apres?: () => void) => start(async () => {
    const r = await f();
    if (r?.erreur) setMsg({ erreur: r.erreur }); else { setMsg({ ok: r?.message }); apres?.(); }
  });
  const proposer = () => {
    if (ch.length && !confirm("Remplacer la feuille de route actuelle par une nouvelle proposition ?")) return;
    agir(() => proposerFeuilleAction(clientId), () => { setModifie(false); location.reload(); });
  };
  const charge = { synthese, chantiers: ch };

  if (!feuille) {
    return (
      <section className="carte p-4" aria-labelledby="fdr-titre" id="feuille">
        <h2 id="fdr-titre" className="text-lg">Feuille de route</h2>
        <p className="mt-1 max-w-3xl text-sm text-gris-texte">Le livrable du rendez-vous : une synthèse rédigée et 3 à 6 chantiers (objectif, bénéfice, priorité, échéance, porteur, solution) sur 6 mois, à ajuster avec le client. Le CSV détaillé reste joint en annexe.</p>
        {editable && <button className="btn-primaire mt-3" onClick={proposer} disabled={pending}>{pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />} {pending ? "Proposition en cours (environ 30 s)…" : `Proposer la feuille de route${iaDisponible ? " avec Claude" : ""}`}</button>}
        {!iaDisponible && <p className="mt-2 text-xs text-gris-texte">Clé Anthropic absente : regroupement automatique par pilier et levier, synthèse par modèle.</p>}
        {msg?.erreur && <p role="alert" className="mt-2 text-sm text-rouge-texte">{msg.erreur}</p>}
      </section>
    );
  }

  const mois = moisFrise(feuille.valideeLe ? new Date(feuille.valideeLe) : new Date());
  return (
    <section className="carte p-4" aria-labelledby="fdr-titre" id="feuille">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="fdr-titre" className="text-lg">Feuille de route {validee ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emeraude/20 px-2 py-0.5 text-xs font-semibold"><CheckCircle2 size={12} aria-hidden /> validée le {new Date(feuille.valideeLe!).toLocaleDateString("fr-FR")}</span> : <span className="ml-2 rounded-full bg-ambre/20 px-2 py-0.5 text-xs font-semibold">brouillon</span>}</h2>
          <p className="text-xs text-gris-texte">Proposée {feuille.source?.startsWith("claude") ? "par Claude" : "par regroupement automatique"}{feuille.source?.includes("csm") ? ", ajustée par le CSM" : ""}. {validee ? "Le PDF, l'email et la présentation reprennent cette version." : "Elle n'apparaît dans le PDF qu'une fois validée."}</p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-discret" onClick={proposer} disabled={pending}><Sparkles size={14} aria-hidden /> Reproposer</button>
            {modifie && <button className="btn-secondaire" disabled={pending} onClick={() => agir(() => enregistrerFeuilleAction(clientId, charge), () => setModifie(false))}>Enregistrer</button>}
            {(!validee || modifie) && <button className="btn-primaire" disabled={pending} onClick={() => agir(() => validerFeuilleAction(clientId, charge), () => { setModifie(false); location.reload(); })}>{pending && <Loader2 size={14} className="animate-spin" aria-hidden />} Valider la feuille de route</button>}
          </div>
        )}
      </div>
      {msg?.ok && <p role="status" className="mt-2 text-sm text-[#0b7a5e]">{msg.ok}</p>}
      {msg?.erreur && <p role="alert" className="mt-2 text-sm text-rouge-texte">{msg.erreur}</p>}

      <label htmlFor="fdr-synthese" className="libelle mt-4 block">Synthèse (destinée au client)</label>
      <textarea id="fdr-synthese" rows={5} value={synthese} disabled={!editable} onChange={(e) => { setSynthese(e.target.value); setModifie(true); }} className="champ mt-1" />

      <ol className="mt-4 space-y-3">
        {ch.map((c, i) => (
          <li key={c.id} draggable={editable} onDragStart={() => setGlisse(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (glisse !== null && glisse !== i) deplacer(glisse, i); setGlisse(null); }}
            className={`rounded-lg border p-3 ${glisse === i ? "border-horizon bg-horizon/5" : "border-gris-clair"}`} aria-label={`Chantier ${i + 1} : ${c.titre}`}>
            <div className="flex flex-wrap items-start gap-2">
              {editable && <span className="flex flex-col items-center text-gris-texte"><GripVertical size={16} className="cursor-grab" aria-hidden />
                <button className="p-0.5 hover:text-horizon disabled:opacity-30" disabled={i === 0} onClick={() => deplacer(i, i - 1)} aria-label="Monter"><ArrowUp size={14} /></button>
                <button className="p-0.5 hover:text-horizon disabled:opacity-30" disabled={i === ch.length - 1} onClick={() => deplacer(i, i + 1)} aria-label="Descendre"><ArrowDown size={14} /></button></span>}
              <span className="font-titres text-xl font-bold text-horizon">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <input aria-label="Titre du chantier" value={c.titre} disabled={!editable} onChange={(e) => majCh(i, { titre: e.target.value })} className="champ font-semibold" />
                <div className="grid gap-2 md:grid-cols-2">
                  <textarea aria-label="Objectif" rows={2} value={c.objectif} disabled={!editable} onChange={(e) => majCh(i, { objectif: e.target.value })} placeholder="Objectif" className="champ text-sm" />
                  <textarea aria-label="Bénéfice pour le client" rows={2} value={c.benefice} disabled={!editable} onChange={(e) => majCh(i, { benefice: e.target.value })} placeholder="Bénéfice pour le client" className="champ text-sm" />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1">Priorité <select value={c.priorite} disabled={!editable} onChange={(e) => majCh(i, { priorite: e.target.value as Chantier["priorite"] })} className="champ w-auto py-1">{PRIORITES.map((p) => <option key={p}>{p}</option>)}</select></label>
                  <label className="flex items-center gap-1">Début <select value={c.debut} disabled={!editable} onChange={(e) => majCh(i, { debut: Number(e.target.value) })} className="champ w-auto py-1">{mois.map((m, k) => <option key={m} value={k}>{m}</option>)}</select></label>
                  <label className="flex items-center gap-1">Durée <select value={c.duree} disabled={!editable} onChange={(e) => majCh(i, { duree: Number(e.target.value) })} className="champ w-auto py-1">{Array.from({ length: HORIZON - c.debut }, (_, k) => <option key={k} value={k + 1}>{k + 1} mois</option>)}</select></label>
                  <label className="flex items-center gap-1">Échéance <input value={c.echeance} disabled={!editable} onChange={(e) => majCh(i, { echeance: e.target.value })} className="champ w-36 py-1" /></label>
                  <label className="flex items-center gap-1">Porteur <select value={c.porteur.type} disabled={!editable} onChange={(e) => majCh(i, { porteur: { type: e.target.value as Chantier["porteur"]["type"], nom: e.target.value === "equipe" ? equipes[0] ?? null : null } })} className="champ w-auto py-1">{PORTEURS.map((p) => <option key={p} value={p}>{LIBELLE_PORTEUR[p]}</option>)}</select></label>
                  {c.porteur.type === "equipe" && <select aria-label="Équipe Speedmedia" value={c.porteur.nom ?? ""} disabled={!editable} onChange={(e) => majCh(i, { porteur: { type: "equipe", nom: e.target.value } })} className="champ w-auto py-1">{equipes.map((q) => <option key={q}>{q}</option>)}</select>}
                  {c.porteur.type === "tiers" && <input aria-label="Nom du prestataire" value={c.porteur.nom ?? ""} disabled={!editable} onChange={(e) => majCh(i, { porteur: { type: "tiers", nom: e.target.value || null } })} placeholder="nom du prestataire" className="champ w-40 py-1" />}
                  <label className="flex items-center gap-1">Solution <input value={c.offre ?? ""} disabled={!editable} onChange={(e) => majCh(i, { offre: e.target.value || null })} className="champ w-56 py-1" /></label>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label="Critères du chantier">
                  {c.criteres.map((id) => (
                    <li key={id} className="inline-flex items-center gap-1 rounded-full bg-gris-clair px-2 py-0.5 text-xs" title={libelles[id]}>
                      <span className="font-semibold">{id}</span> {(libelles[id] ?? "").split(/[:(]/)[0].trim().slice(0, 45)}
                      {editable && <>
                        <select aria-label={`Déplacer ${id}`} value="" onChange={(e) => e.target.value && deplacerCritere(i, id, e.target.value)} className="ml-1 rounded border-0 bg-transparent text-xs text-horizon">
                          <option value="">déplacer…</option>
                          {ch.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>vers « {x.titre.slice(0, 30)} »</option>)}
                          <option value="nouveau">vers un nouveau chantier (scinder)</option>
                        </select>
                        <button onClick={() => maj((l) => l.map((x, k) => (k === i ? { ...x, criteres: x.criteres.filter((y) => y !== id) } : x)).filter((x) => x.criteres.length))} aria-label={`Retirer ${id}`} className="text-gris-texte hover:text-rouge-texte"><X size={12} /></button>
                      </>}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {validee && (
                    <label className="flex items-center gap-1">Suivi <select defaultValue={c.suivi} disabled={!editable} onChange={(e) => agir(() => suiviChantierAction(clientId, c.id, e.target.value))} className="champ w-auto py-0.5 text-xs">{SUIVIS.map((s) => <option key={s} value={s}>{LIBELLE_SUIVI[s]}</option>)}</select></label>
                  )}
                  {validee && avancement[c.id]?.total ? <span className="text-gris-texte">{avancement[c.id].faites} / {avancement[c.id].total} action(s) du plan faites</span> : null}
                  {editable && ch.length > 1 && (
                    <select aria-label="Fusionner avec" value="" onChange={(e) => e.target.value && fusionner(i, e.target.value)} className="champ w-auto py-0.5 text-xs">
                      <option value="">Fusionner avec…</option>{ch.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.titre.slice(0, 40)}</option>)}
                    </select>
                  )}
                  {editable && <button className="inline-flex items-center gap-1 text-gris-texte hover:text-rouge-texte" onClick={() => { if (confirm(`Retirer le chantier « ${c.titre} » ?`)) maj((l) => l.filter((_, k) => k !== i)); }}><Trash2 size={12} aria-hidden /> Retirer le chantier</button>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 overflow-x-auto">
        <p className="libelle">Calendrier sur {HORIZON} mois</p>
        <div className="mt-2 grid min-w-[640px] grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))] items-center gap-y-1.5 text-sm">
          <span />{mois.map((m) => <span key={m} className="text-center text-xs text-gris-texte">{m}</span>)}
          {ch.map((c, i) => (
            <div key={c.id} className="contents">
              <span className="truncate pr-2">{i + 1}. {c.titre}</span>
              <span className="col-span-6 grid grid-cols-6"><span className={`h-3 rounded-full ${COUL[c.priorite]}`} style={{ gridColumn: `${c.debut + 1} / span ${c.duree}` }} title={`${c.echeance} · ${c.porteur.type === "equipe" ? c.porteur.nom : LIBELLE_PORTEUR[c.porteur.type]}`} /></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
