"use server";

import { redirect } from "next/navigation";
import { consumeMagicLink, createSession, destroySession, requestMagicLink } from "@/lib/server/auth";

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

export async function deconnexion() {
  await destroySession();
  redirect("/connexion");
}
