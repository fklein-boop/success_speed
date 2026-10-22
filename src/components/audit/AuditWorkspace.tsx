"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, CheckCheck, ChevronLeft, Copy, Download, ExternalLink, FileCheck2, Keyboard, Loader2, Lock, Presentation, RotateCcw, Scale, Search, Send, UserPlus, Users,
} from "lucide-react";
import { GUIDES, lienGuide, statutComptage } from "@/lib/audit/guides";
import { repartitionParDefaut, type Repondant } from "@/lib/audit/repartition";
import { creerQuestionnaireAction } from "@/app/(app)/clients/[id]/questionnaire-actions";
import {
  compareCriteres, computeScore, SEUIL_FIABILITE, statutFromSeuil, type EvalScore, type Statut,
} from "@/lib/audit/score";
import { commentaireRequis } from "@/lib/audit/regles";
import { formatValeur, parseValeurSaisie, texteSeuil, valeurPourSaisie } from "@/lib/audit/valeur";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { MaturiteBadge, StatutBadge } from "./StatutBadge";

// ───────── Types sérialisés reçus du serveur ─────────
interface Critere {
  id: string; version: number; pilier: string; critere: string; commentVerifier: string | null; source: string; type: string;
  sens: string | null; seuilPlein: number | null; seuilMoitie: number | null; unite: string | null; points: number;
  obligationLegale: boolean; offreSiNon: string | null; questionClient: string | null;
}
interface PreuveData { texte: string; periode?: string; source?: string; url?: string; extrait?: string; requete?: string; captureId?: number | null }
interface Proposition { statut: Statut | null; valeur: number | null; texte: string; confiance: string; source?: string; preuve?: PreuveData }
interface Evaluation {
  id: number; critereId: string; statut: Statut | null; valeur: string | null; source: string | null; confiance: string | null;
  commentaire: string | null; aEnvoyerClient: boolean; proposition: Proposition | null; preuve: unknown; auteurId: number | null; updatedAt: string;
}
interface Audit { id: number; clientId: string; date: string; statut: string; auteurId: number | null; assigneA: number | null; urlAuditee: string | null; mention: string | null; origine: string; note: string | null }
interface State {
  audit: Audit; client: { id: string; nom: string }; criteres: Critere[]; evaluations: Evaluation[];
  precedent: { audit: Audit; evaluations: Evaluation[] } | null;
  users: { id: number; nom: string | null; email: string; role: string; actif: boolean }[];
}
type Mode = "recap" | "A" | "B" | "vue";
/** Données complémentaires : exports disponibles, fiche Google, questionnaire client en cours */
interface Extra {
  exports: string[];
  placeId: string | null;
  questionnaire: { statut: string; lien: string | null; email: string | null; questions: string[]; envoyeLe: string | null; reponduLe: string | null } | null;
}

const TOUCHES: Record<string, Statut> = { o: "OUI", n: "NON", p: "PARTIELLEMENT", c: "CORRIGÉ", a: "N.A." };
const BOUTONS: { s: Statut; k: string; l: string; cls: string }[] = [
  { s: "OUI", k: "O", l: "OUI", cls: "border-emeraude bg-emeraude/15 hover:bg-emeraude/30" },
  { s: "PARTIELLEMENT", k: "P", l: "PARTIELLEMENT", cls: "border-ambre bg-ambre/15 hover:bg-ambre/30" },
  { s: "NON", k: "N", l: "NON", cls: "border-rouge bg-rouge/10 hover:bg-rouge/20" },
  { s: "CORRIGÉ", k: "C", l: "CORRIGÉ", cls: "border-horizon bg-horizon/10 hover:bg-horizon/20" },
  { s: "N.A.", k: "A", l: "N.A.", cls: "border-gris-fonce bg-gris-clair/60 hover:bg-gris-clair" },
];

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { erreur?: string } }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

export function AuditWorkspace({ initial, extra, me, editable: peutEditer }: { initial: State; extra: Extra; me: { id: number; role: string }; editable: boolean }) {
  const router = useRouter();
  const { audit, client, criteres, precedent, users } = initial;
  const crit = useMemo(() => [...criteres].sort(compareCriteres), [criteres]);
  const critById = useMemo(() => new Map(crit.map((c) => [c.id, c])), [crit]);
  const nomDe = useCallback((id: number | null) => { const u = users.find((x) => x.id === id); return u ? u.nom || u.email : "—"; }, [users]);
  const [statutAudit, setStatutAudit] = useState(audit.statut);
  const editable = peutEditer && statutAudit === "brouillon";

  const [evals, setEvals] = useState(() => new Map(initial.evaluations.map((e) => [e.critereId, e])));
  const prec = useMemo(() => new Map((precedent?.evaluations ?? []).map((e) => [e.critereId, e])), [precedent]);

  const propsEnAttente = crit.filter((c) => { const e = evals.get(c.id); return e && e.statut === null && e.proposition && !e.aEnvoyerClient; });
  const sures = propsEnAttente.filter((c) => evals.get(c.id)!.confiance === "haute" && evals.get(c.id)!.proposition?.statut);
  const aVerifier = propsEnAttente.filter((c) => !sures.includes(c));
  const fileB = crit.filter((c) => { const e = evals.get(c.id); return !e || (e.statut === null && !e.aEnvoyerClient && !e.proposition); });
  const envoyes = crit.filter((c) => evals.get(c.id)?.aEnvoyerClient && !evals.get(c.id)?.statut);

  // Une fois les deux étapes faites, l'audit s'ouvre sur le récapitulatif (lot B4)
  const [mode, setMode] = useState<Mode>(() => (statutAudit !== "brouillon" ? "vue" : propsEnAttente.length ? "A" : fileB.length ? "B" : "recap"));
  const valides = crit.filter((c) => { const e = evals.get(c.id); return !!e?.statut && !!e.proposition; });
  const domaine = (() => { try { return audit.urlAuditee ? new URL(audit.urlAuditee).hostname.replace(/^www\./, "") : null; } catch { return null; } })();
  const pagesSociales = ((evals.get("VIS-01")?.proposition?.preuve?.extrait ?? "") as string).split("\n").filter((l) => /^https?:\/\//.test(l));
  const ctxCarte = { auditId: audit.id, site: audit.urlAuditee, domaine, nom: client.nom, placeId: extra.placeId, pagesSociales };
  const [focusId, setFocusId] = useState<string | null>(() => fileB[0]?.id ?? null);
  const [aide, setAide] = useState(false);
  const [message, setMessage] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [presents, setPresents] = useState<{ userId: number; critereId: string | null; nom: string | null; email: string }[]>([]);
  const [conflit, setConflit] = useState<{ critereId: string; theirs: Evaluation; mine: Parameters<typeof enregistrer>[0] } | null>(null);

  // ───────── Score en direct ─────────
  const score = useMemo(() => {
    const m = new Map<string, EvalScore>([...evals].map(([k, e]) => [k, { statut: e.statut }]));
    return computeScore(crit.map((c) => ({ ...c })), m);
  }, [evals, crit]);

  // ───────── Enregistrement ─────────
  const enregistrer = useCallback(async (input: { critereId: string; statut: Statut | null; valeur: number | null; commentaire: string | null; aEnvoyerClient: boolean; force?: boolean }) => {
    const avant = evals.get(input.critereId);
    const optimiste: Evaluation = {
      id: avant?.id ?? -1, critereId: input.critereId, statut: input.statut, valeur: input.valeur === null ? avant?.valeur ?? null : String(input.valeur),
      source: avant?.source ?? "csm", confiance: avant?.confiance ?? null, commentaire: input.commentaire, aEnvoyerClient: input.aEnvoyerClient,
      proposition: avant?.proposition ?? null, preuve: avant?.preuve ?? null, auteurId: me.id, updatedAt: avant?.updatedAt ?? new Date(0).toISOString(),
    };
    setEvals((m) => new Map(m).set(input.critereId, optimiste));
    const r = await post<{ evaluation: Evaluation; erreur?: string }>(`/api/audits/${audit.id}/evaluations`, { ...input, base: avant?.updatedAt ?? null });
    if (r.ok) {
      setEvals((m) => new Map(m).set(input.critereId, r.data.evaluation));
      return true;
    }
    if (avant) setEvals((m) => new Map(m).set(input.critereId, avant)); else setEvals((m) => { const n = new Map(m); n.delete(input.critereId); return n; });
    if (r.status === 409 && (r.data as { evaluation?: Evaluation }).evaluation) {
      const theirs = (r.data as { evaluation: Evaluation }).evaluation;
      setEvals((m) => new Map(m).set(input.critereId, theirs));
      setConflit({ critereId: input.critereId, theirs, mine: input });
      setMode("B");
      setFocusId(input.critereId);
    }
    setMessage({ t: "err", m: r.data.erreur ?? "Enregistrement impossible" });
    return false;
  }, [audit.id, evals, me.id]);

  const suivant = useCallback((depuis: string | null, sens: 1 | -1 = 1) => {
    if (!fileB.length) return null;
    const idx = depuis ? crit.findIndex((c) => c.id === depuis) : -1;
    const ordre = sens === 1 ? [...crit.slice(idx + 1), ...crit.slice(0, idx + 1)] : [...crit.slice(0, Math.max(0, idx)).reverse(), ...crit.slice(idx).reverse()];
    return ordre.find((c) => c.id !== depuis && fileB.some((f) => f.id === c.id))?.id ?? null;
  }, [crit, fileB]);

  // ───────── Synchronisation avec les collègues (toutes les 6 s) ─────────
  const derniereSync = useRef(new Date().toISOString());
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  useEffect(() => {
    let actif = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/audits/${audit.id}/sync?depuis=${encodeURIComponent(derniereSync.current)}&critere=${focusRef.current ?? ""}`);
        if (!res.ok || !actif) return;
        const d = await res.json() as { maintenant: string; presents: typeof presents; changes: Evaluation[]; audit: { statut: string } };
        derniereSync.current = d.maintenant;
        setPresents(d.presents);
        if (d.changes.length) {
          setEvals((m) => {
            const n = new Map(m);
            for (const e of d.changes) {
              const local = n.get(e.critereId);
              if (!local || new Date(e.updatedAt) > new Date(local.updatedAt)) n.set(e.critereId, e);
            }
            return n;
          });
        }
        if (d.audit && d.audit.statut !== statutAudit) { setStatutAudit(d.audit.statut); router.refresh(); }
      } catch { /* réseau : on réessaie au prochain tour */ }
    };
    void tick();
    const t = setInterval(tick, 6000);
    return () => { actif = false; clearInterval(t); };
  }, [audit.id, statutAudit, router]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || ev.metaKey || ev.ctrlKey) return;
      if (ev.key.toLowerCase() === "h") setAide((x) => !x);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ───────── Actions globales ─────────
  async function validerSures() {
    const r = await post<{ valides: string[] }>(`/api/audits/${audit.id}/valider`, {});
    if (!r.ok) return setMessage({ t: "err", m: r.data.erreur ?? "Erreur" });
    setMessage({ t: "ok", m: `${r.data.valides.length} résultats validés.` });
    derniereSync.current = new Date(0).toISOString(); // forcer le rechargement des évaluations
    const s = await fetch(`/api/audits/${audit.id}/sync?depuis=${derniereSync.current}`).then((x) => x.json());
    setEvals((m) => { const n = new Map(m); for (const e of s.changes as Evaluation[]) n.set(e.critereId, e); return n; });
    derniereSync.current = s.maintenant;
    if (!aVerifier.length) { setMode("B"); setFocusId(fileB[0]?.id ?? null); }
  }

  async function finaliser() {
    const avert = score.couverture < SEUIL_FIABILITE ? `\n\nAttention : couverture de ${Math.round(score.couverture * 100)} %. Le score n'est fiable qu'à partir de 70 %.` : "";
    if (!window.confirm(`Finaliser l'audit de ${client.nom} ?${avert}`)) return;
    const r = await post(`/api/audits/${audit.id}/finaliser`, {});
    if (!r.ok) return setMessage({ t: "err", m: r.data.erreur ?? "Erreur" });
    setStatutAudit("finalise");
    setMode("vue");
    setMessage({ t: "ok", m: "Audit finalisé. Prochaine étape : la feuille de route du client (Livrables → Version client)." });
    router.refresh();
  }

  async function rouvrir() {
    const r = await post(`/api/audits/${audit.id}/rouvrir`, {});
    if (!r.ok) return setMessage({ t: "err", m: r.data.erreur ?? "Erreur" });
    setStatutAudit("brouillon");
    router.refresh();
  }

  async function confier(userId: number) {
    const r = await post(`/api/audits/${audit.id}/confier`, { userId });
    setMessage(r.ok ? { t: "ok", m: `Audit confié à ${nomDe(userId)}.` } : { t: "err", m: r.data.erreur ?? "Erreur" });
  }

  const coll = users.filter((u) => u.actif && u.role !== "lecture");
  const prog = crit.filter((c) => { const e = evals.get(c.id); return e?.statut; }).length;

  return (
    <div className="space-y-4">
      <Link href={`/clients/${client.id}`} className="inline-flex items-center gap-1 text-sm text-horizon hover:underline"><ArrowLeft size={14} aria-hidden /> {client.nom}</Link>

      {/* ───────── En-tête collant : score en direct, progression, couverture ───────── */}
      <header className="carte z-20 p-4 shadow-sm lg:sticky lg:top-0">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl">Audit — {client.nom}</h1>
            <p className="text-sm text-gris-texte">
              {fmtDate(audit.date)} · {statutAudit === "brouillon" ? "En cours" : "Finalisé"} · assigné à {nomDe(audit.assigneA)}
              {audit.urlAuditee && <> · <a href={audit.urlAuditee} target="_blank" rel="noopener noreferrer" className="text-horizon hover:underline">{audit.urlAuditee.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></>}
            </p>
          </div>
          <div className="flex items-baseline gap-2" aria-live="polite" title="Score de maturité : points obtenus ÷ points des critères évalués">
            <span className="font-titres text-4xl font-bold tabular-nums">{score.score === null ? "—" : Math.round(score.score)}</span>
            <span className="text-sm text-gris-texte">/100</span>
            <span className="ml-2"><MaturiteBadge score={score.score} /></span>
          </div>
          <div className="text-sm" title="Score visé si les points CORRIGÉ sont réalisés">
            <span className="libelle block">Après actions</span>
            <span className="font-titres text-lg font-bold tabular-nums">{score.scoreApres === null ? "—" : Math.round(score.scoreApres)}</span>
          </div>
          <div className="min-w-48 flex-1">
            <div className="flex justify-between text-xs"><span className="libelle">Couverture</span><span className={`font-semibold ${score.fiable ? "" : "text-rouge-texte"}`}>{Math.round(score.couverture * 100)} % {score.fiable ? "· fiable" : "· < 70 %, non fiable"}</span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-gris-clair" role="progressbar" aria-valuenow={Math.round(score.couverture * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Couverture de l'audit">
              <div className="bg-degrade h-full transition-all" style={{ width: `${score.couverture * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-gris-texte">{prog} / {crit.length} critères renseignés · {envoyes.length} envoyé{envoyes.length > 1 ? "s" : ""} au client</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {presents.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-lagon/20 px-2.5 py-1 text-xs" title={presents.map((p) => `${p.nom || p.email} — ${p.critereId ?? "vue d'ensemble"}`).join("\n")}>
                <Users size={12} aria-hidden /> {presents.map((p) => (p.nom || p.email).split(/[ @]/)[0]).join(", ")} {presents.length > 1 ? "travaillent" : "travaille"} aussi sur cet audit
              </span>
            )}
            <details className="relative">
              <summary className="btn-discret cursor-pointer list-none"><Download size={14} aria-hidden /> Livrables</summary>
              <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-gris-clair bg-white p-2 text-sm shadow-lg">
                <a className="block rounded px-3 py-2 font-semibold hover:bg-gris-clair" href={`/clients/${client.id}/restitution#feuille`}>Version client : feuille de route →</a>
                <a className="block rounded px-3 py-2 hover:bg-gris-clair" href={`/api/audits/${audit.id}/export?version=client`}>Annexe détaillée (CSV client)</a>
                <a className="block rounded px-3 py-2 hover:bg-gris-clair" href={`/api/audits/${audit.id}/export?version=interne`}>Version interne <span className="text-xs text-gris-texte">(preuves, auteurs)</span></a>
              </div>
            </details>
            {editable && coll.length > 1 && (
              <label className="inline-flex items-center gap-1 text-sm">
                <UserPlus size={14} aria-hidden className="text-gris-texte" /><span className="sr-only">Confier l&apos;audit à</span>
                <select className="champ w-40 py-1" value="" onChange={(e) => e.target.value && confier(Number(e.target.value))}>
                  <option value="">Confier à…</option>
                  {coll.filter((u) => u.id !== audit.assigneA).map((u) => <option key={u.id} value={u.id}>{u.nom || u.email}</option>)}
                </select>
              </label>
            )}
            {editable && <button className="btn-primaire" onClick={finaliser}><FileCheck2 size={16} aria-hidden /> Finaliser</button>}
            {!editable && statutAudit === "finalise" && peutEditer && <button className="btn-secondaire" onClick={rouvrir}><RotateCcw size={14} aria-hidden /> Rouvrir</button>}
            <button className="btn-discret" onClick={() => setAide((x) => !x)} aria-expanded={aide} title="Raccourcis clavier (H)"><Keyboard size={16} aria-hidden /><span className="sr-only">Raccourcis clavier</span></button>
          </div>
        </div>
        {aide && <AideClavier />}
        {audit.mention && <p className="mt-3 rounded-lg bg-ambre/15 px-3 py-2 text-sm">{audit.mention}</p>}
        {message && <p role={message.t === "err" ? "alert" : "status"} className={`mt-3 text-sm ${message.t === "err" ? "text-rouge-texte" : "text-[#0b7a5e]"}`}>{message.m}</p>}
      </header>

      {/* ───────── Onglets ───────── */}
      <div role="tablist" aria-label="Étapes de l'audit" className="flex flex-wrap gap-2">
        <Onglet actif={mode === "recap"} onClick={() => setMode("recap")}>Où en est l&apos;audit</Onglet>
        {editable && <Onglet actif={mode === "A"} onClick={() => setMode("A")}>A. Valider l&apos;automatique <Compteur n={propsEnAttente.length} /></Onglet>}
        {editable && <Onglet actif={mode === "B"} onClick={() => { setMode("B"); if (!focusId || !fileB.some((f) => f.id === focusId)) setFocusId(fileB[0]?.id ?? null); }}>B. Répondre au reste <Compteur n={fileB.length} /></Onglet>}
        <Onglet actif={mode === "vue"} onClick={() => setMode("vue")}>Vue d&apos;ensemble par pilier</Onglet>
      </div>

      {(mode === "A" || mode === "B") && editable && <PiliersMini piliers={score.piliers} />}

      {mode === "recap" && (
        <Recapitulatif score={score} aValider={propsEnAttente} fileB={fileB} envoyes={envoyes} evals={evals} questionnaire={extra.questionnaire} catalogue={extra.exports.includes("catalogue")}
          onAller={(m, id) => { setMode(m); if (id) setFocusId(id); }} />
      )}

      {mode === "A" && editable && (
        <EtapeA client={client.nom} sures={sures} aVerifier={aVerifier} valides={valides} evals={evals} nomDe={nomDe} onValiderSures={validerSures}
          onConfirmer={(c) => { const e = evals.get(c.id)!; void enregistrer({ critereId: c.id, statut: e.proposition!.statut, valeur: e.proposition!.valeur, commentaire: e.commentaire, aEnvoyerClient: false }); }}
          onCorriger={(c) => { setMode("B"); setFocusId(c.id); }} />
      )}

      {mode === "B" && editable && (
        <Repartition auditId={audit.id} clientId={client.id} restants={fileB} questionnaire={extra.questionnaire} catalogue={extra.exports.includes("catalogue")}
          onEnvoye={(ids) => { setEvals((m) => { const n = new Map(m); for (const id of ids) { const e = n.get(id); n.set(id, { ...(e ?? { id: -1, critereId: id, statut: null, valeur: null, source: null, confiance: null, commentaire: null, proposition: null, preuve: null, auteurId: me.id, updatedAt: new Date().toISOString() }), aEnvoyerClient: true }); } return n; }); if (focusId && ids.includes(focusId)) setFocusId(suivant(focusId)); router.refresh(); }} />
      )}

      {mode === "B" && editable && (
        focusId && critById.get(focusId) ? (
          <Carte key={focusId} ctx={ctxCarte} c={critById.get(focusId)!} e={evals.get(focusId) ?? null} prec={prec.get(focusId) ?? null} precDate={precedent?.audit.date ?? null}
            restants={fileB.length} conflit={conflit?.critereId === focusId ? conflit : null} nomDe={nomDe}
            presentsIci={presents.filter((p) => p.critereId === focusId)}
            onResoudre={async (garder) => {
              if (!conflit) return;
              if (garder === "mienne") await enregistrer({ ...conflit.mine, force: true });
              setConflit(null);
            }}
            onRepondre={async (input) => {
              const ok = await enregistrer({ critereId: focusId, ...input });
              if (ok) { setMessage(null); setFocusId(suivant(focusId)); }
              return ok;
            }}
            onPasser={(sens) => setFocusId(suivant(focusId, sens) ?? focusId)} />
        ) : (
          <div className="carte p-10 text-center">
            <CheckCheck className="mx-auto text-emeraude" size={36} aria-hidden />
            <p className="mt-3 text-lg font-semibold">Tous les critères ont une réponse ou sont confiés au client.</p>
            <p className="mt-1 text-gris-texte">Vérifiez la vue d&apos;ensemble, puis finalisez l&apos;audit.</p>
            <button className="btn-secondaire mt-4" onClick={() => setMode("vue")}>Vue d&apos;ensemble</button>
          </div>
        )
      )}

      {mode === "vue" && (
        <VueEnsemble crit={crit} evals={evals} prec={prec} score={score} nomDe={nomDe} editable={editable} presentation={`/clients/${client.id}/presentation?audit=${audit.id}`}
          onOuvrir={(id) => { setMode("B"); setFocusId(id); }} />
      )}
    </div>
  );
}

function Onglet({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button role="tab" aria-selected={actif} onClick={onClick} className={`rounded-full px-4 py-2 text-sm ${actif ? "bg-minuit font-semibold text-white" : "bg-white text-minuit hover:bg-gris-clair"}`}>{children}</button>;
}
const Compteur = ({ n }: { n: number }) => <span className="ml-1 rounded-full bg-horizon px-1.5 text-xs text-white">{n}</span>;

function AideClavier() {
  const l: [string, string][] = [["O", "OUI"], ["N", "NON"], ["P", "PARTIELLEMENT"], ["C", "CORRIGÉ"], ["A", "Non applicable"], ["I", "Inchangé depuis le dernier audit"], ["?", "Envoyer au client (questionnaire)"], ["→ / ←", "Passer / revenir"], ["Entrée", "Dans le champ valeur : retenir le statut calculé"], ["Ctrl + Entrée", "Dans le commentaire : enregistrer"], ["H", "Afficher / masquer cette aide"]];
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-gris-clair/50 p-3 text-sm md:grid-cols-4">
      {l.map(([k, v]) => <div key={k} className="flex items-center gap-2"><dt><kbd className="rounded border border-gris-fonce/40 bg-white px-1.5 font-mono text-xs">{k}</kbd></dt><dd>{v}</dd></div>)}
    </dl>
  );
}

// ───────── Étape A : valider l'automatique ─────────
function EtapeA({ client, sures, aVerifier, valides, evals, nomDe, onValiderSures, onConfirmer, onCorriger }: {
  client: string; sures: Critere[]; aVerifier: Critere[]; valides: Critere[]; evals: Map<string, Evaluation>; nomDe: (id: number | null) => string;
  onValiderSures: () => void; onConfirmer: (c: Critere) => void; onCorriger: (c: Critere) => void;
}) {
  const duClient = aVerifier.filter((c) => evals.get(c.id)?.proposition?.source === "client");
  const autres = aVerifier.filter((c) => !duClient.includes(c));
  const [voirValides, setVoirValides] = useState(false);
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-horizon/30 bg-horizon/5 p-3 text-sm">
        Le scan et les données SpeedResa ont vérifié {client}. <strong>Ces résultats ne comptent dans le score qu&apos;une fois validés par vous.</strong> Validez ceux qui sont justes ; corrigez les autres avec « Corriger » : votre réponse remplace celle du scan, et elle est gardée pour le prochain audit. Un résultat validé reste modifiable jusqu&apos;à la finalisation.
      </p>
      {sures.length > 0 && (
        <section className="carte p-4" aria-labelledby="sures-titre">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="sures-titre" className="text-lg">Résultats sûrs (confiance haute)</h2>
            <button className="btn-primaire" onClick={onValiderSures} autoFocus><CheckCheck size={16} aria-hidden /> Valider les {sures.length} résultats sûrs</button>
          </div>
          <ul className="mt-3 divide-y divide-gris-clair">
            {sures.map((c) => <LigneProposition key={c.id} c={c} e={evals.get(c.id)!} onConfirmer={onConfirmer} onCorriger={onCorriger} />)}
          </ul>
        </section>
      )}
      {duClient.length > 0 && (
        <section className="carte p-4" aria-labelledby="client-titre">
          <h2 id="client-titre" className="text-lg">Réponses du client</h2>
          <p className="text-sm text-gris-texte">Arrivées par le questionnaire : validez-les ou corrigez-les.</p>
          <ul className="mt-3 divide-y divide-gris-clair">
            {duClient.map((c) => <LigneProposition key={c.id} c={c} e={evals.get(c.id)!} onConfirmer={onConfirmer} onCorriger={onCorriger} />)}
          </ul>
        </section>
      )}
      {autres.length > 0 && (
        <section className="carte p-4" aria-labelledby="verif-titre">
          <h2 id="verif-titre" className="text-lg">À vérifier (confiance moyenne ou basse)</h2>
          <ul className="mt-3 divide-y divide-gris-clair">
            {autres.map((c) => <LigneProposition key={c.id} c={c} e={evals.get(c.id)!} onConfirmer={onConfirmer} onCorriger={onCorriger} />)}
          </ul>
        </section>
      )}
      {!sures.length && !aVerifier.length && <p className="carte p-6 text-center text-gris-texte">Tous les résultats automatiques sont validés.</p>}
      {valides.length > 0 && (
        <section className="carte p-4" aria-labelledby="valides-titre">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setVoirValides((x) => !x)} aria-expanded={voirValides}>
            <h2 id="valides-titre" className="text-lg">Déjà validés ({valides.length})</h2><span className="text-sm text-horizon">{voirValides ? "Masquer" : "Afficher"}</span>
          </button>
          {voirValides && (
            <ul className="mt-3 divide-y divide-gris-clair">
              {valides.map((c) => { const e = evals.get(c.id)!; return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span><span className="text-xs text-gris-texte">{c.id}</span> {c.critere}</span>
                  <span className="flex items-center gap-3"><StatutBadge statut={e.statut} small /><span className="text-xs text-gris-texte">validé par {nomDe(e.auteurId)} le {fmtDate(e.updatedAt)}</span><button className="btn-discret px-2 py-1 text-xs" onClick={() => onCorriger(c)}>Corriger</button></span>
                </li>
              ); })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function LigneProposition({ c, e, onConfirmer, onCorriger }: { c: Critere; e: Evaluation; onConfirmer: (c: Critere) => void; onCorriger: (c: Critere) => void }) {
  const p = e.proposition!;
  return (
    <li className="grid gap-3 py-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
      <div>
        <p className="text-xs text-gris-texte">{c.id} · {c.pilier} · {c.points} pts</p>
        <p className="font-semibold">{c.critere}</p>
      </div>
      <div className="text-sm">
        <p className="flex items-center gap-2"><StatutBadge statut={p.statut} /> {p.valeur !== null && c.type === "Seuil" && <span className="font-semibold">{formatValeur(p.valeur, c.unite)}</span>}</p>
        <p className="mt-1 text-gris-texte">{p.texte}</p>
        {p.preuve && <LiensPreuve p={p.preuve} />}
      </div>
      <div className="flex gap-2">
        {p.statut && <button className="btn-secondaire px-3 py-1.5" onClick={() => onConfirmer(c)}>Confirmer</button>}
        <button className="btn-discret" onClick={() => onCorriger(c)}>{p.statut ? "Corriger" : "Répondre"}</button>
      </div>
    </li>
  );
}

// ───────── Étape B : une question à la fois ─────────
interface CtxCarte { auditId: number; site: string | null; domaine: string | null; nom: string; placeId: string | null; pagesSociales: string[] }

function Carte({ ctx, c, e, prec, precDate, restants, conflit, nomDe, presentsIci, onRepondre, onPasser, onResoudre }: {
  ctx: CtxCarte; c: Critere; e: Evaluation | null; prec: Evaluation | null; precDate: string | null; restants: number;
  conflit: { theirs: Evaluation } | null; nomDe: (id: number | null) => string; presentsIci: { nom: string | null; email: string }[];
  onRepondre: (i: { statut: Statut | null; valeur: number | null; commentaire: string | null; aEnvoyerClient: boolean }) => Promise<boolean>;
  onPasser: (sens: 1 | -1) => void; onResoudre: (garder: "leur" | "mienne") => void;
}) {
  // VIS-03 : l'API Google ne donne pas les réponses du propriétaire ; le CSM compte les réponses sur les 10 derniers avis
  const vis03 = c.id === "VIS-03";
  const [valeurTxt, setValeurTxt] = useState(() => {
    const v = e?.valeur ?? e?.proposition?.valeur?.toString() ?? null;
    return vis03 ? (v !== null && v !== "" ? String(Math.round(Number(v) * 10)) : "") : valeurPourSaisie(v, c.unite);
  });
  const [commentaire, setCommentaire] = useState(e?.commentaire ?? "");
  const [requis, setRequis] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const comRef = useRef<HTMLTextAreaElement>(null);
  const valRef = useRef<HTMLInputElement>(null);
  const nbReponses = vis03 && /^\s*\d{1,2}\s*$/.test(valeurTxt) && Number(valeurTxt) <= 10 ? Number(valeurTxt) : null;
  const valeur = vis03 ? (nbReponses === null ? null : nbReponses / 10) : c.type === "Seuil" ? parseValeurSaisie(valeurTxt, c.unite) : null;
  const calc = c.type === "Seuil" ? statutFromSeuil(valeur, c) : null;

  const repondre = useCallback(async (statut: Statut | null, opts: { envoyer?: boolean; commentaire?: string; valeur?: number | null } = {}) => {
    if (enCours) return;
    const com = (opts.commentaire ?? commentaire).trim() || null;
    const v = opts.valeur !== undefined ? opts.valeur : valeur;
    const msg = commentaireRequis(c, { statut, valeur: v }, e?.proposition ?? null);
    if (msg && !com) { setRequis(msg); comRef.current?.focus(); return; }
    setEnCours(true);
    await onRepondre({ statut, valeur: v, commentaire: com, aEnvoyerClient: !!opts.envoyer });
    setEnCours(false);
  }, [c, commentaire, e, enCours, onRepondre, valeur]);

  const inchange = useCallback(() => {
    if (!prec?.statut) return;
    void repondre(prec.statut, { commentaire: commentaire || `Inchangé depuis l'audit du ${fmtDate(precDate)}`, valeur: prec.valeur === null ? null : Number(prec.valeur) });
  }, [prec, precDate, repondre, commentaire]);

  // Raccourcis clavier
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      const dansChamp = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (dansChamp) { if (ev.key === "Escape") t.blur(); return; }
      const k = ev.key.toLowerCase();
      if (TOUCHES[k]) { ev.preventDefault(); void repondre(TOUCHES[k]); }
      else if (ev.key === "?" || (ev.key === "/" && ev.shiftKey)) { ev.preventDefault(); void repondre(null, { envoyer: true }); }
      else if (k === "i") { ev.preventDefault(); inchange(); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); onPasser(1); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); onPasser(-1); }
      else if (k === "v" && c.type === "Seuil") { ev.preventDefault(); valRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [repondre, inchange, onPasser, c.type]);

  const preuve = e?.proposition?.preuve ?? (e?.preuve as PreuveData | null);
  return (
    <article className="carte mx-auto max-w-3xl p-6" aria-labelledby={`crit-${c.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gris-texte">
        <span>{c.pilier} · <strong>{c.id}</strong> · {c.points} points · source : {c.source}</span>
        <span>{restants} critère{restants > 1 ? "s" : ""} restant{restants > 1 ? "s" : ""}</span>
      </div>
      {c.obligationLegale && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-rouge/10 px-2.5 py-0.5 text-xs font-semibold text-rouge-texte"><Scale size={12} aria-hidden /> Obligation légale</p>}
      <h2 id={`crit-${c.id}`} className="mt-2 text-xl leading-snug">{c.critere}</h2>
      <GuideBloc c={c} ctx={ctx} enCours={enCours} onRetenir={(statut, v, com) => void repondre(statut, { valeur: v, commentaire: [commentaire.trim(), com].filter(Boolean).join("\n") })} />
      {presentsIci.length > 0 && <p className="mt-2 text-sm text-horizon">{presentsIci.map((p) => p.nom || p.email).join(", ")} regarde aussi ce critère.</p>}

      {conflit && (
        <div role="alert" className="mt-3 rounded-lg border border-ambre bg-ambre/15 p-3 text-sm">
          <p><strong>{nomDe(conflit.theirs.auteurId)}</strong> vient d&apos;enregistrer <StatutBadge statut={conflit.theirs.statut} small /> sur ce critère{conflit.theirs.commentaire ? ` : « ${conflit.theirs.commentaire} »` : ""}.</p>
          <div className="mt-2 flex gap-2"><button className="btn-secondaire px-3 py-1" onClick={() => onResoudre("leur")}>Garder sa réponse</button><button className="btn-discret" onClick={() => onResoudre("mienne")}>Remplacer par la mienne</button></div>
        </div>
      )}

      {preuve && (
        <div className="mt-4 rounded-lg bg-gris-clair/50 p-3 text-sm">
          <p className="libelle">Preuve {e?.confiance && `· confiance ${e.confiance}`}</p>
          <p className="mt-1">{preuve.texte}</p>
          {preuve.extrait && <blockquote className="mt-2 border-l-4 border-horizon/40 pl-3 text-xs text-gris-texte">{preuve.extrait}</blockquote>}
          <LiensPreuve p={preuve} />
          {e?.proposition?.statut && <p className="mt-1">Résultat proposé : <StatutBadge statut={e.proposition.statut} small /></p>}
        </div>
      )}

      {prec && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-gris-clair p-3 text-sm">
          <span>Dernier audit ({fmtDate(precDate)}) : <StatutBadge statut={prec.statut} small /> {prec.valeur && formatValeur(prec.valeur, c.unite)}</span>
          {prec.statut && <button className="btn-discret px-2 py-1 text-xs" onClick={inchange}><kbd className="font-mono">I</kbd> Inchangé depuis le dernier audit</button>}
        </div>
      )}

      {c.type === "Seuil" && (
        <div className="mt-4">
          <label htmlFor={`val-${c.id}`} className="libelle">{vis03 ? "Sur les 10 derniers avis, combien ont une réponse de l'agence ?" : `Valeur mesurée (${c.unite})`} <kbd className="ml-1 font-mono">V</kbd></label>
          {vis03 && <p className="mt-1 text-xs text-gris-texte">Ouvrez les avis de la fiche (lien « Voir la page » de la preuve), triez par « Plus récents » et comptez les avis avec une réponse du propriétaire.</p>}
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <input id={`val-${c.id}`} ref={valRef} inputMode="decimal" value={valeurTxt} onChange={(ev) => setValeurTxt(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter" && calc) { ev.preventDefault(); void repondre(calc); } }}
              className="champ w-32" placeholder={vis03 ? "0 à 10" : c.unite?.startsWith("%") ? "ex. 35" : "ex. 4,4"} />
            <span className="text-sm" aria-live="polite">{calc ? <>→ statut calculé <StatutBadge statut={calc} small /> <span className="text-gris-texte">(Entrée pour retenir)</span></> : <span className="text-gris-texte">{texteSeuil(c)}</span>}</span>
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {BOUTONS.map((b) => (
          <button key={b.s} disabled={enCours} onClick={() => repondre(b.s)}
            className={`flex flex-col items-center rounded-carte border-2 px-2 py-3 text-sm font-semibold transition-colors ${b.cls} ${e?.statut === b.s ? "ring-2 ring-minuit ring-offset-2" : ""}`}>
            <kbd className="font-mono text-xs opacity-70">{b.k}</kbd>{b.l}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor={`com-${c.id}`} className="libelle">Commentaire {requis ? <span className="text-rouge-texte">(obligatoire)</span> : "(facultatif)"}</label>
        <textarea id={`com-${c.id}`} ref={comRef} rows={2} value={commentaire} onChange={(ev) => { setCommentaire(ev.target.value); }}
          onKeyDown={(ev) => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); const s = e?.statut ?? calc ?? null; if (s) void repondre(s); } }}
          className={`champ mt-1 ${requis ? "border-rouge-texte" : ""}`} aria-describedby={requis ? `req-${c.id}` : undefined} />
        {requis && <p id={`req-${c.id}`} role="alert" className="mt-1 text-sm text-rouge-texte">{requis} Cliquez ensuite à nouveau sur le statut.</p>}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button className="btn-discret" onClick={() => onPasser(-1)}><ChevronLeft size={16} aria-hidden /> Précédent</button>
        <div className="flex gap-2">
          <button className="btn-secondaire" onClick={() => repondre(null, { envoyer: true })} title="Ajouter ce critère au questionnaire client">
            <Send size={14} aria-hidden /> Envoyer au client <kbd className="font-mono text-xs">?</kbd>
          </button>
          <button className="btn-discret" onClick={() => onPasser(1)}>Passer <ArrowRight size={16} aria-hidden /></button>
        </div>
      </div>
      {c.questionClient && <p className="mt-3 text-xs text-gris-texte">Question posée au client : « {c.questionClient} »</p>}
    </article>
  );
}

// ───────── Vue d'ensemble ─────────
function VueEnsemble({ crit, evals, prec, score, nomDe, editable, presentation, onOuvrir }: {
  crit: Critere[]; evals: Map<string, Evaluation>; prec: Map<string, Evaluation>; score: ReturnType<typeof computeScore>;
  nomDe: (id: number | null) => string; editable: boolean; presentation: string; onOuvrir: (id: string) => void;
}) {
  const piliers = [...new Set(crit.map((c) => c.pilier))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gris-texte">Vue interne (commentaires, auteurs). Pour le rendez-vous, utilisez la présentation : sans aucune donnée interne.</p>
        <Link href={presentation} className="btn-primaire"><Presentation size={16} aria-hidden /> Présenter au client</Link>
      </div>
      {!editable && <p className="flex items-center gap-2 text-sm text-gris-texte"><Lock size={14} aria-hidden /> Audit en lecture seule.</p>}
      {piliers.map((p) => {
        const s = score.piliers.find((x) => x.pilier === p)!;
        return (
          <section key={p} className="carte" aria-labelledby={`p-${p}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gris-clair p-4">
              <h2 id={`p-${p}`} className="text-lg">{p}</h2>
              <div className="flex items-center gap-3 text-sm">
                <span className="tabular-nums font-semibold">{s.score === null ? "—" : `${Math.round(s.score)}/100`}</span>
                <span className="h-2 w-32 overflow-hidden rounded-full bg-gris-clair" aria-hidden><span className="block h-full bg-horizon" style={{ width: `${s.score ?? 0}%` }} /></span>
                <span className="text-xs text-gris-texte">couverture {Math.round(s.couverture * 100)} %</span>
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {crit.filter((c) => c.pilier === p).map((c) => {
                  const e = evals.get(c.id);
                  const pr = prec.get(c.id);
                  return (
                    <tr key={c.id} className="border-t border-gris-clair first:border-t-0 hover:bg-horizon/[0.03]">
                      <td className="w-20 px-4 py-2 text-xs text-gris-texte">{c.id}</td>
                      <td className="px-2 py-2">
                        {editable ? <button className="text-left hover:text-horizon hover:underline" onClick={() => onOuvrir(c.id)}>{c.critere}</button> : c.critere}
                        {c.obligationLegale && <Scale size={12} className="ml-1 inline text-rouge-texte" aria-label="Obligation légale" />}
                        {e?.commentaire && <p className="text-xs text-gris-texte">{e.commentaire}</p>}
                      </td>
                      <td className="w-28 px-2 py-2 text-right tabular-nums">{e?.valeur && c.type === "Seuil" ? formatValeur(e.valeur, c.unite) : ""}</td>
                      <td className="w-32 px-2 py-2"><StatutBadge statut={e?.statut ?? (e?.proposition && !e.aEnvoyerClient ? null : null)} envoye={e?.aEnvoyerClient} /></td>
                      <td className="w-24 px-2 py-2 text-xs text-gris-texte" title="Dernier audit">{pr?.statut ? <StatutBadge statut={pr.statut} small /> : ""}</td>
                      <td className="w-40 px-4 py-2 text-xs text-gris-texte">{e?.statut ? `${e.source === "donnees" ? "Données · " : e.source === "auto" ? "Scan · " : e.source === "import_v1" ? "Ancienne grille · " : ""}${e.auteurId ? nomDe(e.auteurId) : ""}${e.updatedAt && e.auteurId ? `, ${fmtDateTime(e.updatedAt)}` : ""}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

/** Liens de preuve : page vérifiée, capture d'écran, source. La preuve est toujours à un clic. */
function LiensPreuve({ p }: { p: PreuveData }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gris-texte">
      {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-horizon hover:underline">Page vérifiée ↗</a>}
      {p.captureId && <a href={`/api/scans/captures/${p.captureId}`} target="_blank" rel="noopener noreferrer" className="text-horizon hover:underline">Capture d&apos;écran ↗</a>}
      {p.source && <span>Source : {p.source}{p.periode ? ` — ${p.periode}` : ""}</span>}
      {p.requete && <span className="break-all font-mono">{p.requete.slice(0, 120)}</span>}
    </p>
  );
}

// ───────── Comment vérifier (lot B3) ─────────
function GuideBloc({ c, ctx, enCours, onRetenir }: { c: Critere; ctx: CtxCarte; enCours: boolean; onRetenir: (s: Statut, valeur: number, commentaire: string) => void }) {
  const g = GUIDES[c.id];
  const [n, setN] = useState("");
  if (!g) return c.commentVerifier ? <p className="mt-2 text-sm"><span className="font-semibold">Comment vérifier : </span>{c.commentVerifier}</p> : null;
  const liens = (g.liens ?? []).map((l) => ({ ...l, href: lienGuide(l.url, ctx) })).filter((l): l is typeof l & { href: string } => !!l.href);
  const nb = /^\s*\d{1,3}\s*$/.test(n) ? Number(n) : null;
  return (
    <div className="mt-3 rounded-lg border border-lagon/50 bg-lagon/10 p-3 text-sm">
      <p className="font-semibold">Comment vérifier</p>
      {g.definition && <p className="mt-1 italic">{g.definition}</p>}
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">{g.etapes.map((x) => <li key={x}>{x}</li>)}</ol>
      {(liens.length > 0 || (c.id === "VIS-05" && ctx.pagesSociales.length > 0)) && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {c.id === "VIS-05" && ctx.pagesSociales.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-horizon hover:underline">{new URL(u).hostname.replace(/^www\./, "")} <ExternalLink size={11} aria-hidden /></a>)}
          {liens.map((l) => <a key={l.libelle} href={l.href} target={l.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className="inline-flex items-center gap-1 text-horizon hover:underline">{l.libelle} <ExternalLink size={11} aria-hidden /></a>)}
        </p>
      )}
      {g.comptage && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`cpt-${c.id}`} className="text-xs font-semibold">{g.comptage.libelle}</label>
          <input id={`cpt-${c.id}`} inputMode="numeric" value={n} onChange={(ev) => setN(ev.target.value)} className="champ w-20 py-1" placeholder="0" />
          {nb !== null && <><span className="text-xs">→ <StatutBadge statut={statutComptage(g.comptage, nb)} small /></span>
            <button className="btn-secondaire px-2 py-1 text-xs" disabled={enCours} onClick={() => onRetenir(statutComptage(g.comptage!, nb), nb, `${nb} publication(s) d'offres avec lien direct sur 4 semaines (comptage CSM).`)}>Retenir</button></>}
        </div>
      )}
      {c.id === "VIS-04" && <Relais auditId={ctx.auditId} enCours={enCours} onRetenir={onRetenir} />}
    </div>
  );
}

/** VIS-04 : pages qui citent le site (recherche web de Claude), à cocher par le CSM. */
function Relais({ auditId, enCours, onRetenir }: { auditId: number; enCours: boolean; onRetenir: (s: Statut, valeur: number, commentaire: string) => void }) {
  const [etat, setEtat] = useState<{ chargement?: boolean; erreur?: string; relais?: { url: string; domaine: string; type: string }[] }>({});
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const chercher = async () => {
    setEtat({ chargement: true });
    const r = await post<{ relais: { url: string; domaine: string; type: string }[] }>(`/api/audits/${auditId}/relais`, {});
    if (!r.ok) return setEtat({ erreur: r.data.erreur ?? "Recherche impossible" });
    setEtat({ relais: r.data.relais });
    setCoches(new Set(r.data.relais.filter((x) => ["mairie", "CSE", "office de tourisme"].includes(x.type)).map((x) => x.url)));
  };
  const n = coches.size;
  const statut: Statut = n >= 2 ? "OUI" : n === 1 ? "PARTIELLEMENT" : "NON";
  return (
    <div className="mt-2">
      {!etat.relais && <button className="btn-secondaire px-3 py-1 text-xs" onClick={chercher} disabled={etat.chargement}>{etat.chargement ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Search size={12} aria-hidden />} {etat.chargement ? "Recherche sur le web (environ 30 s)…" : "Chercher les relais"}</button>}
      {etat.erreur && <p role="alert" className="mt-1 text-xs text-rouge-texte">{etat.erreur}</p>}
      {etat.relais && (
        <div className="mt-1">
          {etat.relais.length ? (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {etat.relais.map((x) => (
                <li key={x.url} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" id={`rel-${x.url}`} checked={coches.has(x.url)} onChange={(ev) => setCoches((s) => { const t = new Set(s); if (ev.target.checked) t.add(x.url); else t.delete(x.url); return t; })} className="mt-0.5" />
                  <label htmlFor={`rel-${x.url}`}><span className="rounded bg-white px-1">{x.type}</span> <a href={x.url} target="_blank" rel="noopener noreferrer" className="break-all text-horizon hover:underline">{x.url.replace(/^https?:\/\//, "").slice(0, 90)}</a></label>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gris-texte">Aucune page trouvée : utilisez les liens de recherche ci-dessus.</p>}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs">{n} relais coché(s) → <StatutBadge statut={statut} small /></span>
            <button className="btn-secondaire px-2 py-1 text-xs" disabled={enCours} onClick={() => onRetenir(statut, n, n ? `Relais vérifiés : ${[...coches].join(" ; ")}` : "Aucun relais local trouvé (recherche web).")}>Retenir</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── Vue par pilier en direct, avec animation du pilier qui bouge (lot B1) ─────────
function PiliersMini({ piliers }: { piliers: ReturnType<typeof computeScore>["piliers"] }) {
  const avant = useRef(new Map<string, number | null>());
  const [bouge, setBouge] = useState<Set<string>>(new Set());
  useEffect(() => {
    const changes = piliers.filter((p) => avant.current.has(p.pilier) && avant.current.get(p.pilier) !== p.score).map((p) => p.pilier);
    for (const p of piliers) avant.current.set(p.pilier, p.score);
    if (!changes.length) return;
    setBouge(new Set(changes));
    const t = setTimeout(() => setBouge(new Set()), 1800);
    return () => clearTimeout(t);
  }, [piliers]);
  return (
    <section aria-label="Score par pilier en direct" className="carte grid grid-cols-2 gap-x-4 gap-y-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
      {piliers.map((p) => (
        <div key={p.pilier} className={`rounded-lg p-1.5 transition-colors duration-700 ${bouge.has(p.pilier) ? "bg-emeraude/25 ring-2 ring-emeraude" : ""}`}>
          <p className="truncate text-xs text-gris-texte" title={p.pilier}>{p.pilier}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-gris-clair" aria-hidden><span className="block h-full bg-horizon transition-all duration-700" style={{ width: `${p.score ?? 0}%` }} /></span>
            <span className="w-8 text-right text-xs font-semibold tabular-nums">{p.score === null ? "—" : Math.round(p.score)}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

// ───────── Répartir les questions entre le CSM et le client (lot B2) ─────────
function Repartition({ auditId, clientId, restants, questionnaire, catalogue, onEnvoye }: {
  auditId: number; clientId: string; restants: Critere[]; questionnaire: Extra["questionnaire"]; catalogue: boolean; onEnvoye: (ids: string[]) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState<Record<string, Repondant>>({});
  const [email, setEmail] = useState(questionnaire?.email ?? "");
  const [etat, setEtat] = useState<{ chargement?: boolean; erreur?: string; ok?: string; lien?: string | null }>({ lien: questionnaire?.lien ?? null });
  const [copie, setCopie] = useState(false);
  const qui = (c: Critere) => choix[c.id] ?? repartitionParDefaut(c, catalogue).qui;
  const pourClient = restants.filter((c) => qui(c) === "client");
  const enAttente = questionnaire?.statut === "en_attente" ? questionnaire.questions : [];
  const generer = async (envoyer: boolean) => {
    setEtat({ chargement: true });
    // Le nouveau lien remplace le précédent : il reprend ses questions encore sans réponse
    const ids = [...new Set([...pourClient.map((c) => c.id), ...enAttente])];
    const r = await creerQuestionnaireAction(clientId, auditId, email, envoyer, ids);
    if (r?.erreur) return setEtat({ erreur: r.erreur });
    setEtat({ ok: r?.message, lien: r?.lien ?? null });
    onEnvoye(pourClient.map((c) => c.id));
  };
  return (
    <section className="carte p-4" aria-labelledby="repartir-titre">
      <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOuvert((x) => !x)} aria-expanded={ouvert}>
        <h2 id="repartir-titre" className="text-lg">Répartir les questions : {restants.length - pourClient.length} pour vous, {pourClient.length} pour le client</h2>
        <span className="text-sm text-horizon">{ouvert ? "Masquer" : "Choisir et générer le lien client"}</span>
      </button>
      {etat.lien && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>Lien client en cours{questionnaire?.envoyeLe ? ` (envoyé le ${fmtDate(questionnaire.envoyeLe)})` : ""} :</span>
          <input readOnly value={etat.lien} onFocus={(ev) => ev.currentTarget.select()} className="champ w-80 py-1 font-mono text-xs" aria-label="Lien du questionnaire client" />
          <button className="btn-secondaire px-2 py-1 text-xs" onClick={async () => { try { await navigator.clipboard.writeText(etat.lien!); setCopie(true); } catch { setCopie(false); } }}><Copy size={12} aria-hidden /> {copie ? "Copié" : "Copier"}</button>
        </div>
      )}
      {etat.ok && <p role="status" className="mt-2 text-sm text-[#0b7a5e]">{etat.ok}</p>}
      {etat.erreur && <p role="alert" className="mt-2 text-sm text-rouge-texte">{etat.erreur}</p>}
      {ouvert && (
        <div className="mt-3">
          <p className="text-sm text-gris-texte">Vous pouvez générer le lien maintenant et continuer vos propres questions : les réponses du client arriveront dans « Valider l&apos;automatique ».</p>
          <ul className="mt-2 max-h-80 divide-y divide-gris-clair overflow-y-auto">
            {restants.map((c) => { const d = repartitionParDefaut(c, catalogue); return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1"><span className="text-xs text-gris-texte">{c.id}</span> {c.critere}{d.note && <span className="block text-xs text-gris-texte">Par défaut : {d.qui === "client" ? "client" : "vous"}, {d.note}</span>}</span>
                <span className="inline-flex overflow-hidden rounded-full border border-gris-clair text-xs" role="radiogroup" aria-label={`Qui répond à ${c.id}`}>
                  {(["csm", "client"] as Repondant[]).map((r) => (
                    <button key={r} role="radio" aria-checked={qui(c) === r} onClick={() => setChoix((x) => ({ ...x, [c.id]: r }))} className={`px-3 py-1 ${qui(c) === r ? "bg-minuit text-white" : "bg-white"}`}>{r === "csm" ? "CSM" : "Client"}</button>
                  ))}
                </span>
              </li>
            ); })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-primaire" disabled={etat.chargement || (!pourClient.length && !enAttente.length)} onClick={() => generer(false)}>{etat.chargement && <Loader2 size={14} className="animate-spin" aria-hidden />} Générer le lien client ({new Set([...pourClient.map((c) => c.id), ...enAttente]).size} questions)</button>
            <label className="sr-only" htmlFor="email-client">Email du client</label>
            <input id="email-client" type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="email du client (facultatif)" className="champ w-60 py-1.5" />
            <button className="btn-secondaire" disabled={etat.chargement || !email || (!pourClient.length && !enAttente.length)} onClick={() => generer(true)}><Send size={14} aria-hidden /> Envoyer par email</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ───────── Où en est l'audit (lot B4) ─────────
function Recapitulatif({ score, aValider, fileB, envoyes, evals, questionnaire, catalogue, onAller }: {
  score: ReturnType<typeof computeScore>; aValider: Critere[]; fileB: Critere[]; envoyes: Critere[]; evals: Map<string, Evaluation>;
  questionnaire: Extra["questionnaire"]; catalogue: boolean; onAller: (m: Mode, id?: string) => void;
}) {
  const questions = [
    ...envoyes.map((c) => ({ c, qui: `Client — questionnaire${questionnaire?.envoyeLe ? ` envoyé le ${fmtDate(questionnaire.envoyeLe)}` : questionnaire?.lien ? " (lien créé, pas encore envoyé par email)" : ""}` })),
    ...fileB.map((c) => ({ c, qui: repartitionParDefaut(c, catalogue).qui === "client" ? "Client (à mettre dans le questionnaire)" : "CSM" })),
  ];
  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2">
        <div className="carte p-4">
          <p className="libelle">1. Maturité</p>
          <p className="mt-1 flex items-baseline gap-2"><span className="font-titres text-4xl font-bold tabular-nums">{score.score === null ? "—" : Math.round(score.score)}</span><span className="text-sm text-gris-texte">/100</span><MaturiteBadge score={score.score} /></p>
          <p className="text-sm text-gris-texte">Score visé après actions : {score.scoreApres === null ? "—" : Math.round(score.scoreApres)}/100</p>
        </div>
        <div className="carte p-4">
          <p className="libelle">2. Couverture</p>
          <p className="mt-1 font-titres text-4xl font-bold tabular-nums">{Math.round(score.couverture * 100)} %</p>
          <p className={`text-sm ${score.fiable ? "text-gris-texte" : "font-semibold text-rouge-texte"}`}>{score.fiable ? "Score fiable (70 % ou plus)." : "Moins de 70 % : le score n'est pas encore fiable."}</p>
        </div>
      </section>
      <section className="carte p-4" aria-labelledby="rv-titre">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="rv-titre" className="text-lg">3. Points restant à valider ({aValider.length})</h2>{aValider.length > 0 && <button className="btn-secondaire" onClick={() => onAller("A")}>Valider</button>}</div>
        {aValider.length ? (
          <ul className="mt-2 text-sm">{aValider.map((c) => <li key={c.id} className="py-0.5"><span className="text-xs text-gris-texte">{c.id}</span> {c.critere}{evals.get(c.id)?.proposition?.source === "client" && <span className="ml-2 rounded bg-lagon/30 px-1.5 text-xs">réponse du client</span>}</li>)}</ul>
        ) : <p className="mt-1 text-sm text-gris-texte">Rien à valider.</p>}
      </section>
      <section className="carte p-4" aria-labelledby="qs-titre">
        <h2 id="qs-titre" className="text-lg">4. Questions sans réponse ({questions.length})</h2>
        {questions.length ? (
          <ul className="mt-2 divide-y divide-gris-clair text-sm">
            {questions.map(({ c, qui }) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span><span className="text-xs text-gris-texte">{c.id}</span> {c.critere}</span>
                <span className="flex items-center gap-2 text-xs"><span className="rounded-full bg-gris-clair px-2 py-0.5">{qui}</span><button className="text-horizon hover:underline" onClick={() => onAller("B", c.id)}>Répondre</button></span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-gris-texte">Toutes les questions ont une réponse.</p>}
      </section>
      <div className="flex justify-center"><button className="btn-primaire" onClick={() => onAller("vue")}>5. Vue d&apos;ensemble par pilier →</button></div>
    </div>
  );
}
