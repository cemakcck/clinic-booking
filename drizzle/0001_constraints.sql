CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_no_overlap" EXCLUDE USING gist ("dentist_id" WITH =, "during" WITH &&) WHERE ("active");
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_range_valid" CHECK (lower("during") < upper("during"));
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_hold_fields" CHECK ("kind" <> 'hold' OR ("expires_at" IS NOT NULL AND "hold_token_hash" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_appointment_fields" CHECK ("kind" <> 'appointment' OR ("patient_id" IS NOT NULL AND "treatment_id" IS NOT NULL AND "status" IS NOT NULL AND "source" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_block_fields" CHECK ("kind" <> 'block' OR "block_reason" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_cancelled_inactive" CHECK ("status" IS DISTINCT FROM 'cancelled' OR "active" = false);
