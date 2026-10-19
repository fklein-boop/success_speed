import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { clients, clientSnapshots, clientUrls, groupes, metriquesClientMensuelles, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { anneeParDefaut, lireTableauTrafic, moisDeEntete, rapprocher, type ClientRef } from "@/lib/import/trafic";
import { manqueAGagner, traficClient, TRAFIC_VIDE } from "@/lib/metrics/trafic";
import { DEFAULT_METRICS_PARAMS } from "@/lib/metrics/params";
import { leviersEnRetard } from "@/lib/restitution/leviers";
import { apercuTrafic, appliquerTrafic } from "@/lib/server/trafic";
import { activerClient, creerClient, groupeParNom, NouveauClient } from "@/lib/server/clients-admin";
import { loadPortfolio } from "@/lib/server/portfolio";
import type { ClientMetrics, Dossier } from "@/lib/metrics/compute";
import { loadFixture, reference as ref04 } from "./helpers";

process.env.PGLITE_DIR = "memory";
process.env.SCAN_AUTORISER_LOCAL = "1";

/** Onglet « 4. Métriques GTM » du fichier d'origine (CSM - Score de maturité numérique.xlsx), tel quel. */
const GTM: unknown[][] = [
  ["Nom du client", "May", "June", "July", "August", "September"],
  ["Perier Voyages", 3366, 9991, 9274, 11082], ["Top of Travel", 0, 2672, 6732, 6364], ["SejoursVoyages", 0, 665, 1934, 1909],
  ["Aéroport de Toulouse", 1787, 274, 525, 449], ["CAP 5 Voyages", 0, 489, 1267, 1087], ["Rhinos Evasion", 319, 865, 788, 431],
  ["Aéroport de Montpellier", 0, 1, 667, 746], ["Egyptours", 0, 37, 109, 112], ["Aéroport de Strasbourg", 0, 24, 73, 55],
  ["Aéroport de Saint-Etienne", 0, 10, 52, 14], ["D01 - RECETTE", 0, 11, 22, 22], ["Toulouse", 11, 0, 0, 0], ["sejours.toulouse.aeroport.frToulouse", 5, 0, 0, 0],
  [], [],
];

describe("Lecture du fichier de trafic", () => {
  it("reconnaît les en-têtes de mois (anglais, français, ISO, date Excel)", () => {
    expect(moisDeEntete("May", 2026)).toBe("2026-05");
    expect(moisDeEntete("septembre 2025", 2026)).toBe("2025-09");
    expect(moisDeEntete("Août", 2026)).toBe("2026-08");
    expect(moisDeEntete("2026-05", 2020)).toBe("2026-05");
    expect(moisDeEntete("05/2026", 2020)).toBe("2026-05");
    expect(moisDeEntete(46143, 2020)).toBe("2026-05"); // 01/05/2026 au format Excel
    expect(moisDeEntete("Nom du client", 2026)).toBeNull();
  });
  it("déduit l'année des colonnes sans année à partir de la date des données", () => {
    expect(anneeParDefaut(["May", "June", "July", "August", "September"], "2026-10-12")).toBe(2026);
    expect(anneeParDefaut(["May", "June", "July", "August", "September"], "2026-03-02")).toBe(2025);
  });
  it("lit l'onglet GTM : les 0 et cellules vides sont « non mesuré », les lignes vides ignorées", () => {
    const t = lireTableauTrafic(GTM, 2026);
    expect(t.mois).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(t.lignes).toHaveLength(13);
    expect(t.lignes.find((l) => l.nom === "Top of Travel")!.valeurs).toEqual({ "2026-06": 2672, "2026-07": 6732, "2026-08": 6364 });
    expect(t.lignes.find((l) => l.nom === "Perier Voyages")!.valeurs["2026-09"]).toBeUndefined();
  });
});

describe("Rapprochement des noms avec les clients", () => {
  const cl: ClientRef[] = [
    ...ref04.clients.map((c) => ({ id: c.id as string, nom: c.client as string, urls: (c.urls as string[]) ?? [] })),
    { id: "HE01", nom: "SRV - Aéroport de Saint-Étienne", urls: ["https://saint-etienne.aeroport.fr/"] },
  ];
  const r = (nom: string) => rapprocher(nom, cl, {});
  it("rapproche par nom, par mots et par domaine du site", () => {
    expect(r("Perier Voyages")).toMatchObject({ clientId: "P17", sur: true });
    expect(r("SejoursVoyages")).toMatchObject({ clientId: "S24", sur: true }); // site sejoursvoyages.com
    expect(r("CAP 5 Voyages")).toMatchObject({ clientId: "C12", sur: true });
    expect(r("Egyptours")).toMatchObject({ clientId: "E22", sur: true });
    expect(r("Aéroport de Toulouse").clientId).toBe("A34");
    expect(r("Aéroport de Strasbourg").clientId).toBe("A32");
    expect(r("Aéroport de Saint-Etienne").clientId).toBe("HE01");
    expect(r("Rhinos Evasion").clientId).toBe("R08");
  });
  it("signale les rapprochements incertains et respecte les choix mémorisés", () => {
    expect(r("sejours.toulouse.aeroport.frToulouse").sur).toBe(false);
    expect(r("Agence inconnue XYZ").clientId).toBeNull();
    expect(rapprocher("Toulouse", cl, { toulouse: "" })).toEqual({ clientId: null, score: 1, sur: true }); // « ignorer » mémorisé
  });
});

describe("Conversion et manque à gagner", () => {
  const m = (x: Partial<ClientMetrics>) => ({ confirmes_12m: 10, va_confirme_12m: 20000, segment: "Champion", ...x } as ClientMetrics);
  const d = (date: string, statut: string): Dossier => ({ idAgence: "X", idResa: date + statut + Math.random(), date, statut, origine: "", total: 1000, erreurResalive: false });
  it("conversion = confirmés ÷ visites sur les mois complets mesurés (12 mois au plus)", () => {
    const rows = [d("2026-08-03", "Validée"), d("2026-08-10", "Devis"), d("2026-07-01", "Validée"), d("2026-10-02", "Validée"), d("2026-08-11", "Annulée par le client")];
    const t = traficClient(m({}), rows, new Map([["2026-07", 500], ["2026-08", 1500], ["2026-10", 300], ["2024-01", 900]]), "2026-10-12", DEFAULT_METRICS_PARAMS);
    expect(t.mois_trafic).toBe(2); // octobre (incomplet) et janvier 2024 (hors 12 mois) exclus
    expect(t.visites_mensuelles).toBe(1000);
    expect(t.conversion).toBeCloseTo(2 / 2000);
    expect(t.conversion_demandes).toBeCloseTo(3 / 2000);
    expect(t.panier_moyen_confirme).toBe(2000);
    expect(traficClient(m({}), rows, new Map(), "2026-10-12", DEFAULT_METRICS_PARAMS)).toEqual(TRAFIC_VIDE);
  });
  it("référence = médiane des Champions (au moins 3), sinon du portefeuille (au moins 5)", () => {
    const t = (conversion: number) => ({ ...TRAFIC_VIDE, conversion, visites_mensuelles: 1000, panier_moyen_confirme: 2000 });
    const lignes = [{ segment: "Champion", trafic: t(0.01) }, { segment: "Champion", trafic: t(0.02) }, { segment: "Champion", trafic: t(0.03) }, { segment: "À risque", trafic: t(0.005) }];
    manqueAGagner(lignes);
    expect(lignes[3].trafic).toMatchObject({ conversion_reference: 0.02, conversion_reference_source: "Champions" });
    expect(lignes[3].trafic.manque_a_gagner_mensuel).toBeCloseTo((0.02 - 0.005) * 1000 * 2000); // 30 000 € par mois
    expect(lignes[2].trafic.manque_a_gagner_mensuel).toBe(0); // au-dessus de la référence
    const peu = [{ segment: "À risque", trafic: t(0.01) }];
    manqueAGagner(peu);
    expect(peu[0].trafic.conversion_reference).toBeNull();
  });
  it("levier « conversion faible » dans le diagnostic, avec le manque à gagner", () => {
    const base = { alertes: [], evol_90j: 0, jours_sans_dossier: 2, dossiers_12m: 0, transformation: 0.5, resalive_12m: 0, confirmes_12m: 0, annules_12m: 0 } as unknown as ClientMetrics;
    const l = leviersEnRetard({ ...base, conversion: 0.005, conversion_reference: 0.02, conversion_reference_source: "Champions", manque_a_gagner_mensuel: 30000 }, []);
    expect(l[0]).toMatchObject({ code: "conversion", poids: 3 });
    expect(l[0].constat).toContain("0,50 % contre 2,00 % (médiane des Champions)");
    expect(leviersEnRetard({ ...base, conversion: 0.018, conversion_reference: 0.02 }, [])).toEqual([]);
  });
});

describe("Import du trafic et nouveaux clients (base)", () => {
  let db: DB, admin: number;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    [{ id: admin }] = await db.insert(users).values({ email: "admin@test", role: "superadmin" }).returning();
  });

  it("aperçu puis import : visites enregistrées, conversion et manque à gagner calculés", async () => {
    const { lignes } = lireTableauTrafic(GTM, 2026);
    const a = await apercuTrafic(db, lignes);
    const perier = a.lignes.find((l) => l.nom === "Perier Voyages")!;
    expect(perier).toMatchObject({ clientId: "P17", sur: true });
    expect(a.lignes.find((l) => l.nom === "D01 - RECETTE")).toMatchObject({ demo: true, clientId: null });
    const correspondances = Object.fromEntries(a.lignes.map((l) => [l.nom, l.sur ? l.clientId : null]));
    const r = await appliquerTrafic(db, admin, { fichier: "gtm.xlsx", lignes, correspondances });
    expect(r.mois).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    const [v] = await db.select().from(metriquesClientMensuelles).where(eq(metriquesClientMensuelles.clientId, "P17")).then((x) => x.filter((y) => y.mois === "2026-08"));
    expect(v.visites).toBe(11082);
    expect(v.volume).toBeGreaterThan(0); // les volumes calculés sont conservés
    const [snap] = await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, "P17"));
    const m = snap.data as ClientMetrics;
    expect(m.mois_trafic).toBe(4);
    expect(m.visites_mensuelles).toBe(Math.round((3366 + 9991 + 9274 + 11082) / 4));
    expect(m.conversion).toBeGreaterThan(0);
    expect(["Champions", "portefeuille"]).toContain(m.conversion_reference_source);
    expect(m.conversion_reference).toBeGreaterThan(0);
    expect(m.manque_a_gagner_mensuel).toBeGreaterThanOrEqual(0);
    // Les choix sont mémorisés : « ignorer » reste ignoré au prochain import
    const b = await apercuTrafic(db, lignes);
    expect(b.lignes.find((l) => l.nom === "sejours.toulouse.aeroport.frToulouse")).toMatchObject({ clientId: null, sur: true });
  });

  it("nouveau client avec identifiant provisoire, groupe et site ; non noté tant qu'il n'a pas de dossiers", async () => {
    const p = NouveauClient.parse({ id: "", nom: "Évasion Test", groupe: "Groupe Test", modele: "B2C", url: "www.evasion-test.fr", emailContact: "", vaGlobalEstime: "1 200 000", vaCompteeDansTotaux: true });
    const r = await creerClient(db, p, admin);
    expect(r).toEqual({ id: "NC01", dossiers: 0 });
    const [c] = await db.select().from(clients).where(eq(clients.id, "NC01"));
    expect(c).toMatchObject({ nom: "Évasion Test", modele: "B2C", horsExport: true, vaGlobalEstime: 1200000 });
    expect((await db.select().from(groupes).where(eq(groupes.id, c.groupeId!)))[0].nom).toBe("Groupe Test");
    expect((await db.select().from(clientUrls).where(eq(clientUrls.clientId, "NC01")))[0]).toMatchObject({ url: "https://www.evasion-test.fr/", principale: true });
    expect((await creerClient(db, NouveauClient.parse({ id: "", nom: "Deuxième" }), admin)).id).toBe("NC02");
    await expect(creerClient(db, NouveauClient.parse({ id: "p17", nom: "Doublon" }), admin)).rejects.toThrow(/existe déjà/);
    expect(NouveauClient.safeParse({ id: "12-AB", nom: "X" }).success).toBe(false);
    // Visible dans le portefeuille, sans indicateurs ni alerte
    const { rows } = await loadPortfolio(db);
    expect(rows.find((x) => x.id === "NC01")).toMatchObject({ m: null, groupe: "Groupe Test" });
    await activerClient(db, "NC02", false, admin);
    expect((await loadPortfolio(db)).rows.some((x) => x.id === "NC02")).toBe(false);
    expect(await groupeParNom(db, "Groupe Test")).toBe(c.groupeId);
    expect(await groupeParNom(db, "  ")).toBeNull();
  });
});
