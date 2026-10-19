import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { activityLog, users } from "@/db/schema";
import { compteTestActif, connexionTest, consumeMagicLink, creerLienConnexion } from "@/lib/server/auth";

process.env.PGLITE_DIR = "memory";
const MDP = "un-mot-de-passe-de-test-long";

describe("Compte de test (email et mot de passe)", () => {
  let db: DB;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
  });
  afterAll(() => { delete process.env.TEST_LOGIN_EMAIL; delete process.env.TEST_LOGIN_PASSWORD; delete process.env.TEST_LOGIN_ROLE; });

  it("inactif sans variables ou avec un mot de passe trop court", async () => {
    expect(compteTestActif()).toBe(false);
    process.env.TEST_LOGIN_EMAIL = "test@speedmedia.test";
    process.env.TEST_LOGIN_PASSWORD = "court";
    expect(compteTestActif()).toBe(false);
    expect(await connexionTest("test@speedmedia.test", "court")).toBeNull();
  });

  it("connecte avec le bon couple, crée le compte au premier usage (super admin par défaut)", async () => {
    process.env.TEST_LOGIN_PASSWORD = MDP;
    expect(compteTestActif()).toBe(true);
    const u = await connexionTest(" Test@Speedmedia.test ", MDP);
    expect(u).toMatchObject({ email: "test@speedmedia.test", role: "superadmin", actif: true });
    expect(await connexionTest("autre@speedmedia.test", MDP)).toBeNull();
  });

  it("un compte désactivé reste désactivé", async () => {
    await db.update(users).set({ actif: false }).where(eq(users.email, "test@speedmedia.test"));
    expect(await connexionTest("test@speedmedia.test", MDP)).toBeNull();
    await db.update(users).set({ actif: true }).where(eq(users.email, "test@speedmedia.test"));
  });

  it("bloque après 5 échecs en 15 minutes, même avec le bon mot de passe", async () => {
    await db.delete(activityLog).where(eq(activityLog.action, "connexion_test_echec"));
    for (let i = 0; i < 5; i++) expect(await connexionTest("test@speedmedia.test", `mauvais-${i}`)).toBeNull();
    expect(await connexionTest("test@speedmedia.test", MDP)).toBeNull();
    await db.delete(activityLog).where(eq(activityLog.action, "connexion_test_echec"));
    expect(await connexionTest("test@speedmedia.test", MDP)).not.toBeNull();
  });

  it("lien de première connexion : usage unique, refusé aux comptes inconnus ou inactifs", async () => {
    await db.insert(users).values({ email: "collegue@speedmedia.test", role: "csm" });
    expect(await creerLienConnexion("inconnu@speedmedia.test")).toBeNull();
    const url = await creerLienConnexion("Collegue@speedmedia.test");
    expect(url).toMatch(/\/connexion\/verifier\?token=/);
    const token = new URL(url!).searchParams.get("token")!;
    expect(await consumeMagicLink(token)).toMatchObject({ email: "collegue@speedmedia.test", role: "csm" });
    expect(await consumeMagicLink(token)).toBeNull(); // déjà utilisé
    await db.update(users).set({ actif: false }).where(eq(users.email, "collegue@speedmedia.test"));
    expect(await creerLienConnexion("collegue@speedmedia.test")).toBeNull();
  });
});
