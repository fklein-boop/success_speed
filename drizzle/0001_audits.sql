CREATE TABLE "audit_presence" (
	"audit_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"critere_id" text,
	"vu_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_presence_audit_id_user_id_pk" PRIMARY KEY("audit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "evaluation_historique" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" integer NOT NULL,
	"critere_id" text NOT NULL,
	"statut" text,
	"valeur" text,
	"commentaire" text,
	"a_envoyer_client" boolean DEFAULT false NOT NULL,
	"auteur_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "origine" text DEFAULT 'manuel' NOT NULL;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "mention" text;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "score" jsonb;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "a_envoyer_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "proposition" jsonb;--> statement-breakpoint
ALTER TABLE "audit_presence" ADD CONSTRAINT "audit_presence_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_presence" ADD CONSTRAINT "audit_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_historique" ADD CONSTRAINT "evaluation_historique_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_historique" ADD CONSTRAINT "evaluation_historique_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_hist_audit_idx" ON "evaluation_historique" USING btree ("audit_id");