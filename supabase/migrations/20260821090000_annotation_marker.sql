-- The numbered marker Margin put in the student's document.
--
-- Recorded rather than pattern-matched. Removal can find the glyphs by
-- searching — they are characters no student types — but a search alone cannot
-- tell Margin's marker from one a teacher pasted herself, and cannot say which
-- comment a given number belongs to. This column is the record that a marker
-- was placed, which number it got, and therefore both that a re-send must skip
-- it and that a removal has something to remove.
--
-- Null means no marker: either the span could not be located, or the document
-- was never marked.

alter table public.annotations
  add column if not exists marker_number integer
    check (marker_number is null or (marker_number >= 1 and marker_number <= 50));

comment on column public.annotations.marker_number is
  'The number of the marker inserted into the document for this comment. Null when none was placed. Capped at 50 because above that a marker would need more than one character.';

-- One number per round, so two comments cannot claim the same glyph.
create unique index if not exists annotations_marker_number_idx
  on public.annotations (round_id, marker_number)
  where marker_number is not null;
