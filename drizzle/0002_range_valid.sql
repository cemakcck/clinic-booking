ALTER TABLE "entries" DROP CONSTRAINT "entries_range_valid";
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_range_valid" CHECK (NOT isempty("during") AND NOT lower_inf("during") AND NOT upper_inf("during") AND lower_inc("during") AND NOT upper_inc("during") AND lower("during") < upper("during"));
