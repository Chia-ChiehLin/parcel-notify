CREATE TABLE "app"."resident_email_challenges" (
	"resident_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."residents" ADD COLUMN "email_fallback_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."residents" ADD COLUMN "verified_email" text;--> statement-breakpoint
ALTER TABLE "app"."residents" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."resident_email_challenges" ADD CONSTRAINT "resident_email_challenges_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "app"."residents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Old messages may have delivered bearer links before mailbox ownership was checked.
UPDATE "app"."residents" SET "token_version" = "token_version" + 1
WHERE "email" IS NOT NULL AND "status" = 'active';
