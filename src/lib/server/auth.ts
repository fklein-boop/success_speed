import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, count } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLog, loginTokens, sessions, users } from "@/db/schema";
import { ensureSuperadmin } from "@/lib/seed";
import { emailLayout, sendEmail } from "./email";
import { logActivity } from "./activity";
import { genererMotDePasse, hacherMotDePasse, problemeMotDePasse, verifierMotDePasse } from "./mots-de-passe";

export type Role = "superadmin" | "csm" | "lecture";
export type User = typeof users.$inferSelect;

const COOKIE = "csm_session";
/** Déconnexion après 8 h d'inactivité ; durée maximale d'une session : 14 jours. */
const IDLE_MS = 8 * 3600_000;
const MAX_MS = 14 * 24 * 3600_000;
const LINK_MS = 15 * 60_000;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const appUrl = () => (process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, "");

export const isSuperadminEmail = (email: string) =>
  !!process.env.SUPERADMIN_EMAIL && normalizeEmail(process.env.SUPERADMIN_EMAIL) === normalizeEmail(email);

/** Utilisateur connecté, ou null. Prolonge la session si elle est active. */
export async function getCurrentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const db = await getDb();
  const id = hashToken(raw);
  const [row] = await db.select().from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, id));
  if (!row) return null;
  const now = Date.now();
  const { sessions: s, users: u } = row;
  if (!u.actif || s.expiresAt.getTime() < now || s.lastSeenAt.getTime() + IDLE_MS < now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (now - s.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
  return u;
}

/** Pour les pages : redirige vers /connexion si besoin. */
export async function requireUser(roles?: Role[]): Promise<User> {
  const u = await getCurrentUser();
  if (!u) redirect("/connexion");
  // Mot de passe provisoire fixé par le super admin : à remplacer avant tout
  if (u.motDePasseTemporaire) redirect("/mot-de-passe");
  if (roles && !roles.includes(u.role as Role)) redirect("/?refus=1");
  return u;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Pour les routes API et actions serveur : lève une erreur 401/403. */
export async function assertUser(roles?: Role[]): Promise<User> {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "Session expirée, reconnectez-vous.");
  if (u.motDePasseTemporaire) throw new HttpError(403, "Choisissez d'abord votre mot de passe.");
  if (roles && !roles.includes(u.role as Role)) throw new HttpError(403, "Action non autorisée pour votre rôle.");
  return u;
}

export const canImport = (u: User) => u.role === "superadmin" || (u.role === "csm" && u.peutImporter);
export const canEdit = (u: User) => u.role === "superadmin" || u.role === "csm";

export async function createSession(user: User, methode: "lien" | "google" | "test" | "mot_de_passe") {
  const db = await getDb();
  const token = randomToken();
  await db.insert(sessions).values({ id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + MAX_MS) });
  await db.update(users).set({ derniereConnexion: new Date() }).where(eq(users.id, user.id));
  await logActivity(user.id, "connexion", "user", String(user.id), { methode });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_MS / 1000,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, hashToken(raw)));
  }
  jar.delete(COOKIE);
}

/** Utilisateur actif de la liste blanche pour cet email (le super admin d'environnement est créé à la volée). */
export async function findAllowedUser(email: string): Promise<User | null> {
  const db = await getDb();
  const e = normalizeEmail(email);
  if (isSuperadminEmail(e)) await ensureSuperadmin(db);
  const [u] = await db.select().from(users).where(eq(users.email, e));
  return u && u.actif ? u : null;
}

/**
 * Envoie un lien de connexion si l'adresse est sur la liste blanche.
 * La réponse est identique dans tous les cas, pour ne pas révéler si l'adresse existe.
 */
export async function requestMagicLink(email: string): Promise<string | undefined> {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
  const user = await findAllowedUser(e);
  if (!user) return;
  const db = await getDb();
  // Limitation : 5 liens par adresse et par quart d'heure
  const [{ n }] = await db.select({ n: count() }).from(loginTokens)
    .where(and(eq(loginTokens.email, e), gt(loginTokens.createdAt, new Date(Date.now() - LINK_MS))));
  if (n >= 5) return;
  const token = randomToken();
  await db.insert(loginTokens).values({ tokenHash: hashToken(token), email: e, expiresAt: new Date(Date.now() + LINK_MS) });
  const url = `${appUrl()}/connexion/verifier?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: e,
    subject: "Votre lien de connexion — Audit CSM SpeedResa",
    text: `Bonjour,\n\nPour vous connecter à la plateforme d'audit CSM, ouvrez ce lien (valable 15 minutes, utilisable une seule fois) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
    html: emailLayout({
      titre: "Connexion à la plateforme d'audit CSM",
      paragraphes: ["Bonjour,", "Cliquez sur le bouton ci-dessous pour vous connecter. Le lien est valable 15 minutes et ne fonctionne qu'une fois."],
      bouton: { label: "Me connecter", url },
      pied: "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.",
    }),
  });
  // En local sans service d'email, le lien est renvoyé pour être affiché à l'écran (jamais en production)
  if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) return url;
}

/** Validité d'un lien de première connexion remis par le super admin (copié dans Teams, Slack…) */
export const LIEN_INVITATION_MS = 7 * 24 * 3600_000;

/**
 * Lien de connexion à usage unique, généré par le super admin pour un utilisateur actif de la liste blanche,
 * à transmettre sans passer par l'email (quand Resend n'est pas configuré). Le jeton n'est stocké que haché.
 */
export async function creerLienConnexion(email: string, dureeMs = LIEN_INVITATION_MS): Promise<string | null> {
  const user = await findAllowedUser(email);
  if (!user) return null;
  const db = await getDb();
  const token = randomToken();
  await db.insert(loginTokens).values({ tokenHash: hashToken(token), email: user.email, expiresAt: new Date(Date.now() + dureeMs) });
  return `${appUrl()}/connexion/verifier?token=${encodeURIComponent(token)}`;
}

/** Consomme un lien magique. Renvoie l'utilisateur si le lien est valide. */
export async function consumeMagicLink(token: string): Promise<User | null> {
  const db = await getDb();
  const [t] = await db.update(loginTokens).set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, hashToken(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .returning();
  if (!t) return null;
  return findAllowedUser(t.email);
}

/**
 * Compte de test : connexion par email et mot de passe, sans lien magique.
 * Actif seulement si TEST_LOGIN_EMAIL et TEST_LOGIN_PASSWORD (16 caractères au moins) sont définis ;
 * rôle TEST_LOGIN_ROLE (superadmin par défaut). Pour le désactiver, supprimez ces variables.
 * 5 échecs en 15 minutes bloquent la connexion de test pendant 15 minutes.
 */
const ROLES_TEST: Role[] = ["superadmin", "csm", "lecture"];
export const MDP_TEST_MIN = 16;

export function compteTestActif(): boolean {
  const e = process.env.TEST_LOGIN_EMAIL?.trim(), p = process.env.TEST_LOGIN_PASSWORD ?? "";
  return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && p.length >= MDP_TEST_MIN;
}

const empreinte = (s: string) => createHash("sha256").update(s).digest();

export async function connexionTest(email: string, motDePasse: string): Promise<User | null> {
  if (!compteTestActif()) return null;
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(activityLog)
    .where(and(eq(activityLog.action, "connexion_test_echec"), gt(activityLog.createdAt, new Date(Date.now() - LINK_MS))));
  if (n >= 5) return null;
  const e = normalizeEmail(email);
  const ok = e === normalizeEmail(process.env.TEST_LOGIN_EMAIL!) && timingSafeEqual(empreinte(motDePasse), empreinte(process.env.TEST_LOGIN_PASSWORD!));
  if (!ok) {
    await logActivity(null, "connexion_test_echec", "user", "", {});
    return null;
  }
  const role = ROLES_TEST.find((r) => r === process.env.TEST_LOGIN_ROLE?.trim()) ?? "superadmin";
  // Créé au premier usage ; s'il a été désactivé dans « Utilisateurs », il reste désactivé
  await db.insert(users).values({ email: e, nom: "Compte de test", role, actif: true, peutImporter: role !== "lecture" }).onConflictDoNothing({ target: users.email });
  const [u] = await db.select().from(users).where(eq(users.email, e));
  return u?.actif ? u : null;
}

// ───────── Identifiant (email) et mot de passe ─────────

const ECHECS_MAX_COMPTE = 5;
const ECHECS_MAX_GLOBAL = 100;

/**
 * Connexion par email et mot de passe. Message identique quel que soit le motif d'échec.
 * 5 échecs en 15 minutes sur une adresse (ou 100 tous comptes confondus) bloquent les essais pendant 15 minutes.
 */
export async function connexionMotDePasse(email: string, motDePasse: string): Promise<User | null> {
  const e = normalizeEmail(email);
  const db = await getDb();
  const depuis = new Date(Date.now() - LINK_MS);
  const echecs = await db.select({ entiteId: activityLog.entiteId }).from(activityLog)
    .where(and(eq(activityLog.action, "connexion_mdp_echec"), gt(activityLog.createdAt, depuis)));
  if (echecs.length >= ECHECS_MAX_GLOBAL || echecs.filter((x) => x.entiteId === e).length >= ECHECS_MAX_COMPTE) return null;
  const user = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? await findAllowedUser(e) : null;
  const ok = await verifierMotDePasse(motDePasse, user?.motDePasseHash ?? null);
  if (!user || !ok) {
    await logActivity(null, "connexion_mdp_echec", "user", e, {});
    return null;
  }
  return user;
}

/**
 * Le super admin fixe un mot de passe (choisi, ou généré si vide), provisoire : l'utilisateur devra le changer
 * à sa première connexion. Ses sessions ouvertes sont fermées. Renvoie le mot de passe en clair, à transmettre une fois.
 */
export async function definirMotDePasseProvisoire(userId: number, adminId: number, choisi?: string | null): Promise<{ motDePasse: string } | { erreur: string }> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !u.actif) return { erreur: "Compte inactif ou introuvable." };
  const motDePasse = choisi?.trim() || genererMotDePasse();
  const pb = choisi?.trim() ? problemeMotDePasse(motDePasse, u.email) : null;
  if (pb) return { erreur: pb };
  await db.update(users).set({ motDePasseHash: await hacherMotDePasse(motDePasse), motDePasseTemporaire: true, motDePasseModifieLe: new Date(), inviteLe: u.inviteLe ?? new Date() }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await logActivity(adminId, "mot_de_passe_provisoire", "user", String(userId), { email: u.email });
  return { motDePasse };
}

/** L'utilisateur choisit son mot de passe (obligatoire après un mot de passe provisoire). */
export async function changerMotDePasse(user: User, actuel: string, nouveau: string): Promise<{ ok: true } | { erreur: string }> {
  if (user.motDePasseHash && !(await verifierMotDePasse(actuel, user.motDePasseHash))) return { erreur: "Mot de passe actuel incorrect." };
  const pb = problemeMotDePasse(nouveau, user.email);
  if (pb) return { erreur: pb };
  if (actuel && nouveau === actuel) return { erreur: "Choisissez un mot de passe différent de l'actuel." };
  const db = await getDb();
  await db.update(users).set({ motDePasseHash: await hacherMotDePasse(nouveau), motDePasseTemporaire: false, motDePasseModifieLe: new Date() }).where(eq(users.id, user.id));
  // Les autres sessions de l'utilisateur sont fermées
  const raw = (await cookies()).get(COOKIE)?.value;
  const courante = raw ? hashToken(raw) : "";
  const autres = (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id))).filter((x) => x.id !== courante);
  for (const x of autres) await db.delete(sessions).where(eq(sessions.id, x.id));
  await logActivity(user.id, "mot_de_passe_change", "user", String(user.id), {});
  return { ok: true };
}
