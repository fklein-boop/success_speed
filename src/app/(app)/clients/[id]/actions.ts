"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { clients, clientUrls } from "@/db/schema";
import { assertUser } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/activity";
import { recomputeAll } from "@/lib/server/recompute";
import { groupeParNom } from "@/lib/server/clients-admin";

const Infos = z.object({
  id: z.string(),
  csmId: z.string(),
  emailContact: z.union([z.literal(""), z.email()]),
  echeanceContrat: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  vaGlobalEstime: z.string(),
  googlePlaceId: z.union([z.literal(""), z.string().trim().regex(/^[A-Za-z0-9_-]{10,200}$/)]).default(""),
  nom: z.string().trim().min(2).max(120).optional(),
  groupe: z.string().trim().max(120).default(""),
  modele: z.string().trim().max(120).default(""),
  vaCompteeDansTotaux: z.string().optional(),
});

export async function majClient(_: unknown, form: FormData) {
  const u = await assertUser(["superadmin", "csm"]);
  const p = Infos.safeParse(Object.fromEntries(form));
  if (!p.success) return { erreur: "Valeurs invalides (vérifiez l'email, la date et l'identifiant de fiche Google)." };
  const d = p.data;
  const va = d.vaGlobalEstime.trim() === "" ? null : Number(d.vaGlobalEstime.replace(/\s/g, "").replace(",", "."));
  if (va !== null && !Number.isFinite(va)) return { erreur: "Volume d'affaires estimé invalide." };
  const db = await getDb();
  const [avant] = await db.select().from(clients).where(eq(clients.id, d.id));
  await db.update(clients).set({
    csmId: d.csmId ? Number(d.csmId) : null,
    emailContact: d.emailContact || null,
    echeanceContrat: d.echeanceContrat || null,
    vaGlobalEstime: va,
    googlePlaceId: d.googlePlaceId || null,
    ...(d.nom ? { nom: d.nom } : {}),
    groupeId: await groupeParNom(db, d.groupe),
    modele: d.modele || null,
    vaCompteeDansTotaux: d.vaCompteeDansTotaux === "on",
  }).where(eq(clients.id, d.id));
  await logActivity(u.id, "client_modifie", "client", d.id, { csmId: d.csmId, echeance: d.echeanceContrat });
  if (avant && (avant.vaGlobalEstime !== va || avant.vaCompteeDansTotaux !== (d.vaCompteeDansTotaux === "on"))) await recomputeAll(db);
  revalidatePath(`/clients/${d.id}`);
  return { ok: true };
}

export async function ajouterUrl(form: FormData) {
  const u = await assertUser(["superadmin", "csm"]);
  const id = String(form.get("id"));
  let url = String(form.get("url") ?? "").trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try { url = new URL(url).toString(); } catch { return; }
  const db = await getDb();
  const existantes = await db.select().from(clientUrls).where(eq(clientUrls.clientId, id));
  await db.insert(clientUrls).values({ clientId: id, url, principale: existantes.length === 0 }).onConflictDoNothing();
  await logActivity(u.id, "url_ajoutee", "client", id, { url });
  revalidatePath(`/clients/${id}`);
}

export async function supprimerUrl(form: FormData) {
  const u = await assertUser(["superadmin", "csm"]);
  const id = String(form.get("id"));
  const urlId = Number(form.get("urlId"));
  const db = await getDb();
  await db.delete(clientUrls).where(and(eq(clientUrls.id, urlId), eq(clientUrls.clientId, id)));
  await logActivity(u.id, "url_supprimee", "client", id, { urlId });
  revalidatePath(`/clients/${id}`);
}
