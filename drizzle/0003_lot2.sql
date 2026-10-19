CREATE TABLE "disponibilite_mesures" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"url" text NOT NULL,
	"ok" boolean NOT NULL,
	"statut_http" integer,
	"duree_ms" integer,
	"erreur" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_place_id" text;--> statement-breakpoint
ALTER TABLE "disponibilite_mesures" ADD CONSTRAINT "disponibilite_mesures_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispo_client_at_idx" ON "disponibilite_mesures" USING btree ("client_id","at");