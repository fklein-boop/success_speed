"use server";

import { redirect } from "next/navigation";
import { changerMotDePasse, connexionMotDePasse, connexionTest, consumeMagicLink, createSession, destroySession, getCurrentUser, requestMagicLink } from "@/lib/server/auth";

export async function demanderLien(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "");
  const lienLocal = await requestMagicLink(email);
  return { envoye: true, email, lienLocal };
}

export async function verifierLien(form: FormData) {
  const token = String(form.get("token") ?? "");
  const user = token ? await consumeMagicLink(token) : null;
  if (!user) redirect("/connexion?erreur=lien");
  await createSession(user, "lien");
  redirect("/");
}

export async function connexionCompteTest(_: unknown, form: FormData) {
  const user = await connexionTest(String(form.get("email") ?? ""), String(form.get("motDePasse") ?? ""));
  if (!user) return { erreur: "Identifiants incorrects, ou trop de tentatives : réessayez dans 15 minutes.", email: String(form.get("email") ?? "") };
  await createSession(user, "test");
  redirect("/");
}

export async function connexionParMotDePasse(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "");
  const user = await connexionMotDePasse(email, String(form.get("motDePasse") ?? ""));
  if (!user) return { erreur: "Identifiant ou mot de passe incorrect. Après 5 essais, attendez 15 minutes.", email };
  await createSession(user, "mot_de_passe");
  redirect(user.motDePasseTemporaire ? "/mot-de-passe" : "/");
}

export async function choisirMotDePasse(_: unknown, form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const nouveau = String(form.get("nouveau") ?? "");
  if (nouveau !== String(form.get("confirmation") ?? "")) return { erreur: "Les deux saisies ne correspondent pas." };
  const r = await changerMotDePasse(user, String(form.get("actuel") ?? ""), nouveau);
  if ("erreur" in r) return r;
  redirect("/?mdp=1");
}

export async function deconnexion() {
  await destroySession();
  redirect("/connexion");
}
