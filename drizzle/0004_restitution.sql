CREATE TABLE "envois_client" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"audit_id" integer,
	"type" text NOT NULL,
	"destinataires" text NOT NULL,
	"objet" text NOT NULL,
	"pieces_jointes" jsonb,
	"auteur_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restitutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"audit_id" integer NOT NULL,
	"explication" text,
	"plan30" jsonb,
	"synthese" text,
	"email_objet" text,
	"email_corps" text,
	"source" text,
	"modifie_par" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "priorite" double precision;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "levier" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "echeance" date;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "commentaire" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "verif_scan_id" integer;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "verif_statut" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "verif_texte" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "verif_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "modifie_par" integer;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rdv" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "envois_client" ADD CONSTRAINT "envois_client_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois_client" ADD CONSTRAINT "envois_client_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois_client" ADD CONSTRAINT "envois_client_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restitutions" ADD CONSTRAINT "restitutions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restitutions" ADD CONSTRAINT "restitutions_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restitutions" ADD CONSTRAINT "restitutions_modifie_par_users_id_fk" FOREIGN KEY ("modifie_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "envois_client_idx" ON "envois_client" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restitutions_audit_idx" ON "restitutions" USING btree ("audit_id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_modifie_par_users_id_fk" FOREIGN KEY ("modifie_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_client_idx" ON "actions" USING btree ("client_id");