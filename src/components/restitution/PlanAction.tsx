"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Loader2, RefreshCw, XCircle } from "lucide-react";
import { genererPlanAction, majActionAction } from "@/app/(app)/clients/[id]/restitution/actions";
import { quadrant, type Effort } from "@/lib/restitution/plan";
import { fmtDate } from "@/lib/format";

export interface ActionLigne {
  id: number; critereId: string | null; libelle: string; offre: string | null; statut: string; impact: number | null; effort: string | null;
  priorite: number | null; levier: string | null; echeance: string | null; verifStatut: string | null; verifTexte: string | null; verifLe: string | null; ancien: boolean;
}

const STATUTS: [string, string][] = [["propose", "Proposée"], ["accepte", "Acceptée"], ["en_cours", "En cours"], ["fait", "Faite"], ["abandonne", "Abandonnée"]];
const QUADRANT_COULEUR: Record<string, string> = {
  "Obligation légale": "bg-rouge-texte text-white", "Gain rapide": "bg-emeraude/30 text-minuit", Prioritaire: "bg-horizon text-white",
  "Projet structurant": "bg-minuit text-white", "Petit gain": "bg-gris-clair text-minuit", "À planifier": "bg-gris-clair text-minuit",
};

function Verification({ a }: { a: ActionLigne }) {
  if (a.statut !== "fait" || !a.verifStatut) return null;
  if (a.verifStatut === "en_cours") return <span className="inline-flex items-center gap-1 text-xs text-horizon"><Loader2 size={12} className="animate-spin" aria-hidden /> Re-vérification en cours…</span>;
  const ok = a.verifStatut === "OUI" || a.verifStatut === "N.A.";
  const Icone = ok ? CheckCircle2 : a.verifStatut === "a_confirmer" || a.verifStatut === "non_verifiable" ? CircleDashed : XCircle;
  const libelle = ok ? "Vérifié : corrigé" : a.verifStatut === "a_confirmer" ? "À confirmer au prochain audit" : a.verifStatut === "non_verifiable" ? "Re-vérification impossible" : `Encore ${a.verifStatut === "PARTIELLEMENT" ? "partiel" : "non conforme"}`;
  return <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-[#0b7a5e]" : a.verifStatut === "a_confirmer" ? "text-gris-texte" : "text-rouge-texte"}`} title={a.verifTexte ?? ""}><Icone size={12} aria-hidden /> {libelle}{a.verifLe ? ` (${fmtDate(a.verifLe)})` : ""}</span>;
}

/** Plan d'action priorisé (impact × effort) avec suivi du statut. */
export function PlanAction({ clientId, actions, nbProposees, nbRecommandees, editable }: { clientId: string; actions: ActionLigne[]; nbProposees: number; nbRecommandees: number; editable: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; texte: string } | null>(null);
  const [voirTout, setVoirTout] = useState(false);
  const router = useRouter();
  // Re-vérification en cours : on rafraîchit jusqu'au résultat
  const enVerif = actions.some((a) => a.verifStatut === "en_cours");
  useEffect(() => {
    if (!enVerif) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [enVerif, router]);
  const actives = actions.filter((a) => a.statut !== "fait" && a.statut !== "abandonne");
  const closes = actions.filter((a) => a.statut === "fait" || a.statut === "abandonne");
  const restantes = Math.max(0, nbProposees - actions.filter((a) => !a.ancien && a.statut !== "abandonne").length);
  const run = (f: () => Promise<{ ok?: boolean; message?: string; erreur?: string } | null>) => start(async () => {
    const r = await f();
    setMsg(r?.erreur ? { texte: r.erreur } : r?.message ? { ok: true, texte: r.message } : null);
  });
  const liste = voirTout ? [...actives, ...closes] : actives;

  return (
    <section className="carte p-4" aria-labelledby="plan-titre">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="plan-titre" className="text-lg">Plan d&apos;action</h2>
          <p className="text-xs text-gris-texte">Priorité = impact (points × part manquante × poids du levier en retard) ÷ effort de l&apos;offre. Une action « faite » relance la vérification du critère.</p>
        </div>
        {editable && actions.length === 0 && nbRecommandees > 0 && (
          <button className="btn-primaire" disabled={pending} onClick={() => run(() => genererPlanAction(clientId))}>
            {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} Créer le plan recommandé ({nbRecommandees} actions)
          </button>
        )}
        {editable && actions.length > 0 && restantes > 0 && (
          <button className="btn-secondaire !py-1.5" disabled={pending} onClick={() => run(() => genererPlanAction(clientId, true))}>
            Ajouter les {Math.min(5, restantes)} actions suivantes
          </button>
        )}
      </div>
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-[#0b7a5e]" : "text-rouge-texte"}`}>{msg.texte}</p>}
      {actions.length === 0 ? (
        <p className="mt-3 text-sm text-gris-texte">{nbProposees ? `${nbProposees} critère(s) à NON ou partiels dans l'audit. Plan recommandé : les obligations légales et les 8 actions les plus prioritaires (les suivantes peuvent être ajoutées ensuite).` : "Aucune action à proposer : aucun critère à NON ou partiel."}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gris-clair text-left text-xs text-gris-texte">
              <th className="py-2 pr-3 font-semibold">Priorité</th><th className="py-2 pr-3 font-semibold">Action</th><th className="py-2 pr-3 font-semibold">Offre Speedmedia</th><th className="py-2 pr-3 font-semibold">Impact / effort</th><th className="py-2 font-semibold">Statut</th>
            </tr></thead>
            <tbody>
              {liste.map((a) => {
                const q = quadrant({ impact: a.impact ?? 0, effort: (a.effort ?? "moyen") as Effort, obligationLegale: (a.priorite ?? 0) >= 100, statutCritere: "NON" });
                return (
                  <tr key={a.id} className={`border-b border-gris-clair/70 align-top ${a.statut === "fait" || a.statut === "abandonne" ? "text-gris-texte" : ""}`}>
                    <td className="py-2 pr-3"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${QUADRANT_COULEUR[q] ?? "bg-gris-clair"}`}>{q}</span></td>
                    <td className="py-2 pr-3">
                      <p><span className="text-xs text-gris-texte">{a.critereId}</span> {a.libelle}</p>
                      {a.levier && <p className="text-xs text-gris-texte">Levier : {a.levier}</p>}
                      {a.ancien && <p className="text-xs text-gris-texte">Issue d&apos;un audit précédent</p>}
                      <Verification a={a} />
                    </td>
                    <td className="py-2 pr-3 font-semibold text-horizon">{a.offre ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{a.impact ?? "—"} / {a.effort ?? "—"}</td>
                    <td className="py-2">
                      <label className="sr-only" htmlFor={`st-${a.id}`}>Statut de l&apos;action {a.critereId}</label>
                      <select id={`st-${a.id}`} className="champ !w-auto !py-1" value={a.statut} disabled={!editable || pending}
                        onChange={(e) => run(() => majActionAction(clientId, a.id, { statut: e.target.value as never }))}>
                        {STATUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {closes.length > 0 && <button className="btn-discret mt-2 text-xs" onClick={() => setVoirTout(!voirTout)}>{voirTout ? "Masquer" : "Afficher"} les {closes.length} action(s) terminée(s) ou abandonnée(s)</button>}
        </div>
      )}
    </section>
  );
}
