import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { actions, feuillesRoute } from "@/db/schema";
import {
  EQUIPES_DEFAUT, HORIZON, PORTEURS, PRIORITES, SchemaFeuille, SUIVIS, feuilleParRegles, libelleEcheance, nettoyerChantiers, syntheseParRegles, type Chantier,
} from "@/lib/restitution/feuille";
import { analyserIa, iaDisponible } from "@/scan/ia";
import { AuditError } from "./audits";
import { chargerRestitution, type RestitutionAvecAudit } from "./restitution";
import { ecrireParametre, lireParametre } from "./parametres";
import { logActivity } from "./activity";

export type Feuille = typeof feuillesRoute.$inferSelect & { chantiers: Chantier[] };

const CLE_EQUIPES = "equipes_speedmedia";
export async function equipesSpeedmedia(db: DB): Promise<string[]> {
  return (await lireParametre<string[]>(db, CLE_EQUIPES)) ?? EQUIPES_DEFAUT;
}
export async function enregistrerEquipes(db: DB, userId: number, equipes: string[]) {
  const l = [...new Set(equipes.map((e) => e.trim()).filter(Boolean))].slice(0, 12);
  if (!l.length) throw new AuditError("Indiquez au moins une équipe.", 400);
  await ecrireParametre(db, CLE_EQUIPES, l, userId);
}

/** Feuille de l'audit de référence (brouillon ou validée) et dernière feuille validée du client. */
export async function feuillesClient(db: DB, clientId: string, auditId: number | null) {
  const [courante] = auditId ? await db.select().from(feuillesRoute).where(eq(feuillesRoute.auditId, auditId)) : [];
  const [validee] = await db.select().from(feuillesRoute).where(and(eq(feuillesRoute.clientId, clientId), eq(feuillesRoute.statut, "validee"))).orderBy(desc(feuillesRoute.valideeLe)).limit(1);
  return { courante: (courante ?? null) as Feuille | null, validee: (validee ?? null) as Feuille | null };
}

const SchemaIa = z.object({
  synthese: z.string().describe("5 à 8 lignes pour le client : situation, atouts, grands chantiers. Aucune donnée interne."),
  chantiers: z.array(z.object({
    titre: z.string().describe("Titre d'action, ex. « Rendre le catalogue plus attractif »"),
    objectif: z.string(),
    benefice: z.string().describe("Bénéfice concret pour le client"),
    criteres: z.array(z.string()).describe("Identifiants des critères regroupés (ex. PROD-02)"),
    priorite: z.enum(PRIORITES),
    debut: z.number().int().min(0).max(HORIZON - 1).describe("Mois de début, 0 = ce mois-ci"),
    duree: z.number().int().min(1).max(HORIZON).describe("Durée en mois"),
    porteur: z.enum(PORTEURS),
    porteurNom: z.string().nullable().describe("Nom de l'équipe Speedmedia si porteur = equipe, sinon null"),
    offre: z.string().nullable().describe("Offre ou solution Speedmedia associée, reprise de la liste"),
  })).min(1).max(6),
});

/**
 * Propose la feuille de route de l'audit de référence : Claude si la clé est configurée, sinon regroupement par règles.
 * Remplace la feuille en cours (repasse en brouillon si elle était validée).
 */
export async function proposerFeuille(db: DB, clientId: string, userId: number) {
  const r = await chargerRestitution(db, clientId);
  if (!r.audit) throw new AuditError("Aucun audit pour ce client.", 400);
  const ra = r as RestitutionAvecAudit;
  const items = ra.planPropose;
  if (!items.length) throw new AuditError("Aucun critère à NON ou partiel : pas de chantier à proposer.", 400);
  const equipes = await equipesSpeedmedia(db);
  const ctx = { client: ra.client.nom, score: ra.score.score, scoreVise: ra.scoreVise, preAudit: !ra.finalise, forces: ra.forces };
  let chantiers: Chantier[] | null = null, synthese: string | null = null, source = "regles";
  if (iaDisponible()) {
    try {
      const p = await analyserIa({
        outil: "proposer_feuille_de_route",
        schema: SchemaIa,
        maxTokens: 3500,
        systeme: "Tu es consultant Customer Success chez Speedmedia (éditeur du logiciel de réservation SpeedResa pour agences de voyages et autocaristes). Tu écris en français clair, concret et bienveillant, sans jargon, sans superlatifs.",
        consigne: `Construis la feuille de route de « ${ra.client.nom} » à partir des critères à améliorer ci-dessous.
- 3 à 6 chantiers cohérents (ex. « Mettre le site en conformité légale », « Rendre le catalogue plus attractif », « Mesurer ses ventes en ligne », « Développer les ventes additionnelles »). Chaque critère dans un seul chantier au plus ; tous les critères d'obligation légale dans un chantier de conformité, en priorité haute et en premier.
- Ordonne les chantiers dans le temps (priorité calculée, effort, leviers en retard) sur ${HORIZON} mois maximum.
- Porteur : csm (le CSM Speedmedia), equipe (une équipe Speedmedia parmi : ${equipes.join(", ")}), tiers (un prestataire), client (l'agence elle-même).
- Offre : reprends celle de la liste quand elle existe.
- Synthèse : 5 à 8 lignes destinées au client ; aucune donnée interne (pas de chiffre de vente, de score santé ni d'alerte).`,
        documents: [
          { titre: "Audit", texte: `${ctx.preAudit ? "Pré-audit" : "Audit"} du ${ra.audit.date}. Score ${ctx.score === null ? "n/d" : Math.round(ctx.score)}/100, visé ${ctx.scoreVise === null ? "n/d" : Math.round(ctx.scoreVise)}/100. Points forts : ${ctx.forces.join(" ; ") || "—"}.` },
          { titre: "Critères à améliorer", texte: items.map((a) => `${a.critereId} | ${a.libelle} | ${a.pilier} | ${a.statutCritere} | priorité ${Math.round(a.priorite * 10) / 10} | effort ${a.effort} | offre : ${a.offre ?? "—"}${a.obligationLegale ? " | OBLIGATION LÉGALE" : ""}${a.levier ? ` | levier : ${a.levier}` : ""}`).join("\n") },
          { titre: "Leviers en retard (interne, pour prioriser seulement)", texte: ra.causes.map((c) => `${c.levier} — ${c.constat}`).join("\n") || "aucun" },
        ],
      });
      chantiers = nettoyerChantiers(p.chantiers.map((c, i) => ({
        id: `c${i + 1}`, titre: c.titre, objectif: c.objectif, benefice: c.benefice, criteres: c.criteres.map((x) => x.trim().toUpperCase()), priorite: c.priorite,
        debut: c.debut, duree: c.duree, echeance: libelleEcheance(c.debut, c.duree), porteur: { type: c.porteur, nom: c.porteur === "equipe" ? (c.porteurNom && equipes.includes(c.porteurNom) ? c.porteurNom : equipes[0] ?? null) : null },
        offre: c.offre, suivi: "propose" as const,
      })), items);
      synthese = p.synthese.trim();
      source = "claude";
      if (!chantiers.length) chantiers = null;
    } catch { chantiers = null; /* Claude indisponible : règles */ }
  }
  if (!chantiers) { chantiers = nettoyerChantiers(feuilleParRegles(items, equipes), items); source = "regles"; }
  if (!synthese) synthese = syntheseParRegles(ctx, chantiers);
  const vals = { clientId, auditId: ra.audit.id, statut: "brouillon", synthese, chantiers, source, creePar: userId, valideePar: null, valideeLe: null, updatedAt: new Date() };
  await db.insert(feuillesRoute).values(vals).onConflictDoUpdate({ target: feuillesRoute.auditId, set: vals });
  await logActivity(userId, "feuille_proposee", "client", clientId, { source, chantiers: chantiers.length });
  return { source, chantiers: chantiers.length };
}

/** Enregistre les ajustements du CSM (ordre, porteurs, échéances, fusions, critères retirés). */
export async function enregistrerFeuille(db: DB, clientId: string, userId: number, x: z.infer<typeof SchemaFeuille>) {
  const r = await chargerRestitution(db, clientId);
  if (!r.audit) throw new AuditError("Aucun audit pour ce client.", 400);
  const f = SchemaFeuille.parse(x);
  const [cur] = await db.select().from(feuillesRoute).where(eq(feuillesRoute.auditId, r.audit.id));
  if (!cur) throw new AuditError("Proposez d'abord une feuille de route.", 400);
  const chantiers = nettoyerChantiers(f.chantiers, (r as RestitutionAvecAudit).planPropose);
  if (!chantiers.length) throw new AuditError("Il faut au moins un chantier avec un critère.", 400);
  // « Ajustée par le CSM » seulement si quelque chose a changé
  const change = f.synthese.trim() !== (cur.synthese ?? "").trim() || JSON.stringify(chantiers) !== JSON.stringify(cur.chantiers);
  const source = !change || cur.source?.endsWith("+csm") ? cur.source : `${cur.source}+csm`;
  await db.update(feuillesRoute).set({ synthese: f.synthese.trim(), chantiers, source, updatedAt: new Date() }).where(eq(feuillesRoute.id, cur.id));
  return { chantiers: chantiers.length };
}

/**
 * Valide la feuille : elle sert au PDF, à l'email et à la présentation. Chaque critère d'un chantier devient
 * une action du plan (créée si besoin, échéance = fin du chantier) : le suivi des chantiers s'appuie sur ces actions.
 */
export async function validerFeuille(db: DB, clientId: string, userId: number) {
  const r = await chargerRestitution(db, clientId);
  if (!r.audit) throw new AuditError("Aucun audit pour ce client.", 400);
  const ra = r as RestitutionAvecAudit;
  const [cur] = await db.select().from(feuillesRoute).where(eq(feuillesRoute.auditId, ra.audit.id));
  if (!cur) throw new AuditError("Proposez d'abord une feuille de route.", 400);
  const chantiers = cur.chantiers as Chantier[];
  const actives = new Map(ra.actions.filter((a) => a.statut !== "abandonne" && a.critereId).map((a) => [a.critereId!, a]));
  const parId = new Map(ra.planPropose.map((p) => [p.critereId, p]));
  const fin = (c: Chantier) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + c.debut + c.duree, 0); return d.toISOString().slice(0, 10); };
  let creees = 0;
  for (const c of chantiers) {
    for (const id of c.criteres) {
      const a = actives.get(id);
      if (a) { if (!a.echeance) await db.update(actions).set({ echeance: fin(c), updatedAt: new Date() }).where(eq(actions.id, a.id)); continue; }
      const p = parId.get(id);
      if (!p) continue;
      await db.insert(actions).values({ clientId, auditId: ra.audit.id, critereId: id, libelle: p.libelle, offre: p.offre, impact: p.impact, effort: p.effort, priorite: p.priorite, levier: p.levier, echeance: fin(c), auteurId: userId });
      creees++;
    }
  }
  await db.update(feuillesRoute).set({ statut: "validee", valideePar: userId, valideeLe: new Date(), updatedAt: new Date() }).where(eq(feuillesRoute.id, cur.id));
  await logActivity(userId, "feuille_validee", "client", clientId, { chantiers: chantiers.length, actionsCreees: creees });
  return { chantiers: chantiers.length, actionsCreees: creees };
}

/** Suivi d'un chantier (proposé / accepté / en cours / fait) sur la feuille validée. */
export async function majSuiviChantier(db: DB, clientId: string, userId: number, chantierId: string, suivi: (typeof SUIVIS)[number]) {
  if (!SUIVIS.includes(suivi)) throw new AuditError("Suivi inconnu.", 400);
  const { validee } = await feuillesClient(db, clientId, null);
  if (!validee) throw new AuditError("Aucune feuille de route validée.", 400);
  const chantiers = validee.chantiers.map((c) => (c.id === chantierId ? { ...c, suivi } : c));
  if (!chantiers.some((c) => c.id === chantierId)) throw new AuditError("Chantier introuvable.", 404);
  await db.update(feuillesRoute).set({ chantiers, updatedAt: new Date() }).where(eq(feuillesRoute.id, validee.id));
  await logActivity(userId, "chantier_suivi", "client", clientId, { chantierId, suivi });
}

/** Avancement de chaque chantier d'après les actions du plan (faites / total). */
export function avancementChantiers(chantiers: Chantier[], acts: { critereId: string | null; statut: string }[]) {
  return Object.fromEntries(chantiers.map((c) => {
    const l = acts.filter((a) => a.critereId && c.criteres.includes(a.critereId) && a.statut !== "abandonne");
    return [c.id, { faites: l.filter((a) => a.statut === "fait").length, total: l.length }];
  }));
}
