"use client";

import { useActionState, useState } from "react";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import { connexionCompteTest, connexionParMotDePasse, demanderLien } from "./actions";

/** Compte de test (variables TEST_LOGIN_*) : email et mot de passe, sans lien magique. */
function FormTest() {
  const [state, action, pending] = useActionState(connexionCompteTest, null);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-gris-clair p-4">
      <p className="text-sm font-semibold">Compte de test</p>
      <label htmlFor="email-test" className="libelle block">Email du compte de test</label>
      <input id="email-test" name="email" type="email" required autoComplete="username" defaultValue={state?.email} className="champ" />
      <label htmlFor="mdp-test" className="libelle block">Mot de passe</label>
      <input id="mdp-test" name="motDePasse" type="password" required autoComplete="current-password" className="champ" />
      {state?.erreur && <p role="alert" className="text-sm text-rouge-texte">{state.erreur}</p>}
      <button type="submit" className="btn-primaire w-full" disabled={pending}><KeyRound size={16} aria-hidden /> {pending ? "Connexion…" : "Se connecter"}</button>
    </form>
  );
}

/** Identifiant (email) et mot de passe, créés par le super admin dans « Utilisateurs ». */
function FormMotDePasse() {
  const [state, action, pending] = useActionState(connexionParMotDePasse, null);
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="email-mdp" className="libelle block">Identifiant (adresse email)</label>
      <input id="email-mdp" name="email" type="email" required autoComplete="username" defaultValue={state?.email} className="champ" placeholder="prenom.nom@speedmedia.fr" />
      <label htmlFor="mdp" className="libelle block">Mot de passe</label>
      <input id="mdp" name="motDePasse" type="password" required autoComplete="current-password" className="champ" />
      {state?.erreur && <p role="alert" className="text-sm text-rouge-texte">{state.erreur}</p>}
      <button type="submit" className="btn-primaire w-full" disabled={pending}><KeyRound size={16} aria-hidden /> {pending ? "Connexion…" : "Se connecter"}</button>
    </form>
  );
}

export function LoginForm({ google, test = false }: { google: boolean; test?: boolean }) {
  const [state, action, pending] = useActionState(demanderLien, null);
  const [voirTest, setVoirTest] = useState(false);
  const [parLien, setParLien] = useState(false);
  if (state?.envoye) {
    return (
      <div role="status" className="mt-6 rounded-lg bg-emeraude/15 p-4 text-sm">
        <p className="font-semibold">Vérifiez votre boîte de réception.</p>
        <p className="mt-1">Si l&apos;adresse <strong>{state.email}</strong> est autorisée, un lien de connexion valable 15 minutes vient de lui être envoyé.</p>
        {state.lienLocal && (
          <p className="mt-3 border-t border-minuit/10 pt-3">Mode local (aucun email envoyé) : <a href={state.lienLocal} className="font-semibold text-horizon underline">ouvrir le lien de connexion →</a></p>
        )}
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-4">
      {!parLien ? (
        <>
          <FormMotDePasse />
          <button type="button" onClick={() => setParLien(true)} className="btn-discret w-full text-xs"><Mail size={14} aria-hidden /> Recevoir plutôt un lien de connexion par email</button>
        </>
      ) : (
      <form action={action} className="space-y-3">
        <label htmlFor="email" className="libelle block">Adresse email professionnelle</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="champ" placeholder="prenom.nom@speedmedia.fr" />
        <button type="submit" className="btn-primaire w-full" disabled={pending}>
          <Mail size={16} aria-hidden /> {pending ? "Envoi…" : "Recevoir mon lien de connexion"} <ArrowRight size={16} aria-hidden />
        </button>
        <button type="button" onClick={() => setParLien(false)} className="btn-discret w-full text-xs"><KeyRound size={14} aria-hidden /> Se connecter avec un mot de passe</button>
      </form>
      )}
      {google && (
        <>
          <div className="flex items-center gap-3 text-xs text-gris-texte"><span className="h-px flex-1 bg-gris-clair" />ou<span className="h-px flex-1 bg-gris-clair" /></div>
          <a href="/api/auth/google" className="btn-secondaire w-full">Continuer avec Google</a>
        </>
      )}
      {test && (voirTest ? <FormTest /> : <button type="button" onClick={() => setVoirTest(true)} className="btn-discret w-full text-xs">Connexion avec le compte de test</button>)}
    </div>
  );
}
