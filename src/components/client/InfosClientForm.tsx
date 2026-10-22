"use client";

import { useActionState } from "react";
import { majClient } from "@/app/(app)/clients/[id]/actions";

export function InfosClientForm({ client, csms, editable, groupes, modeles }: {
  client: { id: string; nom: string; csmId: number | null; emailContact: string | null; echeanceContrat: string | null; vaGlobalEstime: number | null; googlePlaceId: string | null; groupe: string | null; modele: string | null; vaCompteeDansTotaux: boolean; interlocuteurDigital: string | null };
  csms: { id: number; nom: string }[];
  editable: boolean;
  groupes: string[];
  modeles: string[];
}) {
  const [state, action, pending] = useActionState(majClient, null);
  return (
    <form action={action} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={client.id} />
      <fieldset disabled={!editable} className="contents">
        <label className="flex flex-col gap-1"><span className="libelle">Nom du client</span>
          <input name="nom" defaultValue={client.nom} required minLength={2} className="champ" />
        </label>
        <label className="flex flex-col gap-1"><span className="libelle">Groupe</span>
          <input name="groupe" list="groupes-liste" defaultValue={client.groupe ?? ""} placeholder="Aucun (tapez un nom pour en créer un)" className="champ" />
          <datalist id="groupes-liste">{groupes.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1"><span className="libelle">Modèle de distribution</span>
          <input name="modele" list="modeles-liste" defaultValue={client.modele ?? ""} placeholder="ex. B2C (TO USA)" className="champ" />
          <datalist id="modeles-liste">{modeles.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1"><span className="libelle">CSM attitré</span>
          <select name="csmId" defaultValue={client.csmId ?? ""} className="champ">
            <option value="">— Aucun —</option>
            {csms.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="libelle">Email de contact client</span>
          <input name="emailContact" type="email" defaultValue={client.emailContact ?? ""} className="champ" />
        </label>
        <label className="flex flex-col gap-1"><span className="libelle">Interlocuteur digital (nom, rôle)</span>
          <input name="interlocuteurDigital" defaultValue={client.interlocuteurDigital ?? ""} placeholder="ex. Julie Martin, responsable web" className="champ" />
        </label>
        <label className="flex flex-col gap-1"><span className="libelle">Échéance du contrat</span>
          <input name="echeanceContrat" type="date" defaultValue={client.echeanceContrat ?? ""} className="champ" />
        </label>
        <label className="flex flex-col gap-1"><span className="libelle">VA global estimé (€)</span>
          <input name="vaGlobalEstime" inputMode="numeric" defaultValue={client.vaGlobalEstime ?? ""} className="champ" />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="vaCompteeDansTotaux" defaultChecked={client.vaCompteeDansTotaux} className="size-4 accent-[#0A56FC]" /> VA estimé compté dans les totaux du portefeuille (décochez pour un compte secondaire d&apos;un groupe, dont l&apos;estimation est déjà comptée)</label>
        <label className="flex flex-col gap-1 sm:col-span-2"><span className="libelle">Fiche Google (identifiant Places)</span>
          <input name="googlePlaceId" defaultValue={client.googlePlaceId ?? ""} className="champ font-mono text-sm" placeholder="ChIJ… — renseigné automatiquement par le pré-audit quand le site correspond" aria-describedby="place-aide" />
          <span id="place-aide" className="text-xs text-gris-texte">Utilisé pour la note et les avis Google (VIS-01 à VIS-03). Corrigez-le si le pré-audit a trouvé une autre fiche que celle de l&apos;agence.</span>
        </label>
        {editable && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className="btn-primaire" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
            {state?.ok && <span role="status" className="text-sm text-[#0b7a5e]">✓ Enregistré</span>}
            {state?.erreur && <span role="alert" className="text-sm text-rouge-texte">{state.erreur}</span>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
