CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"community_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"data" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."billing_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"paid_at" date NOT NULL,
	"method" text,
	"invoice_no" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."bind_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text,
	"timezone" text DEFAULT 'Asia/Taipei' NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"paid_until" date,
	"line_mode" text DEFAULT 'shared' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."files" (
	"key" text PRIMARY KEY NOT NULL,
	"community_id" uuid,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."line_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid,
	"name" text NOT NULL,
	"channel_id" text,
	"basic_id" text,
	"display_name" text,
	"secret_enc" text NOT NULL,
	"token_enc" text NOT NULL,
	"webhook_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"rich_menu_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_channels_webhook_key_unique" UNIQUE("webhook_key")
);
--> statement-breakpoint
CREATE TABLE "app"."login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"community_id" uuid,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"unit_id" uuid,
	"resident_id" uuid,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"parcel_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"batch_id" uuid,
	"carrier" text,
	"tracking_no" text,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"storage_location" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text,
	"photo_key" text,
	"pickup_code" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"notify_status" text DEFAULT 'pending' NOT NULL,
	"notified_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"picked_up_by" uuid,
	"pickup_method" text,
	"pickup_resident_id" uuid,
	"pickup_name" text,
	"signature_key" text,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"last_reminded_at" timestamp with time zone,
	"closed_note" text,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"max_units" integer NOT NULL,
	"max_staff" integer NOT NULL,
	"monthly_price" integer DEFAULT 0 NOT NULL,
	"features" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app"."proxy_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"resident_id" uuid,
	"code" text NOT NULL,
	"proxy_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."residents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"line_user_id" text,
	"line_channel_id" uuid,
	"line_following" boolean DEFAULT true NOT NULL,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notify_line" boolean DEFAULT true NOT NULL,
	"notify_email" boolean DEFAULT false NOT NULL,
	"language" text DEFAULT 'zh-TW' NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"building_id" uuid,
	"floor" integer,
	"number" text NOT NULL,
	"label" text NOT NULL,
	"search_key" text NOT NULL,
	"sort_key" text NOT NULL,
	"bind_code" text NOT NULL,
	"bind_code_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_bind_code_unique" UNIQUE("bind_code")
);
--> statement-breakpoint
CREATE TABLE "app"."usage_counters" (
	"community_id" uuid NOT NULL,
	"month" text NOT NULL,
	"line_push" integer DEFAULT 0 NOT NULL,
	"email" integer DEFAULT 0 NOT NULL,
	"sms" integer DEFAULT 0 NOT NULL,
	"parcels" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_community_id_month_pk" PRIMARY KEY("community_id","month")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "app"."audit_logs" ADD CONSTRAINT "audit_logs_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_tokens" ADD CONSTRAINT "auth_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_records" ADD CONSTRAINT "billing_records_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_records" ADD CONSTRAINT "billing_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."buildings" ADD CONSTRAINT "buildings_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."communities" ADD CONSTRAINT "communities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."communities" ADD CONSTRAINT "communities_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "app"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."files" ADD CONSTRAINT "files_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."line_channels" ADD CONSTRAINT "line_channels_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "app"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "app"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "app"."residents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcels" ADD CONSTRAINT "parcels_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcels" ADD CONSTRAINT "parcels_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "app"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcels" ADD CONSTRAINT "parcels_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcels" ADD CONSTRAINT "parcels_picked_up_by_users_id_fk" FOREIGN KEY ("picked_up_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcels" ADD CONSTRAINT "parcels_pickup_resident_id_residents_id_fk" FOREIGN KEY ("pickup_resident_id") REFERENCES "app"."residents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."proxy_codes" ADD CONSTRAINT "proxy_codes_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."proxy_codes" ADD CONSTRAINT "proxy_codes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "app"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."proxy_codes" ADD CONSTRAINT "proxy_codes_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "app"."residents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."proxy_codes" ADD CONSTRAINT "proxy_codes_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."residents" ADD CONSTRAINT "residents_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."residents" ADD CONSTRAINT "residents_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "app"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."residents" ADD CONSTRAINT "residents_line_channel_id_line_channels_id_fk" FOREIGN KEY ("line_channel_id") REFERENCES "app"."line_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."units" ADD CONSTRAINT "units_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."units" ADD CONSTRAINT "units_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "app"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."usage_counters" ADD CONSTRAINT "usage_counters_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "app"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_community_idx" ON "app"."audit_logs" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "app"."audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_email_idx" ON "app"."auth_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "billing_community_idx" ON "app"."billing_records" USING btree ("community_id","period_end");--> statement-breakpoint
CREATE INDEX "bind_attempts_key_idx" ON "app"."bind_attempts" USING btree ("key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_unique" ON "app"."buildings" USING btree ("community_id","name");--> statement-breakpoint
CREATE INDEX "communities_org_idx" ON "app"."communities" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "login_attempts_key_idx" ON "app"."login_attempts" USING btree ("key","created_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "app"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_community_idx" ON "app"."memberships" USING btree ("community_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_unique" ON "app"."memberships" USING btree ("user_id","org_id","community_id");--> statement-breakpoint
CREATE INDEX "notifications_community_idx" ON "app"."notifications" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE INDEX "parcels_status_idx" ON "app"."parcels" USING btree ("community_id","status","received_at");--> statement-breakpoint
CREATE INDEX "parcels_unit_idx" ON "app"."parcels" USING btree ("unit_id","status");--> statement-breakpoint
CREATE INDEX "parcels_tracking_idx" ON "app"."parcels" USING btree ("community_id","tracking_no");--> statement-breakpoint
CREATE INDEX "parcels_received_idx" ON "app"."parcels" USING btree ("community_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "parcels_pickup_code_unique" ON "app"."parcels" USING btree ("community_id","pickup_code") WHERE status = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_codes_code_unique" ON "app"."proxy_codes" USING btree ("community_id","code");--> statement-breakpoint
CREATE INDEX "residents_unit_idx" ON "app"."residents" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "residents_line_idx" ON "app"."residents" USING btree ("line_channel_id","line_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "residents_unit_line_unique" ON "app"."residents" USING btree ("unit_id","line_channel_id","line_user_id") WHERE status = 'active' and line_user_id is not null;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "app"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_label_unique" ON "app"."units" USING btree ("community_id","label");--> statement-breakpoint
CREATE INDEX "units_sort_idx" ON "app"."units" USING btree ("community_id","sort_key");--> statement-breakpoint
CREATE INDEX "units_search_idx" ON "app"."units" USING btree ("community_id","search_key");