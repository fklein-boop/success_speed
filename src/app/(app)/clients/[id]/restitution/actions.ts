"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { parisVersUtc } from "@/lib/format";
import { enregistrerFeuille, majSuiviChantier, proposerFeuille, validerFeuille } from "@/lib/server/feuille";
import { SchemaFeuille, SUIVIS } from "@/lib/restitution/feuille";
import { ajouterRdv, enregistrerTextes, envoyerRestitution, genererPlan, genererTextes, majAction, STATUTS_ACTION } from "@/lib/server/restitution";

type Etat = { ok?: boolean; message?: string; erreur?: string } | null;

const erreur = (e: unknown): Etat => ({ erreur: e instanceof AuditError || e instanceof Error ? e.message : "Erreur inattendue" });
const rafraichir = (id: string) => { revalidatePath(`/clients/${id}`); revalidatePath(`/clients/${id}/restitution`); };

export async function genererPlanAction(clientId: string, suivantes = false): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    const r = await genererPlan(await getDb(), clientId, u.id, suivantes);
    rafraichir(clientId);
    return { ok: true, message: r.creees ? `${r.creees} action(s) ajoutée(s) au plan.` : "Le plan est déjà à jour." };
  } catch (e) { return erreur(e); }
}

const Maj = z.object({ statut: z.enum(STATUTS_ACTION).optional(), echeance: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(), commentaire: z.string().max(1000).optional() });

export async function majActionAction(clientId: string, actionId: number, patch: z.infer<typeof Maj>): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  const p = Maj.safeParse(patch);
  if (!p.success) return { erreur: "Valeur invalide." };
  try {
    const r = await majAction(await getDb(), actionId, u.id, { ...p.data, echeance: p.data.echeance === "" ? null : p.data.echeance });
    rafraichir(clientId);
    return { ok: true, message: r.verification === "scan" ? "Action faite : re-vérification automatique lancée." : r.verification === "donnees" ? "Action faite : critère recalculé sur les dernières données." : r.verification === "manuel" ? "Action faite : à confirmer au prochain audit." : undefined };
  } catch (e) { return erreur(e); }
}

export async function genererTextesAction(clientId: string): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    const r = await genererTextes(await getDb(), clientId, u.id);
    rafraichir(clientId);
    return { ok: true, message: r.source === "claude" ? "Textes rédigés par Claude : relisez-les avant envoi." : "Textes générés à partir des modèles (clé Anthropic non configurée)." };
  } catch (e) { return erreur(e); }
}

const Textes = z.object({ clientId: z.string(), auditId: z.coerce.number().int(), synthese: z.string().max(4000), emailObjet: z.string().max(200), emailCorps: z.string().max(8000) });

export async function enregistrerTextesAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  const p = Textes.safeParse(Object.fromEntries(form));
  if (!p.success) return { erreur: "Textes trop longs ou incomplets." };
  const { clientId, auditId, ...x } = p.data;
  await enregistrerTextes(await getDb(), clientId, auditId, u.id, x);
  rafraichir(clientId);
  return { ok: true, message: "Textes enregistrés." };
}

const Envoi = z.object({ clientId: z.string(), destinataires: z.string().max(500), objet: z.string().max(200), corps: z.string().max(8000), joindreCsv: z.string().optional() });

export async function envoyerAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  const p = Envoi.safeParse(Object.fromEntries(form));
  if (!p.success) return { erreur: "Formulaire incomplet." };
  try {
    const r = await envoyerRestitution(await getDb(), p.data.clientId, u.id, { destinataires: p.data.destinataires, objet: p.data.objet, corps: p.data.corps, joindreCsv: p.data.joindreCsv === "on" });
    rafraichir(p.data.clientId);
    return { ok: true, message: `Envoyé avec ${r.pieces.join(" et ")}.` };
  } catch (e) { return erreur(e); }
}

const Rdv = z.object({ clientId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), objet: z.string().min(1).max(200), notes: z.string().max(2000).optional() });

export async function ajouterRdvAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  const p = Rdv.safeParse(Object.fromEntries(form));
  if (!p.success) return { erreur: "Date et objet obligatoires." };
  // Saisie en heure de Paris
  await ajouterRdv(await getDb(), p.data.clientId, u.id, { date: parisVersUtc(p.data.date), objet: p.data.objet, notes: p.data.notes || null });
  rafraichir(p.data.clientId);
  return { ok: true, message: "Rendez-vous enregistré." };
}

// ───────── Feuille de route (lot C) ─────────

export async function proposerFeuilleAction(clientId: string): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    const r = await proposerFeuille(await getDb(), clientId, u.id);
    rafraichir(clientId);
    return { ok: true, message: `${r.chantiers} chantier(s) proposé(s) ${r.source === "claude" ? "par Claude" : "par regroupement automatique (sans clé Anthropic)"} : ajustez-les, puis validez.` };
  } catch (e) { return erreur(e); }
}

export async function enregistrerFeuilleAction(clientId: string, feuille: unknown): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    await enregistrerFeuille(await getDb(), clientId, u.id, SchemaFeuille.parse(feuille));
    rafraichir(clientId);
    return { ok: true, message: "Feuille de route enregistrée." };
  } catch (e) { return erreur(e); }
}

export async function validerFeuilleAction(clientId: string, feuille: unknown): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    const db = await getDb();
    await enregistrerFeuille(db, clientId, u.id, SchemaFeuille.parse(feuille));
    const r = await validerFeuille(db, clientId, u.id);
    rafraichir(clientId);
    return { ok: true, message: `Feuille de route validée : ${r.chantiers} chantier(s)${r.actionsCreees ? `, ${r.actionsCreees} action(s) ajoutée(s) au plan` : ""}. Le PDF, l'email et la présentation la reprennent.` };
  } catch (e) { return erreur(e); }
}

export async function suiviChantierAction(clientId: string, chantierId: string, suivi: string): Promise<Etat> {
  const u = await assertUser(["superadmin", "csm"]);
  try {
    await majSuiviChantier(await getDb(), clientId, u.id, chantierId, z.enum(SUIVIS).parse(suivi));
    rafraichir(clientId);
    return { ok: true };
  } catch (e) { return erreur(e); }
}
