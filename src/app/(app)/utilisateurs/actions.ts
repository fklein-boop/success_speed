"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { clients, users } from "@/db/schema";
import { appUrl, assertUser, isSuperadminEmail, normalizeEmail } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/activity";
import { emailLayout, sendEmail } from "@/lib/server/email";

const ROLES = ["superadmin", "csm", "lecture"] as const;
const ROLE_LIB: Record<string, string> = { superadmin: "super admin", csm: "CSM", lecture: "lecture seule" };

async function inviter(email: string, role: string, par: string) {
  return sendEmail({
    to: email,
    subject: "Invitation — Plateforme d'audit CSM SpeedResa",
    text: `Bonjour,\n\n${par} vous a donné accès à la plateforme d'audit CSM SpeedResa (rôle : ${ROLE_LIB[role]}).\nConnectez-vous avec cette adresse email : ${appUrl()}/connexion\n\nAucun mot de passe n'est nécessaire : un lien de connexion vous sera envoyé.`,
    html: emailLayout({
      titre: "Vous avez accès à la plateforme d'audit CSM",
      paragraphes: [
        "Bonjour,",
        `${par} vous a donné accès à la plateforme d'audit et de pilotage Customer Success (rôle : ${ROLE_LIB[role]}).`,
        "Connectez-vous avec cette adresse email : aucun mot de passe n'est nécessaire, un lien de connexion vous sera envoyé.",
      ],
      bouton: { label: "Accéder à la plateforme", url: `${appUrl()}/connexion` },
    }),
  });
}

export async function ajouterUtilisateurs(_: unknown, form: FormData) {
  const admin = await assertUser(["superadmin"]);
  const role = z.enum(ROLES).parse(form.get("role"));
  const envoyer = form.get("inviter") === "on";
  const brut = String(form.get("emails") ?? "");
  // Accepte un collage de liste : séparateurs virgule, point-virgule, espaces, retours à la ligne, « Nom <email> »
  const trouves = [...brut.matchAll(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g)].map((m) => normalizeEmail(m[0]));
  const emails = [...new Set(trouves)];
  if (!emails.length) return { erreur: "Aucune adresse email valide trouvée." };
  const db = await getDb();
  const existants = new Set((await db.select({ email: users.email }).from(users).where(inArray(users.email, emails))).map((u) => u.email));
  const nouveaux = emails.filter((e) => !existants.has(e));
  if (nouveaux.length) {
    await db.insert(users).values(nouveaux.map((email) => ({ email, role, invitePar: admin.id, inviteLe: envoyer ? new Date() : null, peutImporter: role === "superadmin" })));
  }
  let echecs = 0;
  if (envoyer) for (const e of nouveaux) if (!(await inviter(e, role, admin.nom || admin.email)).ok) echecs++;
  await logActivity(admin.id, "utilisateur_ajoute", "user", undefined, { emails: nouveaux, role, invitation: envoyer });
  revalidatePath("/utilisateurs");
  return {
    ok: true,
    message: `${nouveaux.length} utilisateur(s) ajouté(s)${existants.size ? `, ${existants.size} déjà présent(s)` : ""}${envoyer ? (echecs ? `, ${echecs} invitation(s) non envoyée(s)` : ", invitations envoyées") : ""}.`,
  };
}

const Modif = z.object({
  id: z.coerce.number(),
  champ: z.enum(["role", "actif", "peutImporter", "nom"]),
  valeur: z.string(),
});

export async function modifierUtilisateur(form: FormData) {
  const admin = await assertUser(["superadmin"]);
  const { id, champ, valeur } = Modif.parse(Object.fromEntries(form));
  const db = await getDb();
  const [cible] = await db.select().from(users).where(eq(users.id, id));
  if (!cible) return;
  // Le super admin défini au déploiement ne peut être ni désactivé ni rétrogradé
  if (isSuperadminEmail(cible.email) && (champ === "role" || champ === "actif")) return;
  if (cible.id === admin.id && (champ === "role" || champ === "actif")) return;
  const set =
    champ === "role" ? { role: z.enum(ROLES).parse(valeur) } :
    champ === "actif" ? { actif: valeur === "true" } :
    champ === "peutImporter" ? { peutImporter: valeur === "true" } :
    { nom: valeur.trim().slice(0, 100) || null };
  await db.update(users).set(set).where(eq(users.id, id));
  await logActivity(admin.id, "utilisateur_modifie", "user", String(id), { email: cible.email, ...set });
  revalidatePath("/utilisateurs");
}

export async function renvoyerInvitation(form: FormData) {
  const admin = await assertUser(["superadmin"]);
  const id = Number(form.get("id"));
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u || !u.actif) return;
  await inviter(u.email, u.role, admin.nom || admin.email);
  await db.update(users).set({ inviteLe: new Date() }).where(eq(users.id, id));
  await logActivity(admin.id, "invitation_envoyee", "user", String(id), { email: u.email });
  revalidatePath("/utilisateurs");
}

export async function reattribuerClients(_: unknown, form: FormData) {
  const admin = await assertUser(["superadmin"]);
  const de = Number(form.get("de"));
  const vers = form.get("vers") ? Number(form.get("vers")) : null;
  if (!de || de === vers) return { erreur: "Choisissez deux CSM différents." };
  const db = await getDb();
  const res = await db.update(clients).set({ csmId: vers }).where(eq(clients.csmId, de)).returning({ id: clients.id });
  await logActivity(admin.id, "clients_reattribues", "user", String(de), { vers, clients: res.map((r) => r.id) });
  revalidatePath("/utilisateurs");
  return { ok: true, message: `${res.length} client(s) réattribué(s).` };
}
