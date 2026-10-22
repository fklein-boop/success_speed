import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { alertes, clients, clientSnapshots, evaluations, imports, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { createAudit } from "@/lib/server/audits";
import { appliquerExport } from "@/lib/server/backoffice";
import { recomputeAll } from "@/lib/server/recompute";
import { readTabularFile } from "@/lib/import/read-file";
import { colonnesBackoffice, lireLignesBackoffice, typeDeFichier, type LigneBackoffice, type TypeBackoffice } from "@/lib/import/backoffice";
import { CHAMPS, detectColumns, rowsToDossiers } from "@/lib/import/dossiers";
import { propositionsDonnees } from "@/lib/audit/donnees";
import { propositionsBackoffice, type EntreeBackoffice } from "@/lib/audit/backoffice";
import { toCritereScore } from "@/lib/server/audits";
import type { ClientMetrics, Dossier } from "@/lib/metrics/compute";
import criteresKit from "../data/kit/03_criteres.json";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";

const crit = new Map(criteresKit.criteres.map((c) => [c.id, toCritereScore({
  id: c.id, version: 1, pilier: c.pilier, critere: c.critere, source: c.source, type: c.type, sens: c.sens, seuilPlein: c.seuil_plein, seuilMoitie: c.seuil_moitie,
  unite: c.unite, points: c.points, obligationLegale: c.obligation_legale, actif: true,
} as never)]));
const D = (date: string, statut = "Validée", total = 1000, extra: Partial<Dossier> = {}): Dossier => ({ idAgence: "X", idResa: Math.random().toString(36).slice(2), date, statut, origine: "", total, erreurResalive: false, ...extra });
const prop = (l: { critereId: string }[], id: string) => l.find((p) => p.critereId === id) as ReturnType<typeof propositionsDonnees>[number] | undefined;

describe("A1 — critères « Données » toujours automatiques", () => {
  it("client sans aucun volume récent (cas S30) : NON / N.A. en confiance haute, jamais de question manuelle", () => {
    const rows = [D("2025-01-31", "Devis", 0), D("2025-03-12"), D("2025-05-02", "Devis", 0), D("2024-09-15"), D("2024-08-01")];
    const l = propositionsDonnees(null, rows, "2026-10-12", crit);
    for (const id of ["PERF-05", "PERF-06", "PERF-12", "RES-04", "RES-05", "SOC-07"]) {
      const p = prop(l, id)!;
      expect(p, id).toBeDefined();
      expect(p.statut, id).not.toBeNull();
      expect(p.confiance, id).toBe("haute");
      expect(p.texte.length, id).toBeGreaterThan(10);
    }
    expect(prop(l, "PERF-05")).toMatchObject({ statut: "NON", texte: expect.stringMatching(/Aucune vente confirmée sur les 90 derniers jours ni sur la même période/) });
    expect(prop(l, "PERF-06")?.statut).toBe("NON");
    expect(prop(l, "PERF-12")?.statut).toBe("NON");
    expect(prop(l, "RES-04")?.statut).toBe("NON");
    expect(prop(l, "RES-05")?.statut).toBe("N.A.");
  });
  it("volume nul cette année mais pas l'an dernier : NON ; nouveau client : N.A. expliqué", () => {
    const anDernier = propositionsDonnees(null, [D("2025-09-01"), D("2025-08-20"), D("2024-01-10")], "2026-10-12", crit);
    expect(prop(anDernier, "PERF-05")).toMatchObject({ statut: "NON", valeur: 0 });
    expect(prop(anDernier, "PERF-06")?.statut).toBe("NON");
    const nouveau = propositionsDonnees(null, [D("2026-09-01"), D("2026-10-01")], "2026-10-12", crit);
    expect(prop(nouveau, "PERF-05")).toMatchObject({ statut: "N.A.", confiance: "haute", texte: expect.stringMatching(/Historique insuffisant/) });
    expect(prop(nouveau, "PERF-06")?.statut).toBe("N.A.");
  });
});

describe("A2 — PERF-04 et TRK-01", () => {
  const m = { dossiers_12m: 10, transformation: 0.5, confirmes_12m: 5, resalive_12m: 0, taux_erreur_resalive: 0, evol_90j: 0.1 } as ClientMetrics;
  it("sans trafic : non vérifiable, avec un lien vers l'écran Google Analytics, sans question", () => {
    const p = prop(propositionsDonnees(m, [D("2024-01-01")], "2026-10-12", crit), "PERF-04")!;
    expect(p).toMatchObject({ statut: null, confiance: "basse" });
    expect(p.preuve.url).toBe("/admin/google-analytics");
    expect(p.texte).toMatch(/trafic du site inconnu/);
  });
  it("trafic GA4 : PERF-04 calculé (site web seulement si la colonne Origine existe) et TRK-01 à OUI", () => {
    const l = propositionsDonnees({ ...m, conversion: 0.02, conversion_site: 0.012, visites_mensuelles: 5000, periode_trafic: "06/2026 à 09/2026", source_trafic: "GA4" }, [D("2024-01-01")], "2026-10-12", crit);
    expect(prop(l, "PERF-04")).toMatchObject({ valeur: 0.012, statut: "PARTIELLEMENT", confiance: "haute" });
    expect(prop(l, "PERF-04")!.texte).toMatch(/site web/);
    expect(prop(l, "TRK-01")).toMatchObject({ statut: "OUI", confiance: "haute" });
    const sansGa4 = propositionsDonnees({ ...m, conversion: 0.02, visites_mensuelles: 5000, source_trafic: "fichier" }, [D("2024-01-01")], "2026-10-12", crit);
    expect(prop(sansGa4, "PERF-04")).toMatchObject({ statut: "OUI", valeur: 0.02 });
    expect(prop(sansGa4, "TRK-01")).toBeUndefined();
  });
});

/** Lecture d'un fichier d'exemple comme dans le navigateur */
async function lireFixture(nom: string) {
  const buf = await readFile(`tests/fixtures/backoffice/${nom}`);
  const sheet = await readTabularFile(nom, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const type = typeDeFichier(sheet.headers) as TypeBackoffice;
  const { mapping, manquants } = colonnesBackoffice(type, sheet.headers);
  return { type, manquants, ...lireLignesBackoffice(type, sheet.rows, mapping) };
}

describe("A3 — exports back-office : reconnaissance et lecture", () => {
  it("reconnaît chaque export à ses colonnes et lit toutes les lignes", async () => {
    const cat = await lireFixture("export_catalogue_2026-10-26.csv");
    expect(cat).toMatchObject({ type: "catalogue", manquants: [], ignorees: 0 });
    expect(cat.lignes).toHaveLength(29);
    expect(cat.lignes[0]).toMatchObject({ idAgence: "P17", idProduit: "P17-001", enLigne: true, prixAdulte: true, departsFuturs: 5, dateMaj: "2026-10-06" });
    const conf = await lireFixture("export_configuration_2026-10-26.csv");
    expect(conf.type).toBe("configuration");
    expect(conf.lignes[0]).toMatchObject({ idAgence: "P17", moyensPaiement: ["PayBox", "Virement", "Chèques-vacances"], connecteurs: ["RésaLive", "CRM Exemple"], troisDs: true, connexions30j: 42 });
    expect((await lireFixture("export_connexions_2026-10-26.csv")).type).toBe("connexions");
    const pb = await lireFixture("export_paybox_2026-09.csv");
    expect(pb).toMatchObject({ type: "paybox", manquants: [] });
    expect(pb.lignes[0]).toMatchObject({ reference: "PBX-1001", idResa: "990001", statut: "acceptée", troisDs: true });
  });
  it("l'export dossiers reste reconnu, les colonnes enrichies sont facultatives et lues quand elles existent", () => {
    expect(typeDeFichier(Object.values(CHAMPS).slice(0, 14).map((c) => c.label))).toBe("dossiers");
    const h = [...Object.values(CHAMPS).slice(0, 14).map((c) => c.label), "ID produit", "Origine", "Montant options", "Montant assurance", "Date de confirmation", "Email renseigné", "Payé en ligne"];
    const { mapping, manquants } = detectColumns(h);
    expect(manquants).toEqual([]);
    expect(mapping.origine).toBe(10);
    expect(mapping.canal).toBe(15);
    const { dossiers } = rowsToDossiers([["P17", "non", "123", "", "", "", "01/10/2026", "", "2", "Validée", "Réservation", "1000", "1000", "Non", "P17-001", "Site web", "120.50", "30", "02/10/2026", "oui", "1000"]], mapping, "2026-10-26");
    expect(dossiers[0]).toMatchObject({ canal: "site web", montantOptions: 120.5, montantAssurance: 30, dateConfirmation: "2026-10-02", emailRenseigne: true, payeEnLigne: 1000, idProduit: "P17-001" });
    const ancien = rowsToDossiers([["P17", "non", "124", "", "", "", "01/10/2026", "", "2", "Validée", "Réservation", "1000", "1000", "Non"]], detectColumns(h.slice(0, 14)).mapping, "2026-10-26").dossiers[0];
    expect("canal" in ancien).toBe(false);
  });
});

describe("A4 — critères tirés des exports", () => {
  const entree = (x: Partial<EntreeBackoffice>): EntreeBackoffice => ({ aujourdhui: "2026-10-26", modele: "B2C", catalogue: null, config: undefined, connexions: null, paybox: null, dossiers: [], m: null, sourceAbandon: "ga4", ...x });
  it("sans export : critères en attente, avec la mention de l'export manquant", () => {
    const r = propositionsBackoffice(entree({}), crit);
    expect(r.propositions).toEqual([]);
    expect(r.attentes.find((a) => a.critereId === "PROD-02")?.texte).toMatch(/export catalogue/);
    expect(r.attentes.find((a) => a.critereId === "SOC-03")?.texte).toMatch(/export configuration/);
    expect(r.attentes.find((a) => a.critereId === "SOC-04")?.texte).toMatch(/export PayBox/);
    expect(r.attentes.find((a) => a.critereId === "PERF-08")?.texte).toMatch(/dossiers enrichi/);
  });
  it("catalogue, configuration, connexions, PayBox et dossiers enrichis (P17 fictif)", async () => {
    const cat = (await lireFixture("export_catalogue_2026-10-26.csv")).lignes.filter((l) => l.idAgence === "P17");
    const conf = (await lireFixture("export_configuration_2026-10-26.csv")).lignes.find((l) => l.idAgence === "P17")!;
    const cnx = (await lireFixture("export_connexions_2026-10-26.csv")).lignes.filter((l) => l.idAgence === "P17");
    const pb = (await lireFixture("export_paybox_2026-09.csv")).lignes;
    const dossiers = [
      ...Array.from({ length: 10 }, (_, i) => D(`2026-09-${String(i * 2 + 1).padStart(2, "0")}`, "Validée", 1000, { idResa: `99${String(i + 1).padStart(4, "0")}`, payeEnLigne: 1000, montantOptions: 100, montantAssurance: 50 })),
      D("2026-09-15", "Validée", 1000, { idResa: "995555", payeEnLigne: 800, montantOptions: 0, montantAssurance: 0 }),
    ];
    const r = propositionsBackoffice(entree({ catalogue: cat as never, config: conf as never, connexions: cnx.map((x) => ({ date: x.date as string, nb: x.nbConnexions as number })), paybox: pb.map((t) => ({ idResa: t.idResa as string, statut: t.statut as string, date: t.date as string })), dossiers, modele: "B2C" }), crit);
    const s = (id: string) => r.propositions.find((p) => p.critereId === id);
    // 14 internes en ligne : 13 avec prix enfant → 93 %
    expect(s("PROD-02")).toMatchObject({ statut: "OUI", confiance: "haute" });
    expect(s("PERF-03")?.statut).toBe("PARTIELLEMENT"); // 12/14 = 86 % : sous 90 %, au-dessus de 70 %
    expect(s("PROD-05")?.statut).toBe("OUI"); // 12/19
    expect(s("PROD-08")?.statut).toBe("OUI"); // 15/19 = 79 % ≥ 70 %
    expect(s("SOC-03")?.statut).toBe("OUI");
    expect(s("LEG-12")?.statut).toBe("OUI");
    expect(s("SOC-06")?.statut).toBe("OUI");
    expect(s("SOC-02")?.statut).toBe("OUI");
    expect(s("DIST-01")?.statut).toBe("OUI");
    expect(s("RES-01")?.statut).toBe("N.A.");
    expect(s("SOC-01")?.statut).toBe("OUI");
    expect(s("PERF-02")).toMatchObject({ statut: "OUI", confiance: "moyenne" });
    expect(s("SOC-08")?.statut).toBe("OUI");
    expect(s("PROD-07")).toMatchObject({ statut: "OUI" }); // 11/19 = 58 %
    expect(s("PERF-08")).toMatchObject({ statut: "PARTIELLEMENT" }); // 1 500 / 11 000 = 13,6 % : sous 15 %, au-dessus de 8 %
    expect(s("SOC-04")).toMatchObject({ statut: "PARTIELLEMENT" }); // 10 sur 11 = 91 % : entre 90 et 98 %
    expect(s("SOC-04")!.texte).toMatch(/995555/);
    expect(r.attentes.find((a) => a.critereId === "PERF-07")?.texte).toMatch(/Google Analytics/);
  });
  it("S30 fictif : catalogue hors ligne, configuration défavorable", async () => {
    const cat = (await lireFixture("export_catalogue_2026-10-26.csv")).lignes.filter((l) => l.idAgence === "S30");
    const conf = (await lireFixture("export_configuration_2026-10-26.csv")).lignes.find((l) => l.idAgence === "S30")!;
    const r = propositionsBackoffice(entree({ catalogue: cat as never, config: conf as never, modele: "B2B" }), crit);
    const s = (id: string) => r.propositions.find((p) => p.critereId === id);
    expect(s("PROD-02")?.statut).toBe("N.A.");
    expect(s("SOC-03")?.statut).toBe("NON");
    expect(s("DIST-01")).toMatchObject({ statut: "NON", texte: expect.stringMatching(/Éligible/) });
    expect(s("RES-01")?.statut).toBe("NON");
    expect(s("SOC-08")?.statut).toBe("NON");
    expect(s("SOC-02")?.statut).toBe("NON");
  });
});

describe("Lot A de bout en bout (base)", () => {
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
    [{ id: admin }] = await db.insert(users).values({ email: "csm-lot-a@test", role: "superadmin" }).returning();
  });

  it("audit S30 : tous les critères calculables sur l'export sont proposés, les autres attendent leur export", async () => {
    const { id } = await createAudit(db, "S30", admin);
    const evs = await db.select().from(evaluations).where(eq(evaluations.auditId, id));
    const ev = (c: string) => evs.find((e) => e.critereId === c);
    for (const c of ["PERF-05", "PERF-06", "PERF-12", "RES-04", "RES-05", "SOC-07"]) {
      expect(ev(c)?.proposition, c).toBeTruthy();
      expect((ev(c)!.proposition as { statut: string | null }).statut, c).not.toBeNull();
      expect(ev(c)!.confiance, c).toBe("haute");
    }
    expect((ev("PERF-05")!.proposition as { statut: string }).statut).toBe("NON");
    expect((ev("PROD-02")!.preuve as { texte: string }).texte).toMatch(/export catalogue/);
    expect(ev("PROD-02")!.proposition).toBeNull();
  });

  it("exports importés : les critères se remplissent à la réouverture du brouillon, sans écraser une réponse", async () => {
    for (const nom of ["export_catalogue_2026-10-26.csv", "export_configuration_2026-10-26.csv", "export_connexions_2026-10-26.csv", "export_paybox_2026-09.csv"]) {
      const f = await lireFixture(nom);
      // Deux morceaux, comme le navigateur pour un gros fichier
      const moitie = Math.ceil(f.lignes.length / 2);
      const r1 = await appliquerExport(db, admin, f.type, nom, f.lignes.slice(0, moitie) as LigneBackoffice[]);
      if (f.lignes.length > moitie) await appliquerExport(db, admin, f.type, nom, f.lignes.slice(moitie) as LigneBackoffice[], { importId: r1.importId });
    }
    expect((await db.select().from(imports).where(eq(imports.type, "catalogue")))).toHaveLength(1);
    const [audit] = await db.select().from(evaluations).where(eq(evaluations.critereId, "PERF-05")).limit(1);
    // Le CSM a déjà répondu à SOC-03 : sa réponse est gardée
    await db.update(evaluations).set({ statut: "OUI", source: "csm" }).where(and(eq(evaluations.auditId, audit.auditId), eq(evaluations.critereId, "SOC-03")));
    await createAudit(db, "S30", admin);
    const evs = await db.select().from(evaluations).where(eq(evaluations.auditId, audit.auditId));
    const ev = (c: string) => evs.find((e) => e.critereId === c);
    expect((ev("DIST-01")!.proposition as { statut: string }).statut).toBe("NON");
    expect((ev("PROD-02")!.proposition as { statut: string }).statut).toBe("N.A.");
    expect(ev("SOC-03")).toMatchObject({ statut: "OUI", source: "csm" });
  });

  it("alertes : fin de contrat proche sans RDV, aucune connexion depuis 30 jours, fiche Google fermée", async () => {
    const dans = (j: number) => new Date(Date.now() + j * 86400_000).toISOString().slice(0, 10);
    await appliquerExport(db, admin, "configuration", "conf.csv", [
      { idAgence: "P17", dateFinContrat: dans(45), derniereConnexionBo: dans(-40), connexions30j: 0 },
      { idAgence: "A05", dateFinContrat: dans(200), derniereConnexionBo: dans(-2), connexions30j: 5 },
    ]);
    await db.update(clients).set({ googleStatut: "CLOSED_PERMANENTLY" }).where(eq(clients.id, "A05"));
    await recomputeAll(db);
    const ouvertes = (c: string) => db.select().from(alertes).where(eq(alertes.clientId, c)).then((l) => l.filter((a) => !a.closeLe).map((a) => a.code));
    // P17 a des connexions récentes dans l'export connexions : seule l'échéance du contrat alerte
    expect(await ouvertes("P17")).toContain("contrat_echeance");
    expect(await ouvertes("A05")).toContain("fiche_google_fermee");
    expect(await ouvertes("A05")).not.toContain("contrat_echeance");
    const [snap] = await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, "A05"));
    expect((snap.data as ClientMetrics).risque).toBe("Critique");
  });
});
