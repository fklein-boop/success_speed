"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { choisirMotDePasse } from "../connexion/actions";

export function FormChoixMotDePasse({ demanderActuel, provisoire }: { demanderActuel: boolean; provisoire: boolean }) {
  const [state, action, pending] = useActionState(choisirMotDePasse, null);
  return (
    <form action={action} className="mt-6 space-y-3">
      {demanderActuel && (
        <>
          <label htmlFor="actuel" className="libelle block">{provisoire ? "Mot de passe provisoire" : "Mot de passe actuel"}</label>
          <input id="actuel" name="actuel" type="password" required autoComplete="current-password" className="champ" />
        </>
      )}
      <label htmlFor="nouveau" className="libelle block">Nouveau mot de passe</label>
      <input id="nouveau" name="nouveau" type="password" required minLength={12} autoComplete="new-password" className="champ" />
      <label htmlFor="confirmation" className="libelle block">Confirmation</label>
      <input id="confirmation" name="confirmation" type="password" required minLength={12} autoComplete="new-password" className="champ" />
      {state?.erreur && <p role="alert" className="text-sm text-rouge-texte">{state.erreur}</p>}
      <button type="submit" className="btn-primaire w-full" disabled={pending}><KeyRound size={16} aria-hidden /> {pending ? "Enregistrement…" : "Enregistrer mon mot de passe"}</button>
    </form>
  );
}
