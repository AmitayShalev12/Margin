-- ===========================================================================
-- Phones, and the columns of the college's student list.
--
-- So a list can be imported and exported in its own format. Nullable, because
-- a student added by hand has none of this. The list's ID number and home
-- address are deliberately not stored: nothing in Margin needs them.
-- ===========================================================================

alter table public.students
  add column if not exists phone text,
  add column if not exists mobile text,
  add column if not exists roster_details jsonb;

comment on column public.students.roster_details is
  'Status, pedagogic year, track and department from the imported student list, kept so the export matches its format.';
