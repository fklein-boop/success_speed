"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Copy, Loader2, Mail, XCircle } from "lucide-react";
import { annulerQuestionnaireAction, creerQuestionnaireAction, renvoyerQuestionnaireAction } from "@/app/(app)/clients/[id]/questionnaire-actions";
import { texteReponse, type Question } from "@/lib/questionnaire/questions";

export interface QuestionnaireVue {
  id: number; statut: string; email: string | null; lien: string | null; questions: Question[];
  envoyeLe: string | null; ouvertLe: string | null; reponduLe: string | null; relance1Le: string | null; relance2Le: string | null; expireLe: string; createdAt: string;
  reponses: { critereId: string; reponse: string | null; commentaire: string | null }[];
}

const fr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "—");
const plus = (iso: string, j: number) => new Date(new Date(iso).getTime() + j * 86400_000).toISOString();

/** Questionnaire client vu par le CSM : création, envoi, suivi, réponses. */
export function QuestionnaireCsm({ clientId, auditId, auditFinalise, emailContact, prevues, liste, editable }: {
  clientId: string; auditId: number | null; auditFinalise: boolean; emailContact: string | null; prevues: Question[]; liste: QuestionnaireVue[]; editable: boolean;
}) {
  const [email, setEmail] = useState(emailContact ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; texte: string; lien?: string } | null>(null);
  const [copie, setCopie] = useState(false);
  const actif = liste.find((q) => q.statut === "en_attente");
  const dernierRepondu = liste.find((q) => q.statut === "repondu");
  const run = (f: () => Promise<{ ok?: boolean; message?: string; erreur?: string; lien?: string } | null>) => start(async () => {
    const r = await f();
    setMsg(r?.erreur ? { texte: r.erreur } : { ok: true, texte: r?.message ?? "", lien: r?.lien });
  });
  const copier = async (l: string) => { await navigator.clipboard.writeText(l).catch(() => null); setCopie(true); setTimeout(() => setCopie(false), 2000); };

  return (
    <section className="carte p-4" aria-labelledby="questionnaire-titre">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="questionnaire-titre" className="text-lg">Questionnaire client</h2>
        {actif && <span className="rounded-full bg-ambre/20 px-2.5 py-0.5 text-xs font-semibold">En attente de réponse</span>}
        {!actif && dernierRepondu && <span className="rounded-full bg-emeraude/30 px-2.5 py-0.5 text-xs font-semibold">Répondu le {fr(dernierRepondu.reponduLe)}</span>}
      </div>
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-[#0b7a5e]" : "text-rouge-texte"}`}>{msg.texte}</p>}

      {actif ? (
        <div className="mt-3 space-y-3 text-sm">
          <p>
            {actif.envoyeLe ? <>Envoyé le <strong>{fr(actif.envoyeLe)}</strong> à {actif.email}</> : <>Lien créé le {fr(actif.createdAt)} (non envoyé par email)</>}
            {" · "}{actif.ouvertLe ? `ouvert le ${fr(actif.ouvertLe)}` : "pas encore ouvert"}
            {" · "}{actif.reponses.filter((r) => r.reponse).length}/{actif.questions.length} réponses en cours · valable jusqu&apos;au {fr(actif.expireLe)}
          </p>
          {actif.envoyeLe && (
            <p className="text-gris-texte">Relances automatiques : J+3 {actif.relance1Le ? `envoyée le ${fr(actif.relance1Le)}` : `prévue le ${fr(plus(actif.envoyeLe, 3))}`}, J+7 {actif.relance2Le ? `envoyée le ${fr(actif.relance2Le)}` : `prévue le ${fr(plus(actif.envoyeLe, 7))}`}.</p>
          )}
          {actif.lien && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded bg-gris-clair px-2 py-1 text-xs">{actif.lien}</code>
              <button type="button" className="btn-discret !px-2 !py-1 text-xs" onClick={() => copier(actif.lien!)}><Copy size={13} aria-hidden /> {copie ? "Copié ✓" : "Copier le lien"}</button>
            </div>
          )}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="q-email">Email du client</label>
              <input id="q-email" type="email" className="champ !w-64" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@agence.fr" />
              <button className="btn-secondaire !py-1.5" disabled={pending || !email} onClick={() => run(() => renvoyerQuestionnaireAction(clientId, actif.id, email))}><Mail size={14} aria-hidden /> {actif.envoyeLe ? "Renvoyer" : "Envoyer"}</button>
              <button className="btn-discret !py-1.5 text-rouge-texte" disabled={pending} onClick={() => { if (confirm("Annuler ce questionnaire ? Le lien ne fonctionnera plus.")) run(() => annulerQuestionnaireAction(clientId, actif.id)); }}><XCircle size={14} aria-hidden /> Annuler</button>
            </div>
          )}
        </div>
      ) : auditId === null ? (
        <p className="mt-3 text-sm text-gris-texte">Lancez d&apos;abord un pré-audit ou un audit : le questionnaire complète l&apos;audit en cours.</p>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          {prevues.length ? (
            <>
              <details>
                <summary className="cursor-pointer">{prevues.length} question(s) prévue(s) : critères « client » sans réponse et critères que vous avez marqués « à envoyer au client »{auditFinalise ? " (audit finalisé : les réponses seront ajoutées en commentaire)" : ""}</summary>
                <ol className="mt-2 list-inside list-decimal space-y-1 text-gris-texte">{prevues.map((q) => <li key={q.critereId}>{q.question} <span className="text-xs">({q.critereId})</span></li>)}</ol>
              </details>
              {editable && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="q-email-new">Email du client</label>
                  <input id="q-email-new" type="email" className="champ !w-64" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@agence.fr" />
                  <button className="btn-primaire !py-1.5" disabled={pending || !email} onClick={() => run(() => creerQuestionnaireAction(clientId, auditId, email, true))}>
                    {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Mail size={14} aria-hidden />} Envoyer le questionnaire
                  </button>
                  <button className="btn-discret !py-1.5" disabled={pending} onClick={() => run(() => creerQuestionnaireAction(clientId, auditId, email, false))}>Créer le lien sans envoyer</button>
                </div>
              )}
            </>
          ) : <p className="text-gris-texte">Aucune question à poser : les critères « client » ont tous une réponse.</p>}
        </div>
      )}

      {dernierRepondu && (
        <details className="mt-4" open={!actif}>
          <summary className="cursor-pointer text-sm font-semibold">Réponses du {fr(dernierRepondu.reponduLe)} ({dernierRepondu.reponses.filter((r) => r.reponse).length}/{dernierRepondu.questions.length})</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {dernierRepondu.questions.map((q) => {
              const r = dernierRepondu.reponses.find((x) => x.critereId === q.critereId);
              return (
                <li key={q.critereId} className="rounded-lg bg-gris-clair/50 p-2">
                  <p className="text-gris-texte">{q.question} <span className="text-xs">({q.critereId})</span></p>
                  <p className="font-semibold">{r?.reponse ? texteReponse(q, r.reponse) : "Sans réponse"}{r?.commentaire && <span className="font-normal"> — « {r.commentaire} »</span>}</p>
                </li>
              );
            })}
          </ul>
          {auditId && <Link href={`/audits/${auditId}`} className="mt-2 inline-block text-sm text-horizon hover:underline">Voir l&apos;audit (réponses reportées, source « client ») →</Link>}
        </details>
      )}
    </section>
  );
}
