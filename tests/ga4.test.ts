import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { clientSnapshots, imports, metriquesClientMensuelles, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { definirFetch, dimensions, ga4Configure, proprietes, rapport } from "@/lib/ga4/client";
import { apercuGa4, configGa4, enregistrerConfigGa4, etatGa4, periode, synchroniserGa4, trouverDimensionClient } from "@/lib/server/ga4";
import { appliquerTrafic } from "@/lib/server/trafic";
import { manqueAGagner, traficClient, TRAFIC_VIDE, type MoisWeb } from "@/lib/metrics/trafic";
import { DEFAULT_METRICS_PARAMS } from "@/lib/metrics/params";
import { leviersEnRetard } from "@/lib/restitution/leviers";
import type { ClientMetrics, Dossier } from "@/lib/metrics/compute";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const EMAIL = "audit-csm@audit-speedresa.iam.gserviceaccount.com";

/** Propriété consolidée simulée : valeur de « Nom du client » → mois AAAA MM → [sessions, CA, débuts, achats] */
const GA4: Record<string, Record<string, [number, number, number, number]>> = {
  "Perier Voyages": { "202606": [9000, 12000, 300, 12], "202607": [9500, 15000, 320, 15], "202608": [11000, 18000, 400, 18], "202609": [10000, 14000, 350, 14] },
  "perier voyages ": { "202609": [50, 0, 2, 0] }, // variante d'écriture, additionnée
  "A05": { "202608": [500, 900, 40, 3] }, // identifiant client exact
  "Voyages Inconnus SARL": { "202608": [120, 0, 3, 0] },
  "(not set)": { "202608": [777, 0, 0, 0] },
};

const appels: { url: string; body?: { dimensions?: { name: string }[]; dimensionFilter?: unknown } }[] = [];
const fauxGoogle: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  appels.push({ url, body });
  const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
    const [h, p, s] = assertion.split(".");
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, s, "base64url");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    if (!ok || claims.iss !== EMAIL || !claims.scope.includes("analytics.readonly")) return json({ error: "invalid_grant" }, 400);
    return json({ access_token: "jeton-test", expires_in: 3600 });
  }
  if ((init?.headers as Record<string, string>)?.authorization !== "Bearer jeton-test") return json({ error: { message: "unauthenticated" } }, 401);
  if (url.includes("accountSummaries")) return json({ accountSummaries: [{ displayName: "Speedmedia", propertySummaries: [{ property: "properties/312345678", displayName: "Tous les sites clients" }] }] });
  if (url.endsWith("/metadata")) return json({ dimensions: [
    { apiName: "yearMonth", uiName: "Year month" }, { apiName: "hostName", uiName: "Hostname" },
    { apiName: "customEvent:page_type", uiName: "Type de page", customDefinition: true },
    { apiName: "customEvent:nom_client", uiName: "Nom du client", customDefinition: true },
  ] });
  if (url.endsWith(":runReport")) {
    const dims = body.dimensions.map((d: { name: string }) => d.name);
    const rows = Object.entries(GA4).flatMap(([nom, mois]) => Object.entries(mois).flatMap(([ym, [s, ca, deb, ach]]) =>
      dims.length === 2
        ? [{ dimensionValues: [{ value: ym }, { value: nom }], metricValues: [{ value: String(s) }, { value: String(ca) }] }]
        : [["begin_checkout", deb], ["purchase", ach]].filter(([, n]) => Number(n) > 0).map(([ev, n]) => ({ dimensionValues: [{ value: ym }, { value: nom }, { value: ev }], metricValues: [{ value: String(n) }] }))));
    return json({ rows, rowCount: rows.length });
  }
  return json({ error: { message: "inconnu" } }, 404);
};

beforeAll(() => {
  process.env.GA4_CREDENTIALS = Buffer.from(JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: privateKey.export({ type: "pkcs8", format: "pem" }) })).toString("base64");
  definirFetch(fauxGoogle);
});
afterAll(() => { delete process.env.GA4_CREDENTIALS; definirFetch(null); });

describe("Connexion Google Analytics (compte de service)", () => {
  it("lit la clé (JSON en base64), signe le jeton et liste propriétés et dimensions", async () => {
    expect(ga4Configure()).toBe(true);
    expect(await proprietes()).toEqual([{ id: "312345678", nom: "Tous les sites clients", compte: "Speedmedia" }]);
    const dims = await dimensions("312345678");
    expect(trouverDimensionClient(dims)?.apiName).toBe("customEvent:nom_client");
    expect(appels.filter((a) => a.url.includes("oauth2")).length).toBe(1); // jeton mis en cache
  });
  it("reconnaît la dimension par son nom technique si le libellé diffère", () => {
    expect(trouverDimensionClient([{ apiName: "customEvent:nom_du_client", nom: "client", personnalisee: true }])?.apiName).toBe("customEvent:nom_du_client");
    expect(trouverDimensionClient([{ apiName: "hostName", nom: "Nom du client", personnalisee: false }])).toBeNull();
  });
  it("période : 13 derniers mois complets", () => {
    expect(periode(13, new Date("2026-10-15T10:00:00Z"))).toEqual({ startDate: "2025-09-01", endDate: "2026-09-30" });
  });
  it("rapport : demande les événements de réservation filtrés", async () => {
    const r = await rapport("312345678", { dateRanges: [periode()], dimensions: ["yearMonth", "customEvent:nom_client", "eventName"], metrics: ["eventCount"] });
    expect(r.length).toBeGreaterThan(0);
  });
  it("message clair si le compte de service n'a pas accès", async () => {
    definirFetch(async (u) => String(u).includes("oauth2") ? new Response(JSON.stringify({ access_token: "x", expires_in: 3600 })) : new Response(JSON.stringify({ error: { message: "User does not have sufficient permissions" } }), { status: 403 }));
    await expect(proprietes()).rejects.toThrow(/Lecteur/);
    definirFetch(fauxGoogle);
  });
});

describe("Conversion web et abandon panier", () => {
  const m = { confirmes_12m: 10, va_confirme_12m: 15000 } as ClientMetrics;
  const visites = new Map([["2026-07", 1000], ["2026-08", 1000]]);
  it("calcule conversion web, abandon et CA web sur les mois mesurés par GA4", () => {
    const web = new Map<string, MoisWeb>([["2026-07", { debuts: 40, achats: 4, ca: 6000 }], ["2026-08", { debuts: 60, achats: 6, ca: 9000 }]]);
    const t = traficClient(m, [] as Dossier[], visites, "2026-10-12", DEFAULT_METRICS_PARAMS, web);
    expect(t).toMatchObject({ source_trafic: "GA4", conversion_web: 10 / 2000, abandon_panier: 0.9, debuts_reservation_mensuels: 50, ca_web_mensuel: 7500 });
  });
  it("pas de taux d'abandon avec trop peu de débuts ; source « fichier » sans GA4", () => {
    const peu = traficClient(m, [], visites, "2026-10-12", DEFAULT_METRICS_PARAMS, new Map([["2026-08", { debuts: 5, achats: 1, ca: 0 }]]));
    expect(peu).toMatchObject({ source_trafic: "mixte", abandon_panier: null });
    expect(traficClient(m, [], visites, "2026-10-12", DEFAULT_METRICS_PARAMS).source_trafic).toBe("fichier");
  });
  it("médiane du portefeuille et levier « abandon panier »", () => {
    const lignes = [0.7, 0.72, 0.75, 0.8, 0.95].map((a) => ({ segment: "Stable", trafic: { ...TRAFIC_VIDE, abandon_panier: a } }));
    manqueAGagner(lignes);
    expect(lignes[0].trafic.abandon_reference).toBe(0.75);
    const base = { alertes: [], evol_90j: null, jours_sans_dossier: null, dossiers_12m: 0, resalive_12m: 0, confirmes_12m: 0, annules_12m: 0 } as unknown as ClientMetrics;
    const l = leviersEnRetard({ ...base, abandon_panier: 0.95, abandon_reference: 0.75 });
    expect(l.find((x) => x.code === "panier_abandon")).toMatchObject({ poids: 3 });
    expect(l[0].constat).toMatch(/95 %.*médiane du portefeuille : 75 %/);
    expect(leviersEnRetard({ ...base, abandon_panier: 0.8, abandon_reference: 0.75 }).some((x) => x.code === "panier_abandon")).toBe(false);
  });
});

describe("Synchronisation GA4 (base)", () => {
  let db: DB, admin: number;
  const quand = new Date("2026-10-15T10:00:00Z");
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    [{ id: admin }] = await db.insert(users).values({ email: "admin-ga4@test", role: "superadmin" }).returning();
  });

  it("refuse une configuration invalide", async () => {
    await expect(enregistrerConfigGa4(db, admin, { propertyId: "abc", dimension: null, dimensionNom: null, evenementDebut: "begin_checkout", evenementAchat: "purchase" })).rejects.toThrow(/propriété/);
    await expect(enregistrerConfigGa4(db, admin, { propertyId: "312345678", dimension: "eventName; drop", dimensionNom: null, evenementDebut: "begin_checkout", evenementAchat: "purchase" })).rejects.toThrow(/Dimension/);
  });

  it("aperçu : valeurs de « Nom du client » rattachées, « (not set) » mis à part", async () => {
    await enregistrerConfigGa4(db, admin, { propertyId: "312345678", dimension: "customEvent:nom_client", dimensionNom: "Nom du client", evenementDebut: "begin_checkout", evenementAchat: "purchase" });
    expect((await configGa4(db)).dimension).toBe("customEvent:nom_client");
    const a = await apercuGa4(db);
    expect(a.valeurs.find((v) => v.valeur === "Perier Voyages")).toMatchObject({ clientId: "P17", sur: true });
    expect(a.valeurs.find((v) => v.valeur === "A05")).toMatchObject({ clientId: "A05", sur: true });
    expect(a.valeurs.find((v) => v.valeur === "Voyages Inconnus SARL")?.sur).toBe(false);
    expect(a.valeurs.some((v) => v.valeur === "(not set)")).toBe(false);
    expect(a.nonRenseigne).toBe(777);
  });

  it("relevé automatique : valeurs sûres écrites, valeur incertaine en attente ; conversion web au client", async () => {
    const etat = await synchroniserGa4(db, null, undefined, quand);
    expect(etat.clients).toBe(2);
    expect(etat.mois).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(etat.enAttente.map((e) => e.valeur)).toEqual(["Voyages Inconnus SARL"]);
    const [sep] = await db.select().from(metriquesClientMensuelles).where(and(eq(metriquesClientMensuelles.clientId, "P17"), eq(metriquesClientMensuelles.mois, "2026-09")));
    expect(sep).toMatchObject({ visites: 10050, debutsReservation: 352, achatsWeb: 14, caWeb: 14000, sourceTrafic: "ga4" });
    expect(sep.volume).toBeGreaterThanOrEqual(0);
    const m = (await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, "P17")))[0].data as ClientMetrics;
    expect(m.source_trafic).toBe("GA4");
    expect(m.conversion_web).toBeCloseTo((12 + 15 + 18 + 14) / (9000 + 9500 + 11000 + 10050), 6);
    expect(m.abandon_panier).toBeCloseTo(1 - 59 / (300 + 320 + 400 + 352), 6);
    expect((await db.select().from(imports).where(eq(imports.type, "ga4"))).length).toBe(1);
  });

  it("le fichier GTM n'écrase pas un mois mesuré par GA4", async () => {
    await appliquerTrafic(db, admin, { fichier: "gtm.xlsx", lignes: [{ nom: "Perier Voyages", valeurs: { "2026-05": 3366, "2026-08": 1 } }], correspondances: { "Perier Voyages": "P17" } });
    const rows = await db.select().from(metriquesClientMensuelles).where(eq(metriquesClientMensuelles.clientId, "P17"));
    expect(rows.find((r) => r.mois === "2026-08")).toMatchObject({ visites: 11000, sourceTrafic: "ga4" });
    expect(rows.find((r) => r.mois === "2026-05")).toMatchObject({ visites: 3366, sourceTrafic: "fichier" });
    const m = (await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, "P17")))[0].data as ClientMetrics;
    expect(m.source_trafic).toBe("mixte");
  });

  it("validation par l'administrateur : correspondance mémorisée, plus rien en attente", async () => {
    const etat = await synchroniserGa4(db, admin, { "Voyages Inconnus SARL": null }, quand);
    expect(etat.enAttente).toEqual([]);
    expect((await etatGa4(db)).derniereSync).not.toBeNull();
    // Un client inconnu est refusé et l'erreur est conservée dans l'état
    await expect(synchroniserGa4(db, admin, { "Voyages Inconnus SARL": "ZZ99" }, quand)).rejects.toThrow(/inconnu/);
    expect((await etatGa4(db)).erreur).toMatch(/inconnu/);
  });
});
