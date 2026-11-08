import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tstzrange } from "./range";

export const entryKind = pgEnum("entry_kind", ["appointment", "hold", "block"]);
export const apptStatus = pgEnum("appt_status", [
  "booked",
  "arrived",
  "completed",
  "no_show",
  "cancelled",
]);
export const entrySource = pgEnum("entry_source", ["online", "staff"]);
export const cancelledBy = pgEnum("cancelled_by", ["patient", "staff"]);
export const blockReason = pgEnum("block_reason", [
  "surgery",
  "meeting",
  "personal",
  "leave",
  "other",
]);
export const callbackStatus = pgEnum("callback_status", ["new", "contacted", "closed"]);
export const emailStatus = pgEnum("email_status", [
  "sent",
  "logged",
  "suppressed",
  "capped",
  "failed",
]);
export const emailTrigger = pgEnum("email_trigger", ["patient", "staff"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** weekday 0 (Sun) - 6 (Sat); null open/close means closed. */
export const clinicHours = pgTable("clinic_hours", {
  weekday: integer("weekday").primaryKey(),
  open: text("open"),
  close: text("close"),
});

export const clinicSettings = pgTable("clinic_settings", {
  id: integer("id").primaryKey().default(1),
  lunchStart: text("lunch_start").notNull(),
  lunchEnd: text("lunch_end").notNull(),
});

export const closedDates = pgTable("closed_dates", {
  date: date("date", { mode: "string" }).primaryKey(),
  labelEn: text("label_en").notNull(),
  labelTr: text("label_tr").notNull(),
});

export const dentists = pgTable("dentists", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  titleEn: text("title_en").notNull(),
  titleTr: text("title_tr").notNull(),
  bioEn: text("bio_en").notNull(),
  bioTr: text("bio_tr").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const treatments = pgTable("treatments", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameTr: text("name_tr").notNull(),
  descEn: text("desc_en").notNull(),
  descTr: text("desc_tr").notNull(),
  durationMin: integer("duration_min").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const dentistTreatments = pgTable(
  "dentist_treatments",
  {
    dentistId: integer("dentist_id")
      .notNull()
      .references(() => dentists.id, { onDelete: "cascade" }),
    treatmentId: integer("treatment_id")
      .notNull()
      .references(() => treatments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.dentistId, t.treatmentId] })],
);

export const workingHours = pgTable(
  "working_hours",
  {
    dentistId: integer("dentist_id")
      .notNull()
      .references(() => dentists.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
  },
  (t) => [primaryKey({ columns: [t.dentistId, t.weekday] })],
);

export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phoneE164: text("phone_e164").notNull().unique(),
  email: text("email"),
  locale: text("locale").notNull(),
  createdAt: createdAt(),
});

export const entries = pgTable("entries", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  dentistId: integer("dentist_id")
    .notNull()
    .references(() => dentists.id),
  kind: entryKind("kind").notNull(),
  during: tstzrange("during").notNull(),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  holdTokenHash: text("hold_token_hash"),
  treatmentId: integer("treatment_id").references(() => treatments.id),
  patientId: uuid("patient_id").references(() => patients.id),
  status: apptStatus("status"),
  source: entrySource("source"),
  cancelledBy: cancelledBy("cancelled_by"),
  manageTokenHash: text("manage_token_hash").unique(),
  blockReason: blockReason("block_reason"),
  blockNote: text("block_note"),
  seriesId: uuid("series_id"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const callbackRequests = pgTable("callback_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phoneE164: text("phone_e164").notNull(),
  locale: text("locale").notNull(),
  treatmentId: integer("treatment_id").references(() => treatments.id),
  message: text("message"),
  status: callbackStatus("status").notNull().default("new"),
  ipHash: text("ip_hash").notNull(),
  createdAt: createdAt(),
});

export const emailLog = pgTable("email_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  toAddress: text("to_address").notNull(),
  locale: text("locale").notNull(),
  subject: text("subject").notNull(),
  status: emailStatus("status").notNull(),
  trigger: emailTrigger("trigger").notNull(),
  ipHash: text("ip_hash"),
  appointmentId: uuid("appointment_id"),
  createdAt: createdAt(),
});

export const rateEvents = pgTable("rate_events", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  ipHash: text("ip_hash").notNull(),
  createdAt: createdAt(),
});
