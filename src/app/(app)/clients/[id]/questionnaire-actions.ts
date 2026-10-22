"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { annulerQuestionnaire, creerQuestionnaire, envoyerQuestionnaire } from "@/lib/server/questionnaires";

type Etat = { ok?: boolean; message?: string; erreur?: string; lien?: string } | null;
const erreur = (e: unknown): Etat => ({ erreur: e instanceof AuditError || e instanceof Error ? e.message : "Erreur inattendue" });

export async function creerQuestionnaireAction(clientId: string, auditId: number, email: string, envoyer: boolean, criteres?: string[]): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    const r = await creerQuestionnaire(await getDb(), auditId, u.id, { email, envoyer, criteres });
    revalidatePath(`/audits/${auditId}`);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, lien: r.lien, message: envoyer ? `Questionnaire de ${r.questions} questions envoyé à ${email}.` : `Lien créé (${r.questions} questions) : copiez-le pour l'envoyer vous-même.` };
  } catch (e) { return erreur(e); }
}

export async function renvoyerQuestionnaireAction(clientId: string, id: number, email: string): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    await envoyerQuestionnaire(await getDb(), id, u.id, email);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, message: "Invitation envoyée." };
  } catch (e) { return erreur(e); }
}

export async function annulerQuestionnaireAction(clientId: string, id: number): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  await annulerQuestionnaire(await getDb(), id, u.id);
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Questionnaire annulé : le lien ne fonctionne plus." };
}
