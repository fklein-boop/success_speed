"use client";

import { useActionState, useTransition, useState } from "react";
import { Loader2 } from "lucide-react";

type Etat = { ok?: boolean; message?: string; erreur?: string } | null;
const Retour = ({ e }: { e: Etat }) => (e?.erreur ? <p role="alert" className="text-sm text-rouge-texte">{e.erreur}</p> : e?.message ? <p role="status" className="text-sm text-[#0b7a5e]">{e.message}</p> : null);

/** Formulaire d'administration : action serveur, état d'envoi et message de retour. */
export function FormAdmin({ action, children, bouton = "Enregistrer", className = "" }: { action: (e: Etat, f: FormData) => Promise<Etat>; children: React.ReactNode; bouton?: string; className?: string }) {
  const [etat, act, pending] = useActionState(action, null);
  return (
    <form action={act} className={className}>
      {children}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primaire" disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" aria-hidden />}{bouton}</button>
        <Retour e={etat} />
      </div>
    </form>
  );
}

/** Bouton d'action sans formulaire (réinitialiser, lancer), avec confirmation facultative. */
export function BoutonAction({ action, label, confirmation, className = "btn-secondaire" }: { action: () => Promise<Etat>; label: string; confirmation?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [etat, setEtat] = useState<Etat>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button type="button" className={className} disabled={pending} onClick={() => { if (confirmation && !confirm(confirmation)) return; start(async () => setEtat(await action())); }}>
        {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}{label}
      </button>
      <Retour e={etat} />
    </span>
  );
}
