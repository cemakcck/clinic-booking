import {
  boolean,
  index,
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

// ---------------------------------------------------------------------------------------------
// Better Auth tables (generated with Better Auth's drizzle schema generator for the options in
// src/lib/auth/auth.ts, then adjusted: timestamptz everywhere, role NOT NULL, dentist_id FK).
// ---------------------------------------------------------------------------------------------

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: tstz("created_at").defaultNow().notNull(),
  updatedAt: tstz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  /** "receptionist" | "dentist" | "admin" (see src/lib/auth/roles.ts). */
  role: text("role").notNull(),
  /** Set for dentist logins: the one dentist profile this login manages. */
  dentistId: integer("dentist_id").references(() => dentists.id, { onDelete: "set null" }),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
