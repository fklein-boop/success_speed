import Link from "next/link";
import { Download } from "lucide-react";
import type { ScoreResult } from "@/lib/audit/score";
import { fmtDate } from "@/lib/format";
import { MaturiteBadge } from "./StatutBadge";
import { NouvelAudit } from "./NouvelAudit";
import { LancerPreAudit } from "./LancerPreAudit";

export interface AuditLigne {
  id: number; date: string; statut: string; origine: string; mention: string | null; score: ScoreResult | null; auteur: string | null; assigne: string | null;
}

/** Historique des audits d'un client + évolution entre les deux derniers audits finalisés. */
export function HistoriqueAudits({ clientId, nom, urls, audits, evolution, editable }: {
  clientId: string; nom: string; urls: string[]; audits: AuditLigne[]; editable: boolean;
  evolution: { gagnes: { id: string; critere: string }[]; perdus: { id: string; critere: string }[]; depuis: string; delta: number | null } | null;
}) {
  const enCours = audits.find((a) => a.statut === "brouillon");
  const dernier = audits.find((a) => a.statut === "finalise");
  const s = dernier?.score;
  return (
    <section className="carte p-4" aria-labelledby="audits-titre">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="audits-titre" className="text-lg">Maturité numérique</h2>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <LancerPreAudit clientId={clientId} nom={nom} urls={urls} className={enCours ? "btn-secondaire" : "btn-primaire"} label={enCours ? "Relancer le scan" : "Lancer le pré-audit"} />
            {enCours ? <NouvelAudit clientId={clientId} enCours={enCours.id} /> : <NouvelAudit clientId={clientId} className="btn-discret" label="Audit manuel" />}
          </div>
        )}
      </div>

      {s && s.score !== null ? (
        <div className="mt-3 grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <p className="libelle">Dernier audit · {fmtDate(dernier!.date)}</p>
            <p className="mt-1 flex items-baseline gap-2"><span className="font-titres text-4xl font-bold tabular-nums">{Math.round(s.score)}</span><span className="text-gris-texte">/100</span></p>
            <p><MaturiteBadge score={s.score} /></p>
            <p className="mt-1 text-sm">Visé après actions : <strong>{s.scoreApres === null ? "—" : Math.round(s.scoreApres)}</strong></p>
            <p className={`text-sm ${s.fiable ? "text-gris-texte" : "text-rouge-texte"}`}>Couverture {Math.round(s.couverture * 100)} %{s.fiable ? "" : " — score non fiable (< 70 %)"}</p>
          </div>
          <ul className="space-y-1.5 text-sm" aria-label="Score par pilier">
            {s.piliers.filter((p) => p.nbEvalues > 0).map((p) => (
              <li key={p.pilier} className="grid grid-cols-[minmax(0,1fr)_8rem_3rem] items-center gap-2">
                <span className="truncate" title={p.pilier}>{p.pilier}</span>
                <span className="h-2 overflow-hidden rounded-full bg-gris-clair" aria-hidden><span className="block h-full bg-horizon" style={{ width: `${p.score ?? 0}%` }} /></span>
                <span className="text-right tabular-nums">{p.score === null ? "—" : Math.round(p.score)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="mt-3 text-sm text-gris-texte">Aucun audit finalisé.</p>}

      {evolution && (
        <div className="mt-4 rounded-lg bg-gris-clair/40 p-3 text-sm">
          <p className="font-semibold">Depuis l&apos;audit du {fmtDate(evolution.depuis)}{evolution.delta !== null && <> : {evolution.delta >= 0 ? "+" : ""}{Math.round(evolution.delta)} points</>}</p>
          {evolution.gagnes.length > 0 && <p className="mt-1"><span className="font-semibold text-[#0b7a5e]">▲ Gagnés :</span> {evolution.gagnes.map((g) => `${g.id} ${g.critere}`).join(" · ")}</p>}
          {evolution.perdus.length > 0 && <p className="mt-1"><span className="font-semibold text-rouge-texte">▼ Perdus :</span> {evolution.perdus.map((g) => `${g.id} ${g.critere}`).join(" · ")}</p>}
          {!evolution.gagnes.length && !evolution.perdus.length && <p className="mt-1 text-gris-texte">Aucun critère comparable n&apos;a changé.</p>}
        </div>
      )}

      {audits.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <caption className="libelle mb-1 text-left">Historique</caption>
          <thead className="text-left text-xs text-gris-texte"><tr><th className="py-1">Date</th><th>Statut</th><th>Score</th><th>Couverture</th><th>Par</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id} className="border-t border-gris-clair align-top">
                <td className="py-2"><Link href={`/audits/${a.id}`} className="text-horizon hover:underline">{fmtDate(a.date)}</Link>{a.mention && <p className="max-w-xs text-xs text-gris-texte">{a.mention}</p>}</td>
                <td className="py-2">{a.statut === "brouillon" ? "En cours" : "Finalisé"}{a.origine === "import_v1" ? " (ancienne grille)" : ""}</td>
                <td className="py-2 tabular-nums">{a.score?.score === null || !a.score ? "—" : Math.round(a.score.score)}</td>
                <td className="py-2 tabular-nums">{a.score ? `${Math.round(a.score.couverture * 100)} %` : "—"}</td>
                <td className="py-2 text-gris-texte">{a.assigne ?? a.auteur ?? "—"}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <a href={`/api/audits/${a.id}/export?version=client`} className="btn-discret px-2 py-1 text-xs" title="Télécharger (CSV) — version client"><Download size={12} aria-hidden /> CSV client</a>
                  <a href={`/api/audits/${a.id}/export?version=interne`} className="btn-discret px-2 py-1 text-xs" title="Télécharger (CSV) — version interne">interne</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
