CREATE TYPE "public"."reminder_channel" AS ENUM('email', 'sms');--> statement-breakpoint
ALTER TYPE "public"."email_trigger" ADD VALUE 'system';--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"channel" "reminder_channel" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"to_address" text,
	"locale" text NOT NULL,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_entry_channel_starts_at_unique" UNIQUE("entry_id","channel","starts_at")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "entries" SET "scheduled_at" = "created_at";--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_created_at_idx" ON "reminders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_log_to_address_lower_idx" ON "email_log" USING btree (lower("to_address"));