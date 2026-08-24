-- Records that a comment reached the student's Google Doc.
--
-- The point is duplicate suppression across sends. A teacher reviews a paper,
-- sends, reviews further, and sends again; the second send must post only the
-- comments the first one didn't. Holding the Drive comment id — rather than a
-- boolean — also means a support question ("she says she never got the note
-- about her sample") can be answered against Drive itself.
--
-- Deliberately never cleared. Once a comment is in her Drive it is out of our
-- hands, and a null here would tell the app to post it again.

alter table public.annotations
  add column if not exists posted_comment_id text,
  add column if not exists posted_at         timestamptz;

comment on column public.annotations.posted_comment_id is
  'Drive comment id. Non-null means this comment is already on the student''s document and a re-send skips it.';

-- Answers "what still needs sending for this submission" without a full scan.
create index if not exists annotations_unposted_idx
  on public.annotations (submission_id)
  where posted_comment_id is null;
