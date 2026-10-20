import {
  pgTable, text, integer, boolean, timestamp, date, doublePrecision, jsonb, serial, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ───────────────────────── Utilisateurs & sécurité ─────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  nom: text("nom"),
  /** superadmin | csm | lecture */
  role: text("role").notNull().default("csm"),
  actif: boolean("actif").notNull().default(true),
  /** Un CSM peut faire l'import hebdomadaire si le super admin l'y autorise */
  peutImporter: boolean("peut_importer").notNull().default(false),
  invitePar: integer("invite_par"),
  inviteLe: timestamp("invite_le", { withTimezone: true }),
  derniereConnexion: timestamp("derniere_connexion", { withTimezone: true }),
  /** Mot de passe (scrypt, sel aléatoire) ; null = connexion par lien uniquement */
  motDePasseHash: text("mot_de_passe_hash"),
  /** Mot de passe fixé par le super admin : à changer à la première connexion */
  motDePasseTemporaire: boolean("mot_de_passe_temporaire").notNull().default(false),
  motDePasseModifieLe: timestamp("mot_de_passe_modifie_le", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  /** Hash SHA-256 du jeton de session (le jeton brut n'est stocké que dans le cookie) */
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
});

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("login_tokens_email_idx").on(t.email)]);

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entite: text("entite"),
  entiteId: text("entite_id"),
  details: jsonb("details"),
  createdAt: createdAt(),
}, (t) => [index("activity_created_idx").on(t.createdAt)]);

// ───────────────────────── Référentiel clients ─────────────────────────

export const groupes = pgTable("groupes", {
  id: serial("id").primaryKey(),
  nom: text("nom").notNull().unique(),
});

export const clients = pgTable("clients", {
  /** IDagence SpeedResa (ex. S25) — clé unique dans toute l'application */
  id: text("id").primaryKey(),
  nom: text("nom").notNull(),
  modele: text("modele"),
  groupeId: integer("groupe_id").references(() => groupes.id),
  csmId: integer("csm_id").references(() => users.id),
  emailContact: text("email_contact"),
  echeanceContrat: date("echeance_contrat"),
  /** Estimation du volume d'affaires total de l'entreprise (onglet « VA annualisé ») */
  vaGlobalEstime: doublePrecision("va_global_estime"),
  /** false pour les comptes secondaires d'un groupe : l'estimation n'est comptée qu'une fois */
  vaCompteeDansTotaux: boolean("va_comptee_dans_totaux").notNull().default(true),
  siren: text("siren"),
  /** Identifiant de la fiche Google Business Profile (API Places), validé par le CSM ou trouvé par le scan */
  googlePlaceId: text("google_place_id"),
  /** Compte sans dossiers dans l'export (site fourni à part) */
  horsExport: boolean("hors_export").notNull().default(false),
  actif: boolean("actif").notNull().default(true),
  createdAt: createdAt(),
});

export const clientUrls = pgTable("client_urls", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  url: text("url").notNull(),
  principale: boolean("principale").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("client_urls_uniq").on(t.clientId, t.url)]);

/** Identifiants d'agence de l'export rattachés à un client existant */
export const agenceAliases = pgTable("agence_aliases", {
  idAgence: text("id_agence").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  createdAt: createdAt(),
});

// ───────────────────────── Données SpeedResa ─────────────────────────

export const imports = pgTable("imports", {
  id: serial("id").primaryKey(),
  /** dossiers | trafic | va */
  type: text("type").notNull().default("dossiers"),
  fichier: text("fichier").notNull(),
  userId: integer("user_id").references(() => users.id),
  /** brouillon | applique | annule | abandonne */
  statut: text("statut").notNull().default("brouillon"),
  periodeDebut: date("periode_debut"),
  periodeFin: date("periode_fin"),
  stats: jsonb("stats"),
  createdAt: createdAt(),
  appliqueLe: timestamp("applique_le", { withTimezone: true }),
  annuleLe: timestamp("annule_le", { withTimezone: true }),
});

/** Lignes en attente de validation (aperçu de l'import) */
export const importRows = pgTable("import_rows", {
  importId: integer("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
  idResa: text("id_resa").notNull(),
  data: jsonb("data").notNull(),
}, (t) => [primaryKey({ columns: [t.importId, t.idResa] })]);

/** Un dossier de l'export. Aucune donnée nominative de voyageur n'est importée. */
export const dossiers = pgTable("dossiers", {
  idResa: text("id_resa").primaryKey(),
  idAgence: text("id_agence").notNull(),
  producteur: boolean("producteur").notNull().default(false),
  voyage: text("voyage"),
  nomAgence: text("nom_agence"),
  fournisseur: text("fournisseur"),
  date: date("date").notNull(),
  heure: text("heure"),
  pax: integer("pax"),
  statut: text("statut").notNull(),
  origine: text("origine"),
  total: doublePrecision("total").notNull().default(0),
  encaisse: doublePrecision("encaisse").notNull().default(0),
  erreurResalive: boolean("erreur_resalive").notNull().default(false),
  importId: integer("import_id").references(() => imports.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("dossiers_agence_idx").on(t.idAgence), index("dossiers_date_idx").on(t.date)]);

/** État d'un dossier avant un import (null = créé par l'import) — permet l'annulation */
export const dossierChanges = pgTable("dossier_changes", {
  importId: integer("import_id").notNull().references(() => imports.id),
  idResa: text("id_resa").notNull(),
  avant: jsonb("avant"),
}, (t) => [primaryKey({ columns: [t.importId, t.idResa] })]);

export const metriquesClientMensuelles = pgTable("metriques_client_mensuelles", {
  clientId: text("client_id").notNull().references(() => clients.id),
  mois: text("mois").notNull(), // AAAA-MM
  volume: doublePrecision("volume").notNull().default(0),
  confirme: doublePrecision("confirme").notNull().default(0),
  dossiers: integer("dossiers").notNull().default(0),
  visites: integer("visites"),
  /** Google Analytics 4 : débuts de réservation (begin_checkout), achats (purchase) et CA web du mois */
  debutsReservation: integer("debuts_reservation"),
  achatsWeb: integer("achats_web"),
  caWeb: doublePrecision("ca_web"),
  /** Origine des visites : ga4 (prioritaire) ou fichier (onglet « 4. Métriques GTM ») */
  sourceTrafic: text("source_trafic"),
}, (t) => [primaryKey({ columns: [t.clientId, t.mois] })]);

/** Instantané des indicateurs calculés (un par client, recalculé à chaque import) */
export const clientSnapshots = pgTable("client_snapshots", {
  clientId: text("client_id").primaryKey().references(() => clients.id),
  reference: date("reference").notNull(),
  importId: integer("import_id").references(() => imports.id),
  sante: integer("sante").notNull(),
  segment: text("segment").notNull(),
  risque: text("risque").notNull(),
  usage: text("usage").notNull(),
  data: jsonb("data").notNull(),
  calculeLe: timestamp("calcule_le", { withTimezone: true }).defaultNow().notNull(),
});

export const alertes = pgTable("alertes", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  code: text("code").notNull(),
  niveau: text("niveau").notNull(),
  message: text("message").notNull(),
  source: text("source").notNull().default("donnees"), // donnees | audit | scan
  ouverteLe: timestamp("ouverte_le", { withTimezone: true }).defaultNow().notNull(),
  closeLe: timestamp("close_le", { withTimezone: true }),
  importId: integer("import_id").references(() => imports.id),
}, (t) => [index("alertes_client_idx").on(t.clientId)]);

export const parametres = pgTable("parametres", {
  cle: text("cle").primaryKey(),
  valeur: jsonb("valeur").notNull(),
  modifiePar: integer("modifie_par").references(() => users.id),
  modifieLe: timestamp("modifie_le", { withTimezone: true }).defaultNow().notNull(),
});

// ───────────────────────── Audit (étapes 2 à 6) ─────────────────────────

export const criteres = pgTable("criteres", {
  id: text("id").notNull(),
  version: integer("version").notNull().default(1),
  pilier: text("pilier").notNull(),
  critere: text("critere").notNull(),
  commentVerifier: text("comment_verifier"),
  source: text("source").notNull(),
  type: text("type").notNull(),
  sens: text("sens"),
  seuilPlein: doublePrecision("seuil_plein"),
  seuilMoitie: doublePrecision("seuil_moitie"),
  unite: text("unite"),
  points: integer("points").notNull(),
  obligationLegale: boolean("obligation_legale").notNull().default(false),
  offreSiNon: text("offre_si_non"),
  questionClient: text("question_client"),
  ligneGrilleV1: integer("ligne_grille_v1"),
  detectionAuto: text("detection_auto"),
  actif: boolean("actif").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.id, t.version] })]);

export const audits = pgTable("audits", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  date: date("date").notNull(),
  /** brouillon | finalise */
  statut: text("statut").notNull().default("brouillon"),
  auteurId: integer("auteur_id").references(() => users.id),
  assigneA: integer("assigne_a").references(() => users.id),
  urlAuditee: text("url_auditee"),
  note: text("note"),
  /** manuel | import_v1 */
  origine: text("origine").notNull().default("manuel"),
  /** Mention affichée avec l'audit (ex. date d'origine inconnue) */
  mention: text("mention"),
  /** Score calculé à chaque enregistrement (ScoreResult sans le détail) */
  score: jsonb("score"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
  finaliseLe: timestamp("finalise_le", { withTimezone: true }),
});

export const evaluations = pgTable("evaluations", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id").notNull().references(() => audits.id),
  critereId: text("critere_id").notNull(),
  critereVersion: integer("critere_version").notNull().default(1),
  statut: text("statut"), // OUI | PARTIELLEMENT | NON | CORRIGÉ | N.A.
  valeur: text("valeur"),
  source: text("source"), // auto | donnees | csm | client
  preuve: jsonb("preuve"),
  confiance: text("confiance"), // haute | moyenne | basse
  /** Critère confié au client (questionnaire) */
  aEnvoyerClient: boolean("a_envoyer_client").notNull().default(false),
  /** Résultat automatique proposé (scan ou données), en attente de validation par le CSM */
  proposition: jsonb("proposition"),
  commentaire: text("commentaire"),
  auteurId: integer("auteur_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("evaluations_uniq").on(t.auditId, t.critereId)]);

export const scanRuns = pgTable("scan_runs", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  auditId: integer("audit_id").references(() => audits.id),
  url: text("url").notNull(),
  /** en_attente | en_cours | termine | erreur | auth */
  statut: text("statut").notNull().default("en_attente"),
  /** navigateur | http (sans navigateur : certains contrôles deviennent « non vérifiables ») */
  mode: text("mode"),
  /** complet | leger (rescan mensuel) */
  type: text("type").notNull().default("complet"),
  message: text("message"),
  demandePar: integer("demande_par").references(() => users.id),
  debut: timestamp("debut", { withTimezone: true }),
  fin: timestamp("fin", { withTimezone: true }),
  createdAt: createdAt(),
});

export const scanResults = pgTable("scan_results", {
  id: serial("id").primaryKey(),
  scanRunId: integer("scan_run_id").notNull().references(() => scanRuns.id),
  critereId: text("critere_id").notNull(),
  etat: text("etat").notNull(), // en_attente | en_cours | ok | ko | non_verifiable
  statutPropose: text("statut_propose"),
  valeur: text("valeur"),
  preuve: jsonb("preuve"),
  confiance: text("confiance"),
  texte: text("texte"),
  dureeMs: integer("duree_ms"),
});

/**
 * Questionnaire envoyé au client (lien magique, sans compte). Le jeton n'est jamais stocké :
 * il est dérivé de AUTH_SECRET et du nonce (on peut ainsi le renvoyer dans les relances),
 * seule son empreinte sert à le retrouver.
 */
export const questionnaires = pgTable("questionnaires", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id").notNull().references(() => audits.id),
  clientId: text("client_id").references(() => clients.id),
  tokenHash: text("token_hash").notNull().unique(),
  nonce: text("nonce"),
  email: text("email"),
  /** Questions figées à la création : [{ critereId, question, type, unite?, aide? }] */
  questions: jsonb("questions"),
  /** en_attente | repondu | annule */
  statut: text("statut").notNull().default("en_attente"),
  expireLe: timestamp("expire_le", { withTimezone: true }).notNull(),
  envoyeLe: timestamp("envoye_le", { withTimezone: true }),
  relance1Le: timestamp("relance1_le", { withTimezone: true }),
  relance2Le: timestamp("relance2_le", { withTimezone: true }),
  ouvertLe: timestamp("ouvert_le", { withTimezone: true }),
  reponduLe: timestamp("repondu_le", { withTimezone: true }),
  creePar: integer("cree_par").references(() => users.id),
  createdAt: createdAt(),
});

export const reponses = pgTable("reponses", {
  id: serial("id").primaryKey(),
  questionnaireId: integer("questionnaire_id").notNull().references(() => questionnaires.id),
  critereId: text("critere_id").notNull(),
  reponse: text("reponse"),
  commentaire: text("commentaire"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("reponses_uniq").on(t.questionnaireId, t.critereId)]);

export const actions = pgTable("actions", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  auditId: integer("audit_id").references(() => audits.id),
  critereId: text("critere_id"),
  libelle: text("libelle").notNull(),
  offre: text("offre"),
  statut: text("statut").notNull().default("propose"), // propose | accepte | en_cours | fait | abandonne
  impact: doublePrecision("impact"),
  effort: text("effort"),
  /** impact ÷ effort (+ bonus obligation légale) */
  priorite: doublePrecision("priorite"),
  /** Levier de performance en retard auquel l'action répond */
  levier: text("levier"),
  echeance: date("echeance"),
  commentaire: text("commentaire"),
  /** Re-vérification automatique quand l'action passe à « fait » */
  verifScanId: integer("verif_scan_id"),
  verifStatut: text("verif_statut"),
  verifTexte: text("verif_texte"),
  verifLe: timestamp("verif_le", { withTimezone: true }),
  auteurId: integer("auteur_id").references(() => users.id),
  modifiePar: integer("modifie_par").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("actions_client_idx").on(t.clientId)]);

export const rdv = pgTable("rdv", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  date: timestamp("date", { withTimezone: true }),
  objet: text("objet"),
  notes: text("notes"),
  auteurId: integer("auteur_id").references(() => users.id),
  createdAt: createdAt(),
});

/** Chaque enregistrement d'une évaluation (qui, quand, quoi) */
export const evaluationHistorique = pgTable("evaluation_historique", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id").notNull().references(() => audits.id),
  critereId: text("critere_id").notNull(),
  statut: text("statut"),
  valeur: text("valeur"),
  commentaire: text("commentaire"),
  aEnvoyerClient: boolean("a_envoyer_client").notNull().default(false),
  auteurId: integer("auteur_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("eval_hist_audit_idx").on(t.auditId)]);

/** Qui est en train de travailler sur un audit (rafraîchi toutes les quelques secondes) */
export const auditPresence = pgTable("audit_presence", {
  auditId: integer("audit_id").notNull().references(() => audits.id),
  userId: integer("user_id").notNull().references(() => users.id),
  critereId: text("critere_id"),
  vuLe: timestamp("vu_le", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.auditId, t.userId] })]);

/** Captures d'écran des scans (JPEG en base64, quelques dizaines de Ko) */
export const scanCaptures = pgTable("scan_captures", {
  id: serial("id").primaryKey(),
  scanRunId: integer("scan_run_id").notNull().references(() => scanRuns.id),
  nom: text("nom").notNull(),
  mime: text("mime").notNull().default("image/jpeg"),
  data: text("data").notNull(),
  createdAt: createdAt(),
});

/** Monitoring de disponibilité (TECH-04) : une mesure toutes les 15 minutes par site client. */
export const disponibiliteMesures = pgTable("disponibilite_mesures", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  url: text("url").notNull(),
  ok: boolean("ok").notNull(),
  statutHttp: integer("statut_http"),
  dureeMs: integer("duree_ms"),
  erreur: text("erreur"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("dispo_client_at_idx").on(t.clientId, t.at)]);

/** Textes de restitution d'un audit (rédigés par Claude ou par modèle), modifiables avant envoi. */
export const restitutions = pgTable("restitutions", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  auditId: integer("audit_id").notNull().references(() => audits.id),
  /** Interne : pourquoi ce client sous-performe / sur-performe */
  explication: text("explication"),
  plan30: jsonb("plan30"),
  /** Client : synthèse en tête du PDF */
  synthese: text("synthese"),
  emailObjet: text("email_objet"),
  emailCorps: text("email_corps"),
  /** claude | modele | manuel */
  source: text("source"),
  modifiePar: integer("modifie_par").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("restitutions_audit_idx").on(t.auditId)]);

/** Envois au client (restitution, exports), pour l'historique. */
export const envoisClient = pgTable("envois_client", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  auditId: integer("audit_id").references(() => audits.id),
  type: text("type").notNull(),
  destinataires: text("destinataires").notNull(),
  objet: text("objet").notNull(),
  piecesJointes: jsonb("pieces_jointes"),
  auteurId: integer("auteur_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("envois_client_idx").on(t.clientId)]);
