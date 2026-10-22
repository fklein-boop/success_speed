import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { evaluations, questionnaires, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { createAudit, loadCriteres, saveEvaluation } from "@/lib/server/audits";
import { creerQuestionnaire, enregistrerReponse, relancerQuestionnaires, soumettreQuestionnaire, vueClient, questionnaireParJeton } from "@/lib/server/questionnaires";
import { normaliserReponse, questionsPourAudit, statutDepuisReponse, type Question } from "@/lib/questionnaire/questions";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";
process.env.AUTH_SECRET = "secret-de-test-questionnaire-32-caracteres";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;

const jetonDe = (lien: string) => lien.split("/q/")[1];

describe("Questions et interprétation des réponses", () => {
  const cs = [
    { id: "VIS-05", critere: "Au moins 2 publications par semaine", source: "Client", questionClient: "Combien ?", sens: null, seuilPlein: null, seuilMoitie: null, unite: null },
    { id: "PROD-01", critere: "Part de la production digitalisée", source: "Client + Données", questionClient: "Quelle part ?", sens: "↑", seuilPlein: 0.8, seuilMoitie: 0.5, unite: "%" },
    { id: "REL-02", critere: "Satisfaction (NPS) ≥ 8/10", source: "Client", questionClient: "Sur 10 ?", sens: "↑", seuilPlein: 8, seuilMoitie: 6, unite: "note /10" },
    { id: "LEG-09", critere: "Accessibilité", source: "Auto + Client", questionClient: "Moins de 10 salariés ?", sens: null, seuilPlein: null, seuilMoitie: null, unite: null },
    { id: "TRK-05", critere: "Pixels publicitaires", source: "Auto + Client", questionClient: "Publicité ?", sens: null, seuilPlein: null, seuilMoitie: null, unite: null },
    { id: "INN-03", critere: "Collecte d'avis", source: "Auto + Client", questionClient: "Avis ?", sens: null, seuilPlein: null, seuilMoitie: null, unite: null },
    { id: "PERF-13", critere: "Relance automatique des devis : en place", source: "CSM", questionClient: null, sens: null, seuilPlein: null, seuilMoitie: null, unite: null },
    { id: "VIS-04", critere: "Kit partenaires", source: "CSM", questionClient: null, sens: null, seuilPlein: null, seuilMoitie: null, unite: null },
  ];
  const q = (id: string) => questionsPourAudit(cs, new Map([["PERF-13", { statut: null, source: null, aEnvoyerClient: true }]])).find((x) => x.critereId === id)!;

  it("retient les critères « client » et ceux envoyés par le CSM, pas les autres", () => {
    const evals = new Map([["PERF-13", { statut: null, source: null, aEnvoyerClient: true }], ["INN-03", { statut: "OUI", source: "csm", aEnvoyerClient: false }]]);
    const ids = questionsPourAudit(cs, evals).map((x) => x.critereId);
    expect(ids).toEqual(["VIS-05", "PROD-01", "REL-02", "LEG-09", "TRK-05", "PERF-13"]); // INN-03 déjà tranché par le CSM, VIS-04 non envoyé
    expect(q("PERF-13").question).toMatch(/^Ce point est-il en place dans votre agence : relance automatique des devis/);
    expect(q("PROD-01").type).toBe("pourcentage");
    expect(q("REL-02").type).toBe("note10");
    expect(q("VIS-05")).toMatchObject({ type: "nombre", unite: "publications par semaine" });
  });

  it("valide les réponses selon le type", () => {
    expect(normaliserReponse({ type: "oui_non" }, "peut-être")).toBeNull();
    expect(normaliserReponse({ type: "pourcentage" }, "120")).toBeNull();
    expect(normaliserReponse({ type: "pourcentage" }, "85,5")).toBe("85.5");
    expect(normaliserReponse({ type: "note10" }, "7.5")).toBeNull();
    expect(normaliserReponse({ type: "nombre" }, "ne_sais_pas")).toBe("ne_sais_pas");
  });

  it("interprète les réponses (seuils, réponses inversées, réponses informatives)", () => {
    const s = (id: string, r: string) => statutDepuisReponse(cs.find((c) => c.id === id)!, q(id), r).statut;
    expect(s("VIS-05", "3")).toBe("OUI");
    expect(s("VIS-05", "1")).toBe("PARTIELLEMENT");
    expect(s("PROD-01", "85")).toBe("OUI");
    expect(statutDepuisReponse(cs[1], q("PROD-01"), "60").valeur).toBe(0.6);
    expect(s("REL-02", "7")).toBe("PARTIELLEMENT");
    expect(s("LEG-09", "oui")).toBe("N.A."); // micro-entreprise exemptée
    expect(s("LEG-09", "non")).toBeNull(); // informatif : le contrôle automatique décide
    expect(s("TRK-05", "non")).toBe("N.A."); // pas de publicité : critère sans objet
    expect(s("INN-03", "en_partie")).toBe("PARTIELLEMENT");
    expect(s("INN-03", "ne_sais_pas")).toBeNull();
  });
});

describe("Parcours du questionnaire (lien magique, report dans l'audit, relances)", () => {
  let db: DB, csm: number, auditId: number, lien: string;

  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    [{ id: csm }] = await db.insert(users).values({ email: "csm@test", nom: "Camille", role: "csm" }).returning();
    auditId = (await createAudit(db, "S25", csm)).id;
    // Le CSM envoie un critère au client (touche « ? ») et tranche lui-même INN-03
    await saveEvaluation(db, auditId, csm, { critereId: "PERF-13", statut: null, valeur: null, commentaire: null, aEnvoyerClient: true } as never);
    await saveEvaluation(db, auditId, csm, { critereId: "INN-03", statut: "NON", valeur: null, commentaire: null, aEnvoyerClient: false } as never);
  });

  it("crée et envoie le questionnaire ; le jeton n'est jamais stocké", async () => {
    await expect(creerQuestionnaire(db, auditId, csm, { email: "pas-un-email", envoyer: true })).rejects.toThrow(/invalide/);
    const r = await creerQuestionnaire(db, auditId, csm, { email: "Contact@Sourires.example", envoyer: true });
    lien = r.lien;
    expect(lien).toMatch(/\/q\/[A-Za-z0-9_-]{43}$/);
    const [q] = await db.select().from(questionnaires).where(eq(questionnaires.id, r.id));
    expect(q.email).toBe("contact@sourires.example");
    expect(q.envoyeLe).not.toBeNull();
    expect(JSON.stringify(q)).not.toContain(jetonDe(lien));
    const ids = (q.questions as Question[]).map((x) => x.critereId);
    expect(ids).toContain("PERF-13");
    expect(ids).toContain("LEG-09");
    expect(ids).not.toContain("INN-03");
  });

  it("le client ne voit que ses questions ; un jeton inconnu ne donne rien", async () => {
    const v = await vueClient(db, jetonDe(lien));
    expect(v.etat).toBe("ouvert");
    expect(v.client).toBe("Sourires du monde");
    expect(Object.keys(v).sort()).toEqual(["client", "csm", "etat", "questions", "reponses"]);
    expect(JSON.stringify(v)).not.toMatch(/score|sant[ée]|risque|alerte/i);
    expect((await vueClient(db, "x".repeat(43))).etat).toBe("inconnu");
    expect((await vueClient(db, "../../etc")).etat).toBe("inconnu");
  });

  it("enregistre les réponses au fil de l'eau, refuse les réponses invalides", async () => {
    const t = jetonDe(lien);
    await expect(enregistrerReponse(db, t, "LEG-09", "peut-être", null)).rejects.toThrow(/invalide/);
    await expect(enregistrerReponse(db, t, "VIS-01", "oui", null)).rejects.toThrow(/inconnue/);
    await enregistrerReponse(db, t, "LEG-09", "non", null);
    await enregistrerReponse(db, t, "LEG-09", "oui", "Nous sommes 6 salariés."); // le client se corrige
    await enregistrerReponse(db, t, "PERF-13", "en_partie", null);
    await enregistrerReponse(db, t, "PROD-01", "90", null);
    await enregistrerReponse(db, t, "VIS-05", "ne_sais_pas", null);
    expect((await vueClient(db, t)).reponses["LEG-09"]).toEqual({ reponse: "oui", commentaire: "Nous sommes 6 salariés." });
  });

  it("à l'envoi, les réponses arrivent dans « À valider » (propositions du client) et le lien est clos", async () => {
    const t = jetonDe(lien);
    const bilan = await soumettreQuestionnaire(db, t);
    expect(bilan.reportees).toBe(3); // LEG-09, PERF-13, PROD-01 ; « je ne sais pas » est ignoré
    const ev = async (id: string) => (await db.select().from(evaluations).where(and(eq(evaluations.auditId, auditId), eq(evaluations.critereId, id))))[0];
    // Lot B2 : rien n'est compté dans le score tant que le CSM n'a pas validé
    expect(await ev("LEG-09")).toMatchObject({ statut: null, source: "client", confiance: "moyenne", proposition: expect.objectContaining({ statut: "N.A.", source: "client" }) });
    expect((await ev("LEG-09")).commentaire).toContain("« Nous sommes 6 salariés. »");
    expect(await ev("PERF-13")).toMatchObject({ statut: null, source: "client", aEnvoyerClient: false, proposition: expect.objectContaining({ statut: "PARTIELLEMENT" }) });
    expect(await ev("PROD-01")).toMatchObject({ statut: null, valeur: "0.9", proposition: expect.objectContaining({ statut: "OUI" }) });
    await expect(soumettreQuestionnaire(db, t)).rejects.toThrow(/déjà/);
    await expect(enregistrerReponse(db, t, "VIS-05", "3", null)).rejects.toThrow(/déjà/);
    expect((await vueClient(db, t)).etat).toBe("repondu");
  });

  it("un nouveau questionnaire annule l'ancien lien ; un lien expiré est refusé", async () => {
    await saveEvaluation(db, auditId, csm, { critereId: "VIS-04", statut: null, valeur: null, commentaire: null, aEnvoyerClient: true } as never);
    const a = await creerQuestionnaire(db, auditId, csm, { email: null, envoyer: false });
    const b = await creerQuestionnaire(db, auditId, csm, { email: null, envoyer: false });
    expect((await questionnaireParJeton(db, jetonDe(a.lien))).etat).toBe("annule");
    expect((await questionnaireParJeton(db, jetonDe(b.lien))).etat).toBe("ouvert");
    await db.update(questionnaires).set({ expireLe: new Date(Date.now() - 1000) }).where(eq(questionnaires.id, b.id));
    expect((await questionnaireParJeton(db, jetonDe(b.lien))).etat).toBe("expire");
  });

  it("relances automatiques à J+3 puis J+7, une seule fois chacune", async () => {
    const r = await creerQuestionnaire(db, auditId, csm, { email: "contact@sourires.example", envoyer: true });
    const jours = (n: number) => new Date(Date.now() - n * 86400_000);
    await db.update(questionnaires).set({ envoyeLe: jours(2) }).where(eq(questionnaires.id, r.id));
    expect((await relancerQuestionnaires(db)).envoyees).toBe(0);
    await db.update(questionnaires).set({ envoyeLe: jours(4) }).where(eq(questionnaires.id, r.id));
    expect((await relancerQuestionnaires(db)).envoyees).toBe(1);
    expect((await relancerQuestionnaires(db)).envoyees).toBe(0);
    await db.update(questionnaires).set({ envoyeLe: jours(8) }).where(eq(questionnaires.id, r.id));
    expect((await relancerQuestionnaires(db)).envoyees).toBe(1);
    expect((await relancerQuestionnaires(db)).envoyees).toBe(0);
    const [q] = await db.select().from(questionnaires).where(eq(questionnaires.id, r.id));
    expect(q.relance1Le).not.toBeNull();
    expect(q.relance2Le).not.toBeNull();
  });

  it("toutes les questions du référentiel ont un libellé client", async () => {
    const cs = await loadCriteres(db);
    const qs = questionsPourAudit(cs, new Map(cs.map((c) => [c.id, { statut: null, source: null, aEnvoyerClient: true }])));
    expect(qs).toHaveLength(cs.length);
    expect(qs.every((q) => q.question.length > 10 && q.question.endsWith("?"))).toBe(true);
  });
});
