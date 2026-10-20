import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { activityLog, sessions, users } from "@/db/schema";
import { genererMotDePasse, hacherMotDePasse, problemeMotDePasse, verifierMotDePasse } from "@/lib/server/mots-de-passe";

process.env.PGLITE_DIR = "memory";
// Cookie de session simulé (changerMotDePasse lit la session courante)
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));
const { changerMotDePasse, connexionMotDePasse, definirMotDePasseProvisoire } = await import("@/lib/server/auth");

describe("Hachage des mots de passe", () => {
  it("scrypt salé : vérifie le bon, refuse le mauvais, deux hachages différents", async () => {
    const h1 = await hacherMotDePasse("une phrase de passe solide");
    const h2 = await hacherMotDePasse("une phrase de passe solide");
    expect(h1).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(h1).not.toBe(h2);
    expect(await verifierMotDePasse("une phrase de passe solide", h1)).toBe(true);
    expect(await verifierMotDePasse("une phrase de passe solidE", h1)).toBe(false);
    expect(await verifierMotDePasse("x", null)).toBe(false);
  });
  it("mot de passe généré lisible et règles du mot de passe choisi", () => {
    expect(genererMotDePasse()).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(problemeMotDePasse("court", "a@b.fr")).toMatch(/12/);
    expect(problemeMotDePasse("m.barain-2026-secret", "m.barain@speedmedia.fr")).toMatch(/identifiant/);
    expect(problemeMotDePasse("aaaaaaaaaaaaaa", "a@b.fr")).toMatch(/facile/);
    expect(problemeMotDePasse("girafe bleue sur la lune", "m.barain@speedmedia.fr")).toBeNull();
  });
});

describe("Identifiant et mot de passe provisoire (base)", () => {
  let db: DB, admin: number, csm: number;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    [{ id: admin }] = await db.insert(users).values({ email: "admin@speedmedia.test", role: "superadmin" }).returning();
    [{ id: csm }] = await db.insert(users).values({ email: "csm@speedmedia.test", role: "csm" }).returning();
  });

  it("sans mot de passe, la connexion est refusée", async () => {
    expect(await connexionMotDePasse("csm@speedmedia.test", "nimporte quoi")).toBeNull();
  });

  it("le super admin crée un mot de passe provisoire (généré ou choisi) ; les sessions sont fermées", async () => {
    await db.insert(sessions).values({ id: "s1", userId: csm, expiresAt: new Date(Date.now() + 3600_000) });
    const r = await definirMotDePasseProvisoire(csm, admin);
    expect("motDePasse" in r && r.motDePasse).toMatch(/^[A-Za-z2-9]{4}-/);
    expect(await db.select().from(sessions).where(eq(sessions.userId, csm))).toHaveLength(0);
    expect(await definirMotDePasseProvisoire(csm, admin, "court")).toEqual({ erreur: expect.stringMatching(/12/) });
    const choisi = await definirMotDePasseProvisoire(csm, admin, "Bienvenue chez Speedmedia 2026");
    expect(choisi).toEqual({ motDePasse: "Bienvenue chez Speedmedia 2026" });
    const [u] = await db.select().from(users).where(eq(users.id, csm));
    expect(u).toMatchObject({ motDePasseTemporaire: true });
    expect(u.motDePasseHash).not.toContain("Bienvenue");
  });

  it("connexion avec le provisoire, puis changement obligatoire", async () => {
    const u = await connexionMotDePasse(" CSM@speedmedia.test ", "Bienvenue chez Speedmedia 2026");
    expect(u).toMatchObject({ email: "csm@speedmedia.test", motDePasseTemporaire: true });
    expect(await changerMotDePasse(u!, "mauvais", "girafe bleue sur la lune")).toEqual({ erreur: expect.stringMatching(/actuel/) });
    expect(await changerMotDePasse(u!, "Bienvenue chez Speedmedia 2026", "Bienvenue chez Speedmedia 2026")).toEqual({ erreur: expect.stringMatching(/différent/) });
    expect(await changerMotDePasse(u!, "Bienvenue chez Speedmedia 2026", "girafe bleue sur la lune")).toEqual({ ok: true });
    expect(await connexionMotDePasse("csm@speedmedia.test", "Bienvenue chez Speedmedia 2026")).toBeNull();
    expect(await connexionMotDePasse("csm@speedmedia.test", "girafe bleue sur la lune")).toMatchObject({ motDePasseTemporaire: false });
  });

  it("compte désactivé refusé ; 5 échecs bloquent 15 minutes", async () => {
    await db.delete(activityLog).where(eq(activityLog.action, "connexion_mdp_echec"));
    for (let i = 0; i < 5; i++) expect(await connexionMotDePasse("csm@speedmedia.test", `faux-${i}`)).toBeNull();
    expect(await connexionMotDePasse("csm@speedmedia.test", "girafe bleue sur la lune")).toBeNull();
    await db.delete(activityLog).where(eq(activityLog.action, "connexion_mdp_echec"));
    await db.update(users).set({ actif: false }).where(eq(users.id, csm));
    expect(await connexionMotDePasse("csm@speedmedia.test", "girafe bleue sur la lune")).toBeNull();
    expect(await definirMotDePasseProvisoire(csm, admin)).toEqual({ erreur: expect.stringMatching(/inactif/) });
  });
});
