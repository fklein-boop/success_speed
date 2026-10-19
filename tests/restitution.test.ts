import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { actions, clientSnapshots, clientUrls, envoisClient, restitutions, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { finaliserAudit, getAuditState, saveEvaluation, validerPropositions } from "@/lib/server/audits";
import { creerScan, executerScan } from "@/lib/server/scans";
import { chargerRestitution, envoyerRestitution, genererPlan, genererTextes, majAction, modeleClient, pdfClient, type RestitutionAvecAudit } from "@/lib/server/restitution";
import { construirePlan, quadrant, statutEffectif } from "@/lib/restitution/plan";
import { leviersEnRetard } from "@/lib/restitution/leviers";
import { texteAlerteLegale } from "@/lib/restitution/textes";
import { parisVersUtc } from "@/lib/format";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";
process.env.SCAN_AUTORISER_LOCAL = "1";
process.env.SCAN_INTERVALLE_MS = "0";
process.env.SCAN_NAVIGATEUR = "non";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;

const metriques = (x: Partial<ClientMetrics>): ClientMetrics => ({
  id: "X", segment: "À risque", risque: "À surveiller", usage: "Demandes / devis", sante: 40, s_dynamique: 0, s_activite: 10, s_usage: 2, s_qualite: 20,
  volume_12m: 100000, va_confirme_12m: 20000, volume_90j: 10000, volume_90j_n1: 30000, evol_90j: -0.66, volume_30j: 3000, moyenne_mensuelle_3m: 4000, evol_30j_vs_3m: -0.25,
  volume_ytd: 80000, volume_ytd_n1: 120000, dossiers_12m: 120, dossiers_90j: 30, confirmes_12m: 4, annules_12m: 1, devis_12m: 100, resalive_12m: 0,
  transformation: 0.033, taux_erreur_resalive: 0, taux_annulation: 0.2, jours_sans_dossier: 3, dernier_dossier: "2026-10-09", va_global_estime: null, part_captee: null,
  alertes: [], alerte_principale: "", opportunites: [], ...x,
} as ClientMetrics);

describe("Leviers et priorisation (§ 7)", () => {
  it("repère les indicateurs en retard avec un constat chiffré", () => {
    const l = leviersEnRetard(metriques({}), ["LEG-02"]);
    expect(l.map((x) => x.code)).toEqual(["volume", "transformation", "legal"]);
    expect(l[0]).toMatchObject({ poids: 3, constat: "Volume 90 j en baisse de 66 % sur un an." });
    expect(leviersEnRetard(metriques({ evol_90j: 0.1, transformation: 0.4 }), [])).toEqual([]);
  });

  it("impact = points × part manquante × poids du levier ; les obligations légales passent en tête", () => {
    const cs = [
      { id: "PERF-12", pilier: "Performance", critere: "Transformation", points: 10, obligationLegale: false, offreSiNon: "Plan d'action commercial" },
      { id: "VIS-07", pilier: "Visibilité", critere: "Sitemap", points: 8, obligationLegale: false, offreSiNon: "Audit SEO technique" },
      { id: "LEG-05", pilier: "Légal", critere: "Médiateur", points: 4, obligationLegale: true, offreSiNon: "Kit pages légales agence de voyages" },
      { id: "TECH-01", pilier: "Technique", critere: "HTTPS", points: 6, obligationLegale: false, offreSiNon: "Hébergement / certificat" },
    ];
    const statuts = new Map<string, never>([["PERF-12", "NON"], ["VIS-07", "PARTIELLEMENT"], ["LEG-05", "NON"], ["TECH-01", "OUI"]] as never);
    const plan = construirePlan(cs, statuts, leviersEnRetard(metriques({}), ["LEG-05"]), { "Plan d'action commercial": "moyen", "Audit SEO technique": "moyen", "Hébergement / certificat": "faible" });
    expect(plan.map((a) => a.critereId)).toEqual(["LEG-05", "PERF-12", "VIS-07"]);
    expect(plan[1]).toMatchObject({ impact: 30, effort: "moyen", priorite: 15 }); // 10 pts × 1 × poids 3, ÷ 2
    expect(plan[2].impact).toBe(12); // 8 × 0,5 × poids 3 (levier volume)
    expect(quadrant(plan[0])).toBe("Obligation légale");
  });

  it("pré-audit : à défaut de réponse validée, le résultat automatique est retenu", () => {
    expect(statutEffectif({ statut: null, proposition: { statut: "NON" } }, false)).toBe("NON");
    expect(statutEffectif({ statut: null, proposition: { statut: "NON" } }, true)).toBeNull();
    expect(statutEffectif({ statut: "OUI", proposition: { statut: "NON" } }, false)).toBe("OUI");
  });

  it("texte d'alerte légale prêt à envoyer, avec la référence réglementaire", () => {
    const t = texteAlerteLegale({ id: "LEG-07", critere: "Prix TTC et promotions", offreSiNon: "Paramétrage affichage prix" }, "NON", "Prix barrés sans prix de référence.");
    expect(t).toContain("L112-1-1");
    expect(t).toContain("Constat : Prix barrés sans prix de référence.");
  });

  it("heure de Paris → UTC, été comme hiver", () => {
    expect(parisVersUtc("2026-07-15T14:30").toISOString()).toBe("2026-07-15T12:30:00.000Z");
    expect(parisVersUtc("2026-12-15T14:30").toISOString()).toBe("2026-12-15T13:30:00.000Z");
  });
});

describe("Parcours complet : pré-audit → complétion → restitution", () => {
  let db: DB, alice: number, server: Server, url: string;

  beforeAll(async () => {
    const dir = new URL("./fixtures/scan/", import.meta.url);
    server = createServer((req, res) => {
      const p = (req.url ?? "/").split("?")[0];
      const [site, ...rest] = (/^\/(robots\.txt|sitemap\.xml)$/.test(p) ? `/bon${p}` : p).split("/").filter(Boolean);
      let chemin = rest.join("/") || "index.html";
      if (!/\.\w+$/.test(chemin)) chemin += ".html";
      const f = new URL(`${site}/${chemin}`, dir);
      if (!existsSync(f)) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "content-type": chemin.endsWith(".xml") ? "application/xml" : chemin.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8" });
      res.end(readFileSync(f, "utf8").replace(/(href|src)="\/(?!\/)/g, `$1="/${site}/`));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const a = server.address();
    url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/bon/`;

    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    [{ id: alice }] = await db.insert(users).values({ email: "alice@test", nom: "Alice Martin", role: "csm" }).returning();
    await db.insert(clientUrls).values({ clientId: "A05", url, principale: false });
  });
  afterAll(() => server.close());

  let auditId: number;

  it("pré-audit (scan) puis complétion et finalisation", async () => {
    const s = await creerScan(db, "A05", url, alice);
    await executerScan(db, s.id);
    const st = await getAuditState(db, (await chargerRestitution(db, "A05") as RestitutionAvecAudit).audit.id);
    auditId = st.audit.id;
    expect(st.evaluations.filter((e) => e.proposition).length).toBeGreaterThan(20);
    await validerPropositions(db, auditId, alice);
    // Le CSM confirme un résultat à confiance basse et répond à un critère « CSM »
    await saveEvaluation(db, auditId, alice, { critereId: "VIS-01", statut: "NON", valeur: null, commentaire: null, aEnvoyerClient: false } as never);
    await saveEvaluation(db, auditId, alice, { critereId: "PERF-13", statut: "NON", valeur: null, commentaire: null, aEnvoyerClient: false } as never);
    await finaliserAudit(db, auditId);
  }, 120_000);

  it("restitution : score, leviers en retard, plan proposé, alertes légales", async () => {
    const r = await chargerRestitution(db, "A05") as RestitutionAvecAudit;
    expect(r.finalise).toBe(true);
    expect(r.score.score).not.toBeNull();
    expect(r.enRetard.some((l) => l.code === "volume")).toBe(true); // Amerikasia : volume 90 j −100 %
    expect(r.planPropose.length).toBeGreaterThan(3);
    expect(r.scoreVise).toBeGreaterThan(r.score.score!);
    const causeVolume = r.causes.find((c) => c.levier.startsWith("Volume"))!;
    expect(causeVolume.criteres.join(" ")).toMatch(/VIS-01/);
  });

  it("plan d'action : création sans doublon, re-vérification à l'action faite", async () => {
    const r1 = await genererPlan(db, "A05", alice);
    expect(r1.creees).toBeGreaterThan(3);
    expect((await genererPlan(db, "A05", alice)).creees).toBe(0);
    const liste = await db.select().from(actions).where(eq(actions.clientId, "A05"));
    // Critère « Données Speedmedia » : recalcul immédiat sur le dernier export
    const donnees = liste.find((a) => a.critereId === "PERF-12" || a.critereId === "PERF-06")!;
    expect((await majAction(db, donnees.id, alice, { statut: "fait" })).verification).toBe("donnees");
    // Critère avec contrôle automatique : scan ciblé, résultat reporté sur l'action
    const auto = liste.find((a) => a.critereId === "VIS-07" || a.critereId === "TECH-01")!;
    const v = await majAction(db, auto.id, alice, { statut: "fait" });
    expect(v.verification).toBe("scan");
    await executerScan(db, v.scanId!);
    const [apres] = await db.select().from(actions).where(eq(actions.id, auto.id));
    expect(apres.verifStatut).not.toBe("en_cours");
    expect(apres.verifLe).not.toBeNull();
    // Critère CSM / client : à confirmer au prochain audit
    const manuel = liste.find((a) => a.critereId === "PERF-13")!;
    expect((await majAction(db, manuel.id, alice, { statut: "fait" })).verification).toBe("manuel");
  }, 60_000);

  it("textes (modèle sans clé Anthropic), modèle client sans aucune donnée interne", async () => {
    expect((await genererTextes(db, "A05", alice)).source).toBe("modele");
    const [t] = await db.select().from(restitutions).where(eq(restitutions.auditId, auditId));
    expect(t.explication).toMatch(/Amerikasia est en retard sur \d levier/);
    const r = await chargerRestitution(db, "A05") as RestitutionAvecAudit;
    const m = modeleClient(r);
    const json = JSON.stringify(m);
    const [snap] = await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, "A05"));
    const metr = snap.data as ClientMetrics;
    expect(json).not.toMatch(/sant[ée]|churn|risque|Critique|À surveiller|transformation de|volume 90/i);
    expect(json).not.toContain(String(Math.round(metr.volume_12m)));
    for (const a of metr.alertes) expect(json).not.toContain(a.message);
    expect(m.synthese).toMatch(/score de \d+\/100/);
  });

  it("PDF de restitution et envoi au client (tracé)", async () => {
    const pdf = await pdfClient(db, "A05");
    expect(pdf.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.buffer.length).toBeGreaterThan(10_000);
    expect(pdf.filename).toBe(`Restitution-SpeedResa_Amerikasia_audit-final_${new Date().toISOString().slice(0, 10)}.pdf`);
    await expect(envoyerRestitution(db, "A05", alice, { destinataires: "pas-un-email", objet: "x", corps: "y", joindreCsv: false })).rejects.toThrow(/invalide/);
    const r = await envoyerRestitution(db, "A05", alice, { destinataires: "contact@amerikasia.example", objet: "Votre audit", corps: "Bonjour,\n\nVoici votre audit.", joindreCsv: true });
    expect(r.pieces).toHaveLength(2);
    const envois = await db.select().from(envoisClient).where(eq(envoisClient.clientId, "A05"));
    expect(envois[0]).toMatchObject({ destinataires: "contact@amerikasia.example", type: "restitution" });
  }, 60_000);
});

describe("Rédaction par Claude", () => {
  it("le schéma de réponse se convertit en schéma d'outil valide (objet, champs requis)", async () => {
    const { z } = await import("zod");
    const { SchemaTextes } = await import("@/lib/server/restitution");
    const j = z.toJSONSchema(SchemaTextes) as { type: string; required: string[]; properties: Record<string, { description?: string }> };
    expect(j.type).toBe("object");
    expect(j.required.sort()).toEqual(["email_corps", "email_objet", "explication", "plan30", "synthese"]);
    expect(j.properties.synthese.description).toMatch(/^CLIENT/);
    expect(j.properties.explication.description).toMatch(/^INTERNE/);
  });
});
