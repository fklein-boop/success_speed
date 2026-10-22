"use client";

import { useActionState, useState, useTransition } from "react";
import { Download, Loader2, Send, Sparkles } from "lucide-react";
import { ajouterRdvAction, enregistrerTextesAction, envoyerAction, genererTextesAction } from "@/app/(app)/clients/[id]/restitution/actions";

type Etat = { ok?: boolean; message?: string; erreur?: string } | null;
const Retour = ({ e }: { e: Etat }) => (e?.erreur ? <p role="alert" className="text-sm text-rouge-texte">{e.erreur}</p> : e?.message ? <p role="status" className="text-sm text-[#0b7a5e]">{e.message}</p> : null);

/** Préparation du rendez-vous : textes (Claude ou modèle) modifiables, aperçu PDF, envoi au client, RDV. */
export function PreparationRdv({ clientId, auditId, textes, emailContact, editable, version }: {
  clientId: string; auditId: number; editable: boolean; emailContact: string | null; version: string;
  textes: { synthese: string; emailObjet: string; emailCorps: string; source: string | null; modifieLe: string | null };
}) {
  const [etatTextes, actionTextes, pendingTextes] = useActionState(enregistrerTextesAction, null);
  const [etatEnvoi, actionEnvoi, pendingEnvoi] = useActionState(envoyerAction, null);
  const [etatRdv, actionRdv, pendingRdv] = useActionState(ajouterRdvAction, null);
  const [redaction, setRedaction] = useState<Etat>(null);
  const [pendingIa, start] = useTransition();
  const [apercu, setApercu] = useState(0);
  const [objet, setObjet] = useState(textes.emailObjet);
  const [corps, setCorps] = useState(textes.emailCorps);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="carte overflow-hidden" aria-labelledby="apercu-titre">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gris-clair p-3">
          <h2 id="apercu-titre" className="text-lg">Restitution PDF</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-discret text-xs" onClick={() => setApercu((x) => x + 1)}>Actualiser l&apos;aperçu</button>
            <a className="btn-secondaire !py-1.5" href={`/api/clients/${clientId}/restitution/pdf?telecharger=1`}><Download size={14} aria-hidden /> Télécharger</a>
          </div>
        </div>
        <iframe key={`${version}-${apercu}`} title="Aperçu de la restitution PDF" src={`/api/clients/${clientId}/restitution/pdf?v=${version}-${apercu}`} className="h-[880px] w-full bg-gris-clair" />
        <p className="p-3 text-xs text-gris-texte">Version client : ni score santé, ni alertes de départ, ni chiffres de vente, ni commentaire interne.</p>
      </section>

      <div className="space-y-6">
        <section className="carte p-4" aria-labelledby="textes-titre">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="textes-titre" className="text-lg">Textes</h2>
            {editable && (
              <button type="button" className="btn-secondaire !py-1.5" disabled={pendingIa}
                onClick={() => start(async () => { setRedaction(await genererTextesAction(clientId)); setApercu((x) => x + 1); })}>
                {pendingIa ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
                {textes.source ? "Rédiger à nouveau" : "Rédiger avec Claude"}
              </button>
            )}
          </div>
          <p className="text-xs text-gris-texte">
            {textes.source === "claude" ? "Rédigés par Claude" : textes.source === "modele" ? "Générés à partir des modèles (clé Anthropic non configurée)" : textes.source === "manuel" ? "Modifiés par le CSM" : "Modèles par défaut, non encore enregistrés"}
            {textes.modifieLe ? ` le ${textes.modifieLe}` : ""} · à relire avant envoi.
          </p>
          <Retour e={redaction} />
          <form action={(f) => { actionTextes(f); setApercu((x) => x + 1); }} className="mt-3 space-y-3">
            <input type="hidden" name="clientId" value={clientId} /><input type="hidden" name="auditId" value={auditId} />
            <fieldset disabled={!editable} className="space-y-3">
              <label className="flex flex-col gap-1"><span className="libelle">Synthèse (en tête du PDF)</span>
                <textarea name="synthese" rows={5} defaultValue={textes.synthese} className="champ" />
              </label>
              <label className="flex flex-col gap-1"><span className="libelle">Objet de l&apos;email</span>
                <input name="emailObjet" value={objet} onChange={(e) => setObjet(e.target.value)} className="champ" />
              </label>
              <label className="flex flex-col gap-1"><span className="libelle">Message</span>
                <textarea name="emailCorps" rows={14} value={corps} onChange={(e) => setCorps(e.target.value)} className="champ" />
              </label>
              {editable && <div className="flex items-center gap-3">
                <button className="btn-secondaire" disabled={pendingTextes}>Enregistrer les textes</button>
                <Retour e={etatTextes} />
              </div>}
            </fieldset>
          </form>
        </section>

        {editable && (
          <section className="carte p-4" aria-labelledby="envoi-titre">
            <h2 id="envoi-titre" className="text-lg">Envoyer au client</h2>
            <form action={actionEnvoi} className="mt-3 space-y-3"
              onSubmit={(e) => { if (!confirm("Envoyer la restitution au client maintenant ?")) e.preventDefault(); }}>
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="objet" value={objet} />
              <input type="hidden" name="corps" value={corps} />
              <label className="flex flex-col gap-1"><span className="libelle">Destinataire(s)</span>
                <input name="destinataires" defaultValue={emailContact ?? ""} placeholder="contact@agence.fr (plusieurs : séparez par des virgules)" className="champ" required />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="joindreCsv" defaultChecked /> Joindre l&apos;annexe détaillée critère par critère (CSV)</label>
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-primaire" disabled={pendingEnvoi}>{pendingEnvoi ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />} Envoyer l&apos;email avec le PDF</button>
                <Retour e={etatEnvoi} />
              </div>
              <p className="text-xs text-gris-texte">Réponse du client adressée à votre email. L&apos;envoi est tracé dans l&apos;historique du client.</p>
            </form>
          </section>
        )}

        {editable && (
          <section className="carte p-4" aria-labelledby="rdv-form-titre">
            <h2 id="rdv-form-titre" className="text-lg">Enregistrer un rendez-vous</h2>
            <form action={actionRdv} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="clientId" value={clientId} />
              <label className="flex flex-col gap-1"><span className="libelle">Date et heure (Paris)</span><input type="datetime-local" name="date" required className="champ" /></label>
              <label className="flex flex-col gap-1"><span className="libelle">Objet</span><input name="objet" defaultValue="Restitution de l'audit" required className="champ" /></label>
              <label className="flex flex-col gap-1 sm:col-span-2"><span className="libelle">Notes (internes)</span><textarea name="notes" rows={2} className="champ" /></label>
              <div className="flex items-center gap-3 sm:col-span-2"><button className="btn-secondaire" disabled={pendingRdv}>Enregistrer le RDV</button><Retour e={etatRdv} /></div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
