CREATE TYPE "public"."appt_status" AS ENUM('booked', 'arrived', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."block_reason" AS ENUM('surgery', 'meeting', 'personal', 'leave', 'other');--> statement-breakpoint
CREATE TYPE "public"."callback_status" AS ENUM('new', 'contacted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('patient', 'staff');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('sent', 'logged', 'suppressed', 'capped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_trigger" AS ENUM('patient', 'staff');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('appointment', 'hold', 'block');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('online', 'staff');--> statement-breakpoint
CREATE TABLE "callback_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"locale" text NOT NULL,
	"treatment_id" integer,
	"message" text,
	"status" "callback_status" DEFAULT 'new' NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_hours" (
	"weekday" integer PRIMARY KEY NOT NULL,
	"open" text,
	"close" text
);
--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"lunch_start" text NOT NULL,
	"lunch_end" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closed_dates" (
	"date" date PRIMARY KEY NOT NULL,
	"label_en" text NOT NULL,
	"label_tr" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dentist_treatments" (
	"dentist_id" integer NOT NULL,
	"treatment_id" integer NOT NULL,
	CONSTRAINT "dentist_treatments_dentist_id_treatment_id_pk" PRIMARY KEY("dentist_id","treatment_id")
);
--> statement-breakpoint
CREATE TABLE "dentists" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"title_en" text NOT NULL,
	"title_tr" text NOT NULL,
	"bio_en" text NOT NULL,
	"bio_tr" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "dentists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"to_address" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text NOT NULL,
	"status" "email_status" NOT NULL,
	"trigger" "email_trigger" NOT NULL,
	"ip_hash" text,
	"appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dentist_id" integer NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"during" "tstzrange" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"hold_token_hash" text,
	"treatment_id" integer,
	"patient_id" uuid,
	"status" "appt_status",
	"source" "entry_source",
	"cancelled_by" "cancelled_by",
	"manage_token_hash" text,
	"block_reason" "block_reason",
	"block_note" text,
	"series_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_manage_token_hash_unique" UNIQUE("manage_token_hash")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "rate_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_tr" text NOT NULL,
	"desc_en" text NOT NULL,
	"desc_tr" text NOT NULL,
	"duration_min" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "treatments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"dentist_id" integer NOT NULL,
	"weekday" integer NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	CONSTRAINT "working_hours_dentist_id_weekday_pk" PRIMARY KEY("dentist_id","weekday")
);
--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_treatments" ADD CONSTRAINT "dentist_treatments_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."dentists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_treatments" ADD CONSTRAINT "dentist_treatments_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."dentists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."dentists"("id") ON DELETE cascade ON UPDATE no action;