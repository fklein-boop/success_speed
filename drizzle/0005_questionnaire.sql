ALTER TABLE "questionnaires" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "nonce" text;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "questions" jsonb;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "statut" text DEFAULT 'en_attente' NOT NULL;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "relance1_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "relance2_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "ouvert_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD COLUMN "cree_par" integer;--> statement-breakpoint
ALTER TABLE "reponses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_cree_par_users_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reponses_uniq" ON "reponses" USING btree ("questionnaire_id","critere_id");