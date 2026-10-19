"use client";

import { useRef, useState } from "react";
import { Check, Loader2, MessageSquarePlus } from "lucide-react";
import { LIBELLE_REPONSE, REPONSES_OUI_NON, type Question } from "@/lib/questionnaire/questions";

type Rep = { reponse: string | null; commentaire: string | null };

/** Questionnaire client : une carte par question, sauvegarde automatique, envoi final. */
export function FormulaireClient({ token, client, csm, questions, reponsesInitiales }: {
  token: string; client: string | null; csm: string | null; questions: Question[]; reponsesInitiales: Record<string, Rep>;
}) {
  const [reps, setReps] = useState<Record<string, Rep>>(reponsesInitiales);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<"idle" | "envoi" | "fait">("idle");
  const [commentaireOuvert, setCommentaireOuvert] = useState<Record<string, boolean>>({});
  const minuteurs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const faites = questions.filter((q) => reps[q.critereId]?.reponse).length;

  const sauver = async (critereId: string, r: Rep) => {
    setEnCours(critereId);
    setErreur(null);
    const res = await fetch(`/api/q/${token}/reponse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ critereId, reponse: r.reponse ?? "", commentaire: r.commentaire }) }).catch(() => null);
    setEnCours(null);
    if (!res?.ok) setErreur((await res?.json().catch(() => null))?.erreur ?? "Enregistrement impossible : vérifiez votre connexion.");
  };
  const maj = (critereId: string, patch: Partial<Rep>, differe = false) => {
    const r: Rep = { ...(reps[critereId] ?? { reponse: null, commentaire: null }), ...patch };
    setReps((x) => ({ ...x, [critereId]: r }));
    clearTimeout(minuteurs.current[critereId]);
    if (differe) minuteurs.current[critereId] = setTimeout(() => void sauver(critereId, r), 700);
    else void sauver(critereId, r);
  };
  const envoyer = async () => {
    setEnvoi("envoi");
    setErreur(null);
    const res = await fetch(`/api/q/${token}/envoyer`, { method: "POST" }).catch(() => null);
    if (res?.ok) { setEnvoi("fait"); window.scrollTo({ top: 0 }); return; }
    setEnvoi("idle");
    setErreur((await res?.json().catch(() => null))?.erreur ?? "Envoi impossible : vérifiez votre connexion.");
  };

  if (envoi === "fait") {
    return (
      <div className="carte p-6 text-center" role="status">
        <Check size={40} className="mx-auto text-[#0b7a5e]" aria-hidden />
        <h1 className="mt-2 text-xl">Merci, vos réponses ont bien été reçues</h1>
        <p className="mt-2 text-gris-texte">{csm ? `${csm} les intègre` : "Votre chargé(e) de clientèle les intègre"} à votre audit et reviendra vers vous avec ses recommandations.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl leading-tight">{client ? `${client} : quelques questions` : "Quelques questions sur votre agence"}</h1>
      <p className="mt-2 text-gris-texte">
        {csm ? `${csm}, votre chargé(e) de clientèle SpeedResa,` : "Votre chargé(e) de clientèle SpeedResa"} complète l&apos;audit de votre présence numérique.
        Ces {questions.length} questions portent sur ce que nous ne pouvons pas voir depuis votre site. Comptez 3 à 5 minutes ; vos réponses sont enregistrées au fur et à mesure.
      </p>

      <div className="sticky top-0 z-10 -mx-4 mt-4 bg-[#f6f8fb]/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center justify-between text-sm"><span>{faites} / {questions.length} réponses</span>{enCours && <span className="inline-flex items-center gap-1 text-gris-texte"><Loader2 size={12} className="animate-spin" aria-hidden /> Enregistrement…</span>}</div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-gris-clair" role="progressbar" aria-valuenow={faites} aria-valuemin={0} aria-valuemax={questions.length} aria-label="Progression">
          <div className="bg-degrade h-full transition-all" style={{ width: `${(faites / Math.max(1, questions.length)) * 100}%` }} />
        </div>
      </div>

      <ol className="mt-4 space-y-4">
        {questions.map((q, i) => {
          const r = reps[q.critereId] ?? { reponse: null, commentaire: null };
          const id = `q-${q.critereId}`;
          return (
            <li key={q.critereId} className="carte p-4">
              <fieldset>
                <legend className="font-semibold"><span className="text-gris-texte">{i + 1}. </span>{q.question}</legend>
                {q.aide && <p className="mt-1 text-sm text-gris-texte">{q.aide}</p>}
                {q.type === "oui_non" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {REPONSES_OUI_NON.map((v) => (
                      <label key={v} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-center font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-horizon ${r.reponse === v ? "border-horizon bg-horizon text-white" : "border-gris-clair bg-white hover:border-horizon/50"}`}>
                        <input type="radio" name={id} value={v} checked={r.reponse === v} onChange={() => maj(q.critereId, { reponse: v })} className="sr-only" />
                        {r.reponse === v && <Check size={16} className="mr-1" aria-hidden />}{LIBELLE_REPONSE[v]}
                      </label>
                    ))}
                  </div>
                ) : q.type === "note10" ? (
                  <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-11">
                    {Array.from({ length: 11 }, (_, n) => String(n)).map((v) => (
                      <label key={v} className={`flex h-11 cursor-pointer items-center justify-center rounded-lg border-2 font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-horizon ${r.reponse === v ? "border-horizon bg-horizon text-white" : "border-gris-clair bg-white"}`}>
                        <input type="radio" name={id} value={v} checked={r.reponse === v} onChange={() => maj(q.critereId, { reponse: v })} className="sr-only" aria-label={`${v} sur 10`} />{v}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <label className="sr-only" htmlFor={id}>{q.question}</label>
                    <input id={id} inputMode="decimal" className="champ !w-32 text-lg" value={r.reponse === "ne_sais_pas" ? "" : r.reponse ?? ""}
                      onChange={(e) => maj(q.critereId, { reponse: e.target.value.replace(/[^\d,.]/g, "") || null }, true)} placeholder="0" />
                    <span className="text-gris-texte">{q.type === "pourcentage" ? "%" : q.unite ?? ""}</span>
                    <button type="button" className={`ml-auto rounded-lg border-2 px-3 py-2 text-sm font-semibold ${r.reponse === "ne_sais_pas" ? "border-horizon bg-horizon text-white" : "border-gris-clair"}`} onClick={() => maj(q.critereId, { reponse: "ne_sais_pas" })}>Je ne sais pas</button>
                  </div>
                )}
              </fieldset>
              {commentaireOuvert[q.critereId] || r.commentaire ? (
                <label className="mt-3 block"><span className="text-sm text-gris-texte">Précision (facultatif)</span>
                  <textarea rows={2} maxLength={1000} className="champ mt-1" value={r.commentaire ?? ""} onChange={(e) => maj(q.critereId, { commentaire: e.target.value }, true)} />
                </label>
              ) : (
                <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm text-horizon" onClick={() => setCommentaireOuvert((x) => ({ ...x, [q.critereId]: true }))}><MessageSquarePlus size={14} aria-hidden /> Ajouter une précision</button>
              )}
            </li>
          );
        })}
      </ol>

      {erreur && <p role="alert" className="mt-4 rounded-lg bg-[#fdecec] p-3 text-sm text-rouge-texte">{erreur}</p>}
      <div className="mt-6">
        <button className="btn-primaire w-full !py-3.5 text-base" disabled={envoi === "envoi" || faites === 0} onClick={envoyer}>
          {envoi === "envoi" && <Loader2 size={16} className="animate-spin" aria-hidden />} Envoyer mes réponses{faites < questions.length ? ` (${faites}/${questions.length})` : ""}
        </button>
        <p className="mt-2 text-center text-xs text-gris-texte">{faites < questions.length ? "Vous pouvez envoyer même si vous n'avez pas répondu à tout. " : ""}Après l&apos;envoi, vos réponses ne seront plus modifiables.</p>
      </div>
    </div>
  );
}
