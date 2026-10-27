"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { enregistrerReglages } from "@/lib/server/facturation";
import { texteEnTable } from "@/lib/facturation/calcul";

type Etat = { ok?: boolean; message?: string; erreur?: string } | null;
const nombre = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim().replace(",", "."));

export async function reglagesFacturationAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await assertUser(["superadmin"]);
  try {
    const production = texteEnTable(String(form.get("production") ?? ""));
    await enregistrerReglages(await getDb(), u.id, { demande: nombre(form.get("demande")), resaliveInterne: nombre(form.get("resaliveInterne")), resaliveExterne: nombre(form.get("resaliveExterne")) / 100 }, production);
    revalidatePath("/facturation");
    return { ok: true, message: `Réglages enregistrés (${Object.keys(production).length} agences avec production interne).` };
  } catch (e) { return { erreur: e instanceof AuditError || e instanceof Error ? e.message : "Erreur" }; }
}
