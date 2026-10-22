CREATE TABLE "feuilles_route" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"audit_id" integer NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"synthese" text,
	"chantiers" jsonb NOT NULL,
	"source" text,
	"cree_par" integer,
	"validee_par" integer,
	"validee_le" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feuilles_route" ADD CONSTRAINT "feuilles_route_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feuilles_route" ADD CONSTRAINT "feuilles_route_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feuilles_route" ADD CONSTRAINT "feuilles_route_cree_par_users_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feuilles_route" ADD CONSTRAINT "feuilles_route_validee_par_users_id_fk" FOREIGN KEY ("validee_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feuilles_route_audit_idx" ON "feuilles_route" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "feuilles_route_client_idx" ON "feuilles_route" USING btree ("client_id");