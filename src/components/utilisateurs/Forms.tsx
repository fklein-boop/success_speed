"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { ajouterUtilisateurs, genererLienConnexion, reattribuerClients } from "@/app/(app)/utilisateurs/actions";

/** Lien de connexion à usage unique, valable 7 jours, à copier et transmettre soi-même (Teams, Slack, SMS…). */
export function LienConnexion({ id, email }: { id: number; email: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ url?: string; erreur?: string } | null>(null);
  const [copie, setCopie] = useState(false);
  if (res?.url) {
    return (
      <div className="flex w-72 flex-col gap-1">
        <div className="flex gap-1">
          <label className="sr-only" htmlFor={`lien-${id}`}>Lien de connexion pour {email}</label>
          <input id={`lien-${id}`} readOnly value={res.url} onFocus={(e) => e.currentTarget.select()} className="champ py-1 font-mono text-xs" />
          <button type="button" className="btn-secondaire px-2 py-1 text-xs" onClick={async () => { try { await navigator.clipboard.writeText(res.url!); setCopie(true); } catch { setCopie(false); } }}>
            {copie ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}<span className="sr-only">Copier</span>
          </button>
        </div>
        <p className="text-xs text-gris-texte">{copie ? "Copié. " : ""}Usage unique, valable 7 jours. À envoyer à {email} uniquement, par un canal privé.</p>
      </div>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn-discret px-2 py-1 text-xs" disabled={pending} onClick={() => start(async () => setRes(await genererLienConnexion(id)))}>
        {pending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Link2 size={12} aria-hidden />} Lien de connexion
      </button>
      {res?.erreur && <span role="alert" className="text-xs text-rouge-texte">{res.erreur}</span>}
    </span>
  );
}

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
