/**
 * Shared primitives for the data model.
 *
 * Convention: model fields use snake_case to match the Postgres columns
 * exactly, so rows coming back from supabase-js can be used as-is with no
 * mapping layer between the database and the UI.
 */

export type UUID = string;

/** ISO 8601 timestamp string, e.g. `2026-08-11T09:30:00.000Z`. */
export type ISODateTime = string;

/** Anything storable in a Postgres `jsonb` column. */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Timestamped {
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/**
 * The teacher is the tenant boundary of the whole app. `teacher_id` always
 * points at `auth.users.id`, which keeps every RLS policy down to a simple
 * `teacher_id = auth.uid()` check (directly or through a parent row).
 */
export interface OwnedByTeacher {
  teacher_id: UUID;
}
