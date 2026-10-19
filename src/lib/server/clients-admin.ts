import { asc, count, eq, like } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { agenceAliases, clients, clientUrls, dossiers, groupes, users } from "@/db/schema";
import { AuditError } from "./audits";
import { recomputeAll } from "./recompute";
import { logActivity } from "./activity";

/**
 * Référentiel clients : création manuelle (nouveau client, compte sans dossiers), groupe et modèle.
 * Un client créé avant ses premiers dossiers est marqué « hors export » : il n'est pas noté (ni alerte
 * « aucun dossier ») tant qu'il n'a pas de dossiers. S'il est créé avec un identifiant provisoire (NC01…),
 * on rattache son vrai IDagence lors de l'import du lundi (« Rattacher à… » dans l'aperçu).
 */
export const FORMAT_ID = /^[A-Z]{1,3}\d{1,4}$/;

export async function groupeParNom(db: DB, nom: string | null | undefined): Promise<number | null> {
  const n = nom?.trim();
  if (!n) return null;
  const [g] = await db.select().from(groupes).where(eq(groupes.nom, n));
  if (g) return g.id;
  const [cree] = await db.insert(groupes).values({ nom: n }).returning();
  return cree.id;
}

export async function prochainIdProvisoire(db: DB) {
  const ids = (await db.select({ id: clients.id }).from(clients).where(like(clients.id, "NC%"))).map((c) => Number(c.id.slice(2))).filter(Number.isFinite);
  return `NC${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(2, "0")}`;
}

export const NouveauClient = z.object({
  id: z.string().trim().toUpperCase().refine((x) => x === "" || FORMAT_ID.test(x), "IDagence au format SpeedResa (ex. A05, HE01)"),
  nom: z.string().trim().min(2).max(120),
  groupe: z.string().trim().max(120).optional(),
  modele: z.string().trim().max(120).optional(),
  url: z.string().trim().max(300).optional(),
  csmId: z.string().optional(),
  emailContact: z.union([z.literal(""), z.email()]).optional(),
  vaGlobalEstime: z.string().optional(),
  vaCompteeDansTotaux: z.boolean().default(true),
});

export async function creerClient(db: DB, x: z.infer<typeof NouveauClient>, userId: number) {
  const id = x.id || (await prochainIdProvisoire(db));
  const [existe] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id));
  if (existe) throw new AuditError(`L'identifiant ${id} existe déjà.`, 409);
  const [alias] = await db.select().from(agenceAliases).where(eq(agenceAliases.idAgence, id));
  if (alias) throw new AuditError(`L'agence ${id} est déjà rattachée au client ${alias.clientId}.`, 409);
  let url: string | null = null;
  if (x.url) {
    url = /^https?:\/\//i.test(x.url) ? x.url : `https://${x.url}`;
    // Format seulement : le contrôle de sécurité (adresse publique) est fait au lancement de chaque scan
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error(); url = u.toString(); } catch { throw new AuditError("Adresse du site invalide.", 400); }
  }
  const va = x.vaGlobalEstime?.trim() ? Number(x.vaGlobalEstime.replace(/[\s €]/g, "").replace(",", ".")) : null;
  if (va !== null && !Number.isFinite(va)) throw new AuditError("Volume d'affaires estimé invalide.", 400);
  const csmId = x.csmId ? Number(x.csmId) : null;
  if (csmId) { const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, csmId)); if (!u) throw new AuditError("CSM inconnu.", 400); }
  // A-t-il déjà des dossiers dans les extracts importés ?
  const [{ n }] = await db.select({ n: count() }).from(dossiers).where(eq(dossiers.idAgence, id));
  await db.insert(clients).values({
    id, nom: x.nom, modele: x.modele || null, groupeId: await groupeParNom(db, x.groupe), csmId, emailContact: x.emailContact || null,
    vaGlobalEstime: va, vaCompteeDansTotaux: x.vaCompteeDansTotaux, horsExport: n === 0,
  });
  if (url) await db.insert(clientUrls).values({ clientId: id, url, principale: true }).onConflictDoNothing();
  await logActivity(userId, "client_cree", "client", id, { nom: x.nom, provisoire: !x.id, dossiers: n });
  if (n > 0) await recomputeAll(db);
  return { id, dossiers: n };
}

/** Liste du référentiel (actifs et désactivés) pour l'administration. */
export async function referentielClients(db: DB) {
  const [cl, gs, us, nb] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.nom)),
    db.select().from(groupes),
    db.select({ id: users.id, nom: users.nom, email: users.email }).from(users),
    db.select({ id: dossiers.idAgence, n: count() }).from(dossiers).groupBy(dossiers.idAgence),
  ]);
  const al = await db.select().from(agenceAliases);
  return cl.map((c) => ({
    ...c,
    groupe: gs.find((g) => g.id === c.groupeId)?.nom ?? null,
    csm: (() => { const u = us.find((x) => x.id === c.csmId); return u ? u.nom || u.email : null; })(),
    dossiers: nb.filter((x) => x.id === c.id || al.some((a) => a.idAgence === x.id && a.clientId === c.id)).reduce((s, x) => s + x.n, 0),
  }));
}

export async function activerClient(db: DB, id: string, actif: boolean, userId: number) {
  await db.update(clients).set({ actif }).where(eq(clients.id, id));
  await logActivity(userId, actif ? "client_reactive" : "client_desactive", "client", id, {});
  await recomputeAll(db);
}
