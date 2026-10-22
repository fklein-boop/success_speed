import { z } from "zod";
import type { ActionProposee } from "./plan";
import { LEVIERS } from "./leviers";

/**
 * Feuille de route client (lot C) : 3 à 6 chantiers qui regroupent les critères à NON ou PARTIELLEMENT,
 * avec objectif, bénéfice, priorité, ordre, échéance, porteur et offre. Module pur (testé sans base).
 * Sans clé Anthropic, `feuilleParRegles` regroupe par pilier et levier ; avec Claude, la proposition est contrôlée
 * par `nettoyerChantiers` (critères existants, chacun une seule fois, obligations légales jamais oubliées).
 */
export const PORTEURS = ["csm", "equipe", "tiers", "client"] as const;
export type TypePorteur = (typeof PORTEURS)[number];
export const LIBELLE_PORTEUR: Record<TypePorteur, string> = { csm: "CSM Speedmedia", equipe: "Équipe Speedmedia", tiers: "Prestataire tiers", client: "Le client" };
export const PRIORITES = ["haute", "moyenne", "basse"] as const;
export const SUIVIS = ["propose", "accepte", "en_cours", "fait"] as const;
export const LIBELLE_SUIVI: Record<(typeof SUIVIS)[number], string> = { propose: "Proposé", accepte: "Accepté", en_cours: "En cours", fait: "Fait" };
export const EQUIPES_DEFAUT = ["Équipe technique", "Équipe M3M (nom à confirmer)"];
/** Horizon de la frise (mois) */
export const HORIZON = 6;

export const SchemaChantier = z.object({
  id: z.string().min(1).max(40),
  titre: z.string().min(1).max(120),
  objectif: z.string().max(400),
  benefice: z.string().max(400),
  criteres: z.array(z.string().max(12)).max(40),
  priorite: z.enum(PRIORITES),
  /** Mois de début (0 = ce mois-ci) et durée en mois, pour la frise */
  debut: z.number().int().min(0).max(HORIZON - 1),
  duree: z.number().int().min(1).max(HORIZON),
  echeance: z.string().max(60),
  porteur: z.object({ type: z.enum(PORTEURS), nom: z.string().max(80).nullable() }),
  offre: z.string().max(120).nullable(),
  suivi: z.enum(SUIVIS),
});
export type Chantier = z.infer<typeof SchemaChantier>;
export const SchemaFeuille = z.object({ synthese: z.string().max(2500), chantiers: z.array(SchemaChantier).min(1).max(8) });

/** Libellé d'échéance : « d'ici 30 jours », « d'ici 3 mois », ou le trimestre (« T1 2027 »). */
export function libelleEcheance(debut: number, duree: number, depuis = new Date()): string {
  const fin = debut + duree;
  if (fin <= 1) return "d'ici 30 jours";
  if (fin <= 3) return `d'ici ${fin} mois`;
  const d = new Date(Date.UTC(depuis.getUTCFullYear(), depuis.getUTCMonth() + fin - 1, 1));
  return `T${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}
/** Mois affichés en tête de frise (« nov. 26 »…) */
export function moisFrise(depuis = new Date()): string[] {
  return Array.from({ length: HORIZON }, (_, i) => new Date(Date.UTC(depuis.getUTCFullYear(), depuis.getUTCMonth() + i, 1))
    .toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }));
}

// ───────── Regroupement par règles ─────────

interface Theme { titre: string; objectif: string; benefice: string; porteur: TypePorteur }
const THEME_LEGAL: Theme = { titre: "Mettre le site en conformité légale", objectif: "Corriger les points légaux relevés par l'audit (mentions, CGV, cookies, prix, accessibilité…).", benefice: "Éviter les sanctions et rassurer les voyageurs au moment de réserver.", porteur: "client" };
const THEME_UPSELL: Theme = { titre: "Développer les ventes additionnelles", objectif: "Proposer options, suppléments et assurances sur les produits et dans le tunnel.", benefice: "Un panier moyen plus élevé sans trafic supplémentaire.", porteur: "csm" };
const THEMES: Record<string, Theme> = {
  "Visibilité & présence en ligne": { titre: "Gagner en visibilité en ligne", objectif: "Soigner la fiche Google, les avis et les relais du site.", benefice: "Plus de visites qualifiées et une meilleure image locale.", porteur: "client" },
  "Digitalisation de la production": { titre: "Rendre le catalogue plus attractif", objectif: "Mettre en ligne la production, compléter tarifs, photos et textes, tenir le catalogue à jour.", benefice: "Des fiches qui donnent envie de réserver en ligne.", porteur: "client" },
  "Performance web & conversion": { titre: "Transformer plus de visites en réservations", objectif: "Lever les freins du site et du tunnel : vitesse, paiement, disponibilités, relances.", benefice: "Plus de réservations à trafic égal.", porteur: "csm" },
  "Tracking & data": { titre: "Mesurer ses ventes en ligne", objectif: "Fiabiliser Google Analytics, les événements d'achat et les pixels publicitaires.", benefice: "Savoir ce qui rapporte et piloter ses investissements.", porteur: "equipe" },
  "Conformité légale": THEME_LEGAL,
  "Technique & sécurité": { titre: "Fiabiliser le site", objectif: "Sécuriser le domaine, les emails et la disponibilité du site.", benefice: "Un site toujours en ligne et des emails qui arrivent.", porteur: "equipe" },
  "Puissance du réseau": { titre: "Profiter du réseau SpeedResa", objectif: "Partager et ouvrir des produits sur le réseau S01, utiliser RésaLive.", benefice: "Plus d'offre à vendre et de nouveaux débouchés.", porteur: "csm" },
  "Socle Speedmedia": { titre: "Tirer parti de tout SpeedResa", objectif: "Activer et utiliser les modules du back-office (paiement, connecteurs, statuts).", benefice: "Moins de ressaisie et un outil qui travaille pour l'agence.", porteur: "csm" },
  "Distribution & marketplaces": { titre: "Vendre sur de nouveaux canaux", objectif: "Ouvrir et soigner la distribution sur les marketplaces (Veepee…).", benefice: "Du chiffre d'affaires additionnel.", porteur: "csm" },
  "Innovation": { titre: "Innover pour se démarquer", objectif: "Assistant conversationnel, avis vérifiés, personnalisation, information RSE.", benefice: "Une expérience moderne qui fidélise.", porteur: "client" },
  "Relation client": { titre: "Animer la relation", objectif: "Rendez-vous de suivi et interlocuteur digital identifié.", benefice: "Un accompagnement régulier.", porteur: "csm" },
};
const UPSELL = new Set((LEVIERS.find((l) => l.code === "panier_moyen")?.criteres as string[] | undefined) ?? []);

/** Regroupe les actions proposées (déjà priorisées) en 3 à 6 chantiers, sans appel à Claude. */
export function feuilleParRegles(actions: ActionProposee[], equipes: string[] = EQUIPES_DEFAUT, depuis = new Date()): Chantier[] {
  const groupes = new Map<string, { theme: Theme; actions: ActionProposee[] }>();
  for (const a of actions) {
    const theme = a.obligationLegale || a.pilier === "Conformité légale" ? THEME_LEGAL : UPSELL.has(a.critereId) ? THEME_UPSELL : THEMES[a.pilier] ?? { titre: a.pilier, objectif: "", benefice: "", porteur: "csm" as TypePorteur };
    const g = groupes.get(theme.titre) ?? { theme, actions: [] };
    g.actions.push(a);
    groupes.set(theme.titre, g);
  }
  const poids = (g: { actions: ActionProposee[] }) => g.actions.reduce((s, a) => s + a.priorite, 0) + (g.actions.some((a) => a.obligationLegale) ? 1000 : 0);
  const tries = [...groupes.values()].sort((x, y) => poids(y) - poids(x)).slice(0, 6);
  return tries.map((g, i) => {
    const priorite = g.actions.some((a) => a.obligationLegale) || i < 2 ? "haute" : i < 4 ? "moyenne" : "basse";
    const [debut, duree] = priorite === "haute" ? [0, i === 0 ? 1 : 2] : priorite === "moyenne" ? [1, 2] : [3, 3];
    const offres = [...new Set(g.actions.map((a) => a.offre).filter((o): o is string => !!o))];
    return {
      id: `c${i + 1}`, titre: g.theme.titre, objectif: g.theme.objectif, benefice: g.theme.benefice,
      criteres: g.actions.map((a) => a.critereId), priorite, debut, duree, echeance: libelleEcheance(debut, duree, depuis),
      porteur: { type: g.theme.porteur, nom: g.theme.porteur === "equipe" ? equipes[0] ?? null : null },
      offre: offres.slice(0, 2).join(" + ") || null, suivi: "propose" as const,
    };
  });
}

/**
 * Contrôle une proposition (Claude ou CSM) : critères connus et à traiter, chacun dans un seul chantier,
 * chantiers vides retirés, obligations légales non oubliées (ajoutées au chantier légal), dates dans la frise.
 */
export function nettoyerChantiers(chantiers: Chantier[], actions: ActionProposee[], depuis = new Date()): Chantier[] {
  const connus = new Set(actions.map((a) => a.critereId));
  const vus = new Set<string>();
  const out = chantiers.map((c, i) => {
    const criteres = c.criteres.filter((id) => { if (!connus.has(id) || vus.has(id)) return false; vus.add(id); return true; });
    const debut = Math.min(Math.max(0, c.debut), HORIZON - 1);
    const duree = Math.min(Math.max(1, c.duree), HORIZON - debut);
    return { ...c, id: c.id || `c${i + 1}`, criteres, debut, duree, echeance: c.echeance || libelleEcheance(debut, duree, depuis) };
  }).filter((c) => c.criteres.length);
  const legauxOublies = actions.filter((a) => a.obligationLegale && !vus.has(a.critereId)).map((a) => a.critereId);
  if (legauxOublies.length) {
    const legal = out.find((c) => /l[ée]gal|conformit/i.test(c.titre));
    if (legal) legal.criteres.push(...legauxOublies);
    else out.unshift({ id: "legal", ...THEME_LEGAL, porteur: { type: "client", nom: null }, criteres: legauxOublies, priorite: "haute", debut: 0, duree: 1, echeance: libelleEcheance(0, 1, depuis), offre: null, suivi: "propose" });
  }
  return out;
}

/** Synthèse par modèle (sans Claude) : situation et grands chantiers, en 5 à 8 lignes. */
export function syntheseParRegles(x: { client: string; score: number | null; scoreVise: number | null; preAudit: boolean; forces: string[] }, chantiers: Chantier[]): string {
  const s = x.score === null ? "" : ` Votre score de maturité numérique est de ${Math.round(x.score)}/100.`;
  // Première lettre en minuscule seulement (garde les sigles : CRM, ERP, HTTPS…)
  const min = (t: string) => (/^[A-Z]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
  const forces = x.forces.length ? ` Vos atouts : ${x.forces.slice(0, 3).map(min).join(", ")}.` : "";
  const ch = chantiers.slice(0, 4).map((c) => min(c.titre));
  const vise = x.scoreVise !== null && x.score !== null && x.scoreVise > x.score ? ` En menant cette feuille de route, votre score pourrait atteindre ${Math.round(x.scoreVise)}/100.` : "";
  return `${x.preAudit ? "Ce pré-audit" : "Cet audit"} fait le point sur la présence numérique de ${x.client}.${s}${forces} Nous vous proposons ${chantiers.length} chantier${chantiers.length > 1 ? "s" : ""}, à mener dans l'ordre : ${ch.join(", ")}${chantiers.length > 4 ? ", etc" : ""}.${vise} Votre CSM vous accompagne à chaque étape.`;
}

/** Version client d'une feuille validée (PDF, email, présentation) : libellés seulement, aucune donnée interne. */
export function feuilleClient(f: { synthese: string | null; valideeLe: Date | null; chantiers: unknown } | null, libelles: Map<string, string>) {
  if (!f) return null;
  return {
    synthese: f.synthese ?? "",
    valideeLe: f.valideeLe?.toISOString() ?? null,
    chantiers: (f.chantiers as Chantier[]).map((c) => ({
      titre: c.titre, objectif: c.objectif, benefice: c.benefice, priorite: c.priorite, debut: c.debut, duree: c.duree, echeance: c.echeance,
      porteur: c.porteur.type === "equipe" ? c.porteur.nom ?? LIBELLE_PORTEUR.equipe : LIBELLE_PORTEUR[c.porteur.type], offre: c.offre,
      criteres: c.criteres.map((id) => (libelles.get(id) ?? id).split(/[:(]/)[0].trim()), suivi: c.suivi,
    })),
  };
}
export type FeuilleClient = NonNullable<ReturnType<typeof feuilleClient>>;

