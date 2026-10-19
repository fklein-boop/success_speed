/**
 * Moteur de pré-audit — indépendant de l'interface (utilisé par l'app interne, le worker
 * et, plus tard, l'auto-audit public). Un détecteur par critère, déclaré dans registry.ts.
 */
import type { Statut } from "@/lib/audit/score";
import type { ScanContext } from "./context";

export type Confiance = "haute" | "moyenne" | "basse";
export type Etat = "en_attente" | "en_cours" | "ok" | "ko" | "non_verifiable";

export interface Preuve {
  texte: string;
  url?: string;
  extrait?: string;
  /** Nom d'une capture d'écran enregistrée avec le scan (« accueil-mobile »…) */
  capture?: string;
  requete?: string;
  source?: string;
}

export interface Resultat {
  statut: Statut | null; // null = non vérifiable
  valeur?: number | null;
  texte: string;
  confiance: Confiance;
  preuve: Preuve;
}

export interface Detecteur {
  critereId: string;
  libelle: string;
  /** true si le contrôle est plus fiable avec un navigateur (sinon : mode dégradé) */
  navigateur?: boolean;
  run(ctx: ScanContext): Promise<Resultat>;
}

export const etatDe = (r: Resultat): Etat => (r.statut === null ? "non_verifiable" : r.statut === "OUI" || r.statut === "N.A." ? "ok" : "ko");

export const nonVerifiable = (texte: string, preuve: Partial<Preuve> = {}): Resultat => ({
  statut: null, texte, confiance: "basse", preuve: { texte, ...preuve },
});

/**
 * Données fournies par l'application (base) au moteur de scan, qui reste indépendant de la base.
 * Tout est facultatif : sans ces données, les critères concernés passent en « non vérifiable ».
 */
export interface ScanDonnees {
  client?: { nom: string; placeId?: string | null };
  /** Produits les plus vendus sur 12 mois (colonne « Voyage » de l'extract SpeedResa) */
  topVentes?: { voyage: string; nb: number }[];
  /** Historique du monitoring de disponibilité (TECH-04) */
  disponibilite?: { mesures: number; ok: number; premiere: Date | null; derniereErreur: string | null } | null;
  /** Empreintes TECH-06 modifiées dans l'administration (à défaut : config/empreintes.json) */
  empreintes?: { a_valider: boolean; speedresa: { nom: string; motif: string; force?: string }[]; concurrents: { nom: string; motif: string; force?: string }[] };
  /** Appelé quand la fiche Google du client est identifiée de façon sûre (site web identique) */
  onPlaceTrouvee?: (placeId: string) => Promise<void>;
}

export class SiteProtegeError extends Error {
  constructor(public url: string) { super("Site derrière authentification"); }
}
