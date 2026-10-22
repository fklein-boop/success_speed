CREATE TABLE "catalogue_produits" (
	"id_agence" text NOT NULL,
	"id_produit" text NOT NULL,
	"titre" text,
	"type" text,
	"source" text,
	"en_ligne" boolean,
	"partage_s01" boolean,
	"date_maj" date,
	"departs_futurs" integer,
	"stock_gere" boolean,
	"prix_adulte" boolean,
	"prix_enfant" boolean,
	"nb_supplements" integer,
	"nb_options" integer,
	"assurance" boolean,
	"nb_photos" integer,
	"veepee" boolean,
	"import_id" integer,
	CONSTRAINT "catalogue_produits_id_agence_id_produit_pk" PRIMARY KEY("id_agence","id_produit")
);
--> statement-breakpoint
CREATE TABLE "config_comptes" (
	"id_agence" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"import_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connexions_bo" (
	"id_agence" text NOT NULL,
	"date" date NOT NULL,
	"nb_connexions" integer DEFAULT 0 NOT NULL,
	"nb_utilisateurs" integer,
	CONSTRAINT "connexions_bo_id_agence_date_pk" PRIMARY KEY("id_agence","date")
);
--> statement-breakpoint
CREATE TABLE "transactions_paybox" (
	"reference" text PRIMARY KEY NOT NULL,
	"id_agence" text NOT NULL,
	"date" date NOT NULL,
	"id_resa" text,
	"montant" double precision,
	"statut" text,
	"trois_ds" boolean,
	"import_id" integer
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_statut" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_statut_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "id_produit" text;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "canal" text;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "montant_options" double precision;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "montant_assurance" double precision;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "date_confirmation" date;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "email_renseigne" boolean;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "paye_en_ligne" double precision;--> statement-breakpoint
ALTER TABLE "catalogue_produits" ADD CONSTRAINT "catalogue_produits_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_comptes" ADD CONSTRAINT "config_comptes_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_paybox" ADD CONSTRAINT "transactions_paybox_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paybox_agence_idx" ON "transactions_paybox" USING btree ("id_agence");