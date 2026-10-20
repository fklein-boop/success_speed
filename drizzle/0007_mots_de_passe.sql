ALTER TABLE "users" ADD COLUMN "mot_de_passe_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mot_de_passe_temporaire" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mot_de_passe_modifie_le" timestamp with time zone;