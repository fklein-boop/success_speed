CREATE TABLE "actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"audit_id" integer,
	"critere_id" text,
	"libelle" text NOT NULL,
	"offre" text,
	"statut" text DEFAULT 'propose' NOT NULL,
	"impact" double precision,
	"effort" text,
	"auteur_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entite" text,
	"entite_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agence_aliases" (
	"id_agence" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alertes" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"code" text NOT NULL,
	"niveau" text NOT NULL,
	"message" text NOT NULL,
	"source" text DEFAULT 'donnees' NOT NULL,
	"ouverte_le" timestamp with time zone DEFAULT now() NOT NULL,
	"close_le" timestamp with time zone,
	"import_id" integer
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"date" date NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"auteur_id" integer,
	"assigne_a" integer,
	"url_auditee" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalise_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_snapshots" (
	"client_id" text PRIMARY KEY NOT NULL,
	"reference" date NOT NULL,
	"import_id" integer,
	"sante" integer NOT NULL,
	"segment" text NOT NULL,
	"risque" text NOT NULL,
	"usage" text NOT NULL,
	"data" jsonb NOT NULL,
	"calcule_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_urls" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"url" text NOT NULL,
	"principale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"modele" text,
	"groupe_id" integer,
	"csm_id" integer,
	"email_contact" text,
	"echeance_contrat" date,
	"va_global_estime" double precision,
	"va_comptee_dans_totaux" boolean DEFAULT true NOT NULL,
	"siren" text,
	"hors_export" boolean DEFAULT false NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criteres" (
	"id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pilier" text NOT NULL,
	"critere" text NOT NULL,
	"comment_verifier" text,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"sens" text,
	"seuil_plein" double precision,
	"seuil_moitie" double precision,
	"unite" text,
	"points" integer NOT NULL,
	"obligation_legale" boolean DEFAULT false NOT NULL,
	"offre_si_non" text,
	"question_client" text,
	"ligne_grille_v1" integer,
	"detection_auto" text,
	"actif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criteres_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "dossier_changes" (
	"import_id" integer NOT NULL,
	"id_resa" text NOT NULL,
	"avant" jsonb,
	CONSTRAINT "dossier_changes_import_id_id_resa_pk" PRIMARY KEY("import_id","id_resa")
);
--> statement-breakpoint
CREATE TABLE "dossiers" (
	"id_resa" text PRIMARY KEY NOT NULL,
	"id_agence" text NOT NULL,
	"producteur" boolean DEFAULT false NOT NULL,
	"voyage" text,
	"nom_agence" text,
	"fournisseur" text,
	"date" date NOT NULL,
	"heure" text,
	"pax" integer,
	"statut" text NOT NULL,
	"origine" text,
	"total" double precision DEFAULT 0 NOT NULL,
	"encaisse" double precision DEFAULT 0 NOT NULL,
	"erreur_resalive" boolean DEFAULT false NOT NULL,
	"import_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" integer NOT NULL,
	"critere_id" text NOT NULL,
	"critere_version" integer DEFAULT 1 NOT NULL,
	"statut" text,
	"valeur" text,
	"source" text,
	"preuve" jsonb,
	"confiance" text,
	"commentaire" text,
	"auteur_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groupes" (
	"id" serial PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	CONSTRAINT "groupes_nom_unique" UNIQUE("nom")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"import_id" integer NOT NULL,
	"id_resa" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "import_rows_import_id_id_resa_pk" PRIMARY KEY("import_id","id_resa")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'dossiers' NOT NULL,
	"fichier" text NOT NULL,
	"user_id" integer,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"periode_debut" date,
	"periode_fin" date,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applique_le" timestamp with time zone,
	"annule_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metriques_client_mensuelles" (
	"client_id" text NOT NULL,
	"mois" text NOT NULL,
	"volume" double precision DEFAULT 0 NOT NULL,
	"confirme" double precision DEFAULT 0 NOT NULL,
	"dossiers" integer DEFAULT 0 NOT NULL,
	"visites" integer,
	CONSTRAINT "metriques_client_mensuelles_client_id_mois_pk" PRIMARY KEY("client_id","mois")
);
--> statement-breakpoint
CREATE TABLE "parametres" (
	"cle" text PRIMARY KEY NOT NULL,
	"valeur" jsonb NOT NULL,
	"modifie_par" integer,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaires" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"expire_le" timestamp with time zone NOT NULL,
	"envoye_le" timestamp with time zone,
	"repondu_le" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questionnaires_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rdv" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"date" timestamp with time zone,
	"objet" text,
	"auteur_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reponses" (
	"id" serial PRIMARY KEY NOT NULL,
	"questionnaire_id" integer NOT NULL,
	"critere_id" text NOT NULL,
	"reponse" text,
	"commentaire" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"critere_id" text NOT NULL,
	"etat" text NOT NULL,
	"statut_propose" text,
	"valeur" text,
	"preuve" jsonb,
	"confiance" text
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"url" text NOT NULL,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"demande_par" integer,
	"debut" timestamp with time zone,
	"fin" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nom" text,
	"role" text DEFAULT 'csm' NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"peut_importer" boolean DEFAULT false NOT NULL,
	"invite_par" integer,
	"invite_le" timestamp with time zone,
	"derniere_connexion" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agence_aliases" ADD CONSTRAINT "agence_aliases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertes" ADD CONSTRAINT "alertes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertes" ADD CONSTRAINT "alertes_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_assigne_a_users_id_fk" FOREIGN KEY ("assigne_a") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_snapshots" ADD CONSTRAINT "client_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_snapshots" ADD CONSTRAINT "client_snapshots_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_urls" ADD CONSTRAINT "client_urls_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_groupe_id_groupes_id_fk" FOREIGN KEY ("groupe_id") REFERENCES "public"."groupes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_csm_id_users_id_fk" FOREIGN KEY ("csm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_changes" ADD CONSTRAINT "dossier_changes_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metriques_client_mensuelles" ADD CONSTRAINT "metriques_client_mensuelles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parametres" ADD CONSTRAINT "parametres_modifie_par_users_id_fk" FOREIGN KEY ("modifie_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv" ADD CONSTRAINT "rdv_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv" ADD CONSTRAINT "rdv_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reponses" ADD CONSTRAINT "reponses_questionnaire_id_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."questionnaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_demande_par_users_id_fk" FOREIGN KEY ("demande_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alertes_client_idx" ON "alertes" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_urls_uniq" ON "client_urls" USING btree ("client_id","url");--> statement-breakpoint
CREATE INDEX "dossiers_agence_idx" ON "dossiers" USING btree ("id_agence");--> statement-breakpoint
CREATE INDEX "dossiers_date_idx" ON "dossiers" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_uniq" ON "evaluations" USING btree ("audit_id","critere_id");--> statement-breakpoint
CREATE INDEX "login_tokens_email_idx" ON "login_tokens" USING btree ("email");