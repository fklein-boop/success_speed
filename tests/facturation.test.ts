import { describe, it, expect, beforeAll } from "vitest";
import { getDb, type DB } from "@/db";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { ajoutsTableProduction, facturationMois, reglagesFacturation } from "@/lib/server/facturation";
import { ecrireParametre } from "@/lib/server/parametres";
import { lignesFacture, moisPrecedent, tableEnTexte, texteEnTable, PRODUCTION_DEFAUT, syntheseAgence } from "@/lib/facturation/calcul";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";

/**
 * Factures de septembre 2026 (F-202610-5xx) recalculées depuis l'export dossiers :
 * mêmes quantités et montants pour les frais variables (abonnements et remises hors périmètre).
 */
describe("Facturation — factures de septembre 2026", () => {
  let db: DB;
  let f: Awaited<ReturnType<typeof facturationMois>>;
  const fact = (...ids: string[]) => lignesFacture(f.agences.filter((a) => ids.includes(a.idAgence)), f.tarifs);
  const ligne = (ids: string[], code: string) => fact(...ids).find((l) => l.code === code);
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    f = await facturationMois(db, "2026-09");
  });

  it("données complètes pour septembre", () => {
    expect(f).toMatchObject({ debut: "2026-09-01", fin: "2026-09-30", complet: true });
  });

  it("Bourse des Voyages (F-202610-593) : 206 demandes, 48 pax prod interne, 1 % de 13 724 €", () => {
    expect(ligne(["B06"], "demandes")).toMatchObject({ quantite: 206, montant: 103, detail: "197 pax + 9 pax Resalive KO" });
    expect(ligne(["B06"], "interne")).toMatchObject({ quantite: 48, montant: 96 });
    expect(ligne(["B06"], "externe")).toMatchObject({ montant: 137.24 });
  });

  it("Quartier Libre, facture unique multi-comptes (F-202610-594) : 488 demandes, 326 pax prod interne", () => {
    const ql = ["Q01", "Q03", "Q07", "Q08"];
    const d = ligne(ql, "demandes")!;
    // La facture de septembre ne reprenait que Q01 et Q03 (Q07 : 2 pax, non facturés)
    expect(ligne(["Q01", "Q03", "Q08"], "demandes")).toMatchObject({ quantite: 488, montant: 244 });
    expect(ligne(["Q01", "Q03", "Q08"], "demandes")!.detail).toBe("Q01 : 200 pax + 5 pax resalive KO - Q03 : 276 pax + 7 pax resalive KO");
    expect(d.quantite).toBe(490);
    expect(ligne(ql, "interne")).toMatchObject({ quantite: 326, montant: 652, detail: "Q01 : 14 pax - Q03 : 272 pax - Q08 : 40 pax" });
    expect(ligne(ql, "externe")).toBeUndefined();
  });

  it("factures à un seul compte", () => {
    const attendu: [string, number, number | null][] = [["E16", 358, 61], ["R08", 59, null], ["R12", 106, 6], ["S28", 69, null], ["V25", 37, null], ["R15", 81, 100]];
    for (const [id, dem, int] of attendu) {
      expect(ligne([id], "demandes")?.quantite, id).toBe(dem);
      expect(ligne([id], "interne")?.quantite ?? null, id).toBe(int);
    }
    expect(ligne(["E16"], "demandes")?.montant).toBe(179);
    expect(ligne(["E16"], "interne")?.montant).toBe(122);
  });

  it("Egyptours.fr (E22) : fournisseurs EGYPTOURS.FR - 1241 / FLEX - 1242 en production interne", () => {
    const e22 = f.agences.find((a) => a.idAgence === "E22")!;
    expect(e22).toMatchObject({ production: true, prodPax: 2, horsProdCa: 0 });
    expect(ligne(["E22"], "interne")).toMatchObject({ quantite: 2, montant: 4 });
    expect(ligne(["E22"], "externe")).toBeUndefined();
    expect(syntheseAgence("E22", [{ idAgence: "E22", producteur: false, pax: 3, origine: "RésaLive", erreurResalive: false, fournisseur: "EGYPTOURS.FR FLEX - 1242", total: 900, date: "2026-09-02" }], PRODUCTION_DEFAUT).prodPax).toBe(3);
  });

  it("table déjà enregistrée : E22 ajoutée une seule fois par la migration", async () => {
    const { E22: _e22, ...ancienne } = PRODUCTION_DEFAUT;
    await ecrireParametre(db, "facturation_production", { ...ancienne, Z99: ["TEST"] }, null);
    expect(await ajoutsTableProduction(db)).toEqual(["migration_facturation_e22"]);
    const { production } = await reglagesFacturation(db);
    expect(production.E22).toEqual(["EGYPTOURS.FR - 1241", "EGYPTOURS.FR FLEX - 1242"]);
    expect(production.Z99).toEqual(["TEST"]);
    expect(await ajoutsTableProduction(db)).toEqual([]);
  });

  it("agence sans production déclarée : RésaLive OK compté hors production", () => {
    const s24 = f.agences.find((a) => a.idAgence === "S24")!;
    expect(s24).toMatchObject({ production: false, prodPax: 0, horsProdPax: 7 });
    expect(ligne(["S24"], "externe")!.detail).toMatch(/aucune production interne déclarée/);
  });
});

describe("Facturation — utilitaires", () => {
  it("mois facturé par défaut : le mois entier écoulé", () => {
    expect(moisPrecedent(new Date("2026-10-27T10:00:00Z"))).toBe("2026-09");
    expect(moisPrecedent(new Date("2027-01-03T10:00:00Z"))).toBe("2026-12");
  });
  it("table de production : aller-retour texte, comme les colonnes T:U de la matrice", () => {
    expect(texteEnTable(tableEnTexte(PRODUCTION_DEFAUT))).toEqual(PRODUCTION_DEFAUT);
    expect(texteEnTable("x99 ; Fournisseur test\n\nmauvaise ligne")).toEqual({ X99: ["Fournisseur test"] });
  });
  it("les dossiers producteurs ne sont jamais facturés", () => {
    const s = syntheseAgence("Z01", [
      { idAgence: "Z01", producteur: true, pax: 5, origine: "Commande", erreurResalive: false, fournisseur: null, total: 100, date: "2026-09-02" },
      { idAgence: "Z01", producteur: false, pax: 3, origine: "Commande", erreurResalive: false, fournisseur: null, total: 100, date: "2026-09-02" },
      { idAgence: "Z01", producteur: false, pax: 2, origine: "RésaLive", erreurResalive: true, fournisseur: null, total: 100, date: "2026-09-02" },
    ], {});
    expect(s).toMatchObject({ demandes: 3, resaliveKo: 2, resaliveOkPax: 0 });
  });
});
