"use client";

import { useActionState } from "react";
import { ajouterUtilisateurs, reattribuerClients } from "@/app/(app)/utilisateurs/actions";

export function AjoutUtilisateurs() {
  const [state, action, pending] = useActionState(ajouterUtilisateurs, null);
  return (
    <form action={action} className="mt-3 space-y-3">
      <label className="flex flex-col gap-1">
        <span className="libelle">Adresses email</span>
        <textarea name="emails" rows={3} required className="champ" placeholder={"Collez une ou plusieurs adresses (une par ligne, ou séparées par des virgules)"} />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="libelle">Rôle</span>
          <select name="role" defaultValue="csm" className="champ w-44">
            <option value="csm">CSM</option>
            <option value="lecture">Lecture seule</option>
            <option value="superadmin">Super admin</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="inviter" defaultChecked className="size-4 accent-[#0A56FC]" /> Envoyer l&apos;invitation par email</label>
        <button className="btn-primaire ml-auto" disabled={pending}>{pending ? "Ajout…" : "Ajouter"}</button>
      </div>
      {state?.message && <p role="status" className="text-sm text-[#0b7a5e]">{state.message}</p>}
      {state?.erreur && <p role="alert" className="text-sm text-rouge-texte">{state.erreur}</p>}
    </form>
  );
}

export function Reattribution({ csms }: { csms: { id: number; nom: string; n: number }[] }) {
  const [state, action, pending] = useActionState(reattribuerClients, null);
  return (
    <form action={action} className="mt-3 space-y-3">
      <label className="flex flex-col gap-1"><span className="libelle">CSM qui part</span>
        <select name="de" required className="champ">{csms.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.n} clients)</option>)}</select>
      </label>
      <label className="flex flex-col gap-1"><span className="libelle">Nouveau CSM</span>
        <select name="vers" className="champ"><option value="">— Aucun —</option>{csms.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</select>
      </label>
      <button className="btn-secondaire" disabled={pending}>Réattribuer</button>
      {state?.message && <p role="status" className="text-sm text-[#0b7a5e]">{state.message}</p>}
      {state?.erreur && <p role="alert" className="text-sm text-rouge-texte">{state.erreur}</p>}
    </form>
  );
}
