CREATE TABLE "scan_captures" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"nom" text NOT NULL,
	"mime" text DEFAULT 'image/jpeg' NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scan_results" ADD COLUMN "texte" text;--> statement-breakpoint
ALTER TABLE "scan_results" ADD COLUMN "duree_ms" integer;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD COLUMN "audit_id" integer;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD COLUMN "type" text DEFAULT 'complet' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "scan_captures" ADD CONSTRAINT "scan_captures_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;