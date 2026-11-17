# Margin: project summary

_Written 16 November 2026. Describes the app as it is in the repository on that date._

## What Margin is

Margin is a Hebrew, right-to-left web app for a college lecturer who supervises seminar papers. Students hand in papers through Google Drive. Margin collects them, drafts comments on each paper with an AI model, and lets the lecturer accept, edit or reject every comment before anything goes back to the student.

The lecturer stays in charge: the AI only drafts. Nothing is sent to a student without her approving it.

The guiding constraint is simplicity. An early tester found a previous version too complicated, so every screen is kept to one job, with large text and quiet controls.

## Who uses it

| Person | What they do | Needs an account |
|---|---|---|
| The lecturer | Runs courses, reads papers, approves comments, grades | Yes, signs in with Google |
| A student | Fills in a sign-up form from a join link; hands in work through her own Drive folder | No |

## How the work flows

1. **Set up a course.** The lecturer creates a course for a year and adds its tasks (for example: topic, research proposal, first chapter).
2. **Bring in students.** She adds them by hand, imports the college's Excel list, or sends a join link that students fill in themselves.
3. **Collect papers.** Each student has a Drive folder. Margin reads the folder and files each paper under the right task. She can also add a Word file by hand.
4. **Draft comments.** She presses "process" on a paper, or "check all" for a whole task. The AI drafts comments anchored to exact quotes in the paper, following her own rules and writing style.
5. **Review.** She reads the paper with the comments beside it and accepts, edits or dismisses each one. She can add her own.
6. **Approve and send.** She confirms the final comments and the message to the student.
7. **Grade.** An assessment form is built from the approved comments and her rubric.

## The screens

### The frame around every screen

- **Top bar:** open tabs (home, courses, students, papers she has open), the year selector, and search (Ctrl+K or "/").
- **Dynamic sidebar** (desktop): a handle at the middle of the right edge. It opens to show Home, My students, What's waiting for me, and the year's courses.
- **Account button** (desktop): bottom-right corner; leads to Settings and sign-out.
- **Assistant button:** bottom-left corner; opens the assistant window.
- **Bottom bar** (phone): Courses, Students, Assistant, More. The bell at the top shows what's waiting.

### Home: the courses (`/courses`)

- A "waiting for you" card, grouped by task. Each task is one line with a count; it opens to show the students and their status (ready to send, comments to decide, not checked yet).
- A "check all new papers" button inside each task.
- One card per course in the selected year: number of students, number of papers, and the next deadline.
- A button to add a course.

### Inside a course (`/courses/:id/...`)

A course has six tabs.

| Tab | What it is for |
|---|---|
| **Students** (תלמידות) | The course roster. A strip of task cards shows how many handed in each task. Each student row shows her progress and opens her own page. Students can be selected and processed in bulk. |
| **Rules and materials** (כללים וחומרים) | What the AI is told: work rules, ministry rules, her own rules, the syllabus, model papers, and examples of her past corrections. Rules can be typed, pasted or loaded from a Word file, and taken over from another course. |
| **Tasks and process** (סיכום משימות ותהליך) | A table of every student against every task (handed in, missing), and the list of tasks with their due dates. Tasks can be imported from Excel. |
| **Assessment form** (טופס הערכה) | The grading rubric and each student's scores, built from the approved comments. Exports to Word. |
| **Style in the course** (הסגנון בקורס) | What the AI has learned about how she writes comments, and the examples she has given it. |
| **Messages** (הודעות) | Papers ready to send, and up to a few message templates she can reuse. |

### A student's page (`/courses/:id/student/:studentId`)

- Her Drive folder: open it, change it, or sync from it. After a sync, every file found is listed with what happened to it (added, updated, unchanged, already have it, skipped and why).
- Her papers, split into "waiting for you" and "checked", each with a button to process or open it.
- A button to add a Word file by hand.

### Review (`/review/:submissionId`)

The paper itself, with highlighted passages and the comments attached to them. She accepts, edits, dismisses or writes comments. One main button at the bottom moves on to approval.

### Approve and send (`/approve/:submissionId`)

A last look at the comments that will go back, and the message to the student.

### My students (`/students`)

Every student across the year's courses in one list, with a comparison between years and an export to Excel.

### Settings (`/settings`)

- Join links: create a link for a course (open for a day, a week, a month, or until a date), copy it, close it early.
- Her own AI key and model, if she uses one.
- Backups: download everything as one file, restore from a file, and a daily copy to her Drive.

### Join form (`/join/:token`), public

Opens without an account and without the app around it. Shows only the course name and a short form: name, ID number, mobile, phone, email, address, pedagogic year, track, department, and a link to the student's Drive folder. Name, mobile, email and folder are required. A closed or expired link shows a plain "not available" message.

### The assistant

A resizable chat window that answers questions about her data ("what's waiting for me?") and can carry out actions for her, each shown as a step she can see. Conversations are saved.

## Look and feel

- **Language and direction:** Hebrew throughout, right to left. Dates are shown in both the Hebrew and the civil calendar.
- **Palette:** "ink on paper". Cool, slightly green-grey paper, white cards, a deep pine-green accent, and a muted honey highlight for annotated text.
- **Type:** one typeface, Heebo. Body text is 16px and the smallest text is 13px.
- **Shape:** rounded cards and buttons, thin hairlines between rows, soft shadows.
- **Controls:** one clear primary button per screen; secondary actions are quiet text or small grey icons. Destructive actions ask before they act.
- **Responsive:** every screen works on a phone, where lists stack and the bottom bar replaces the sidebar.

## How it is built

| Part | Technology |
|---|---|
| Front end | Angular 22: standalone components, signals, lazy-loaded screens |
| Back end | Supabase: Postgres with row-level security, and Edge Functions in Deno |
| AI | Google Gemini, called only from server functions |
| Files | Google Drive, through a separate consent from sign-in |
| Hosting | Netlify, built from the `main` branch |
| Tests | Vitest, about 1,060 tests |

### Code layout

- `src/app/features/`: one folder per screen (courses, review, approval, grading-forms, style-settings, students-overview, settings, join, sign-in).
- `src/app/core/`: everything without a screen (data store, Drive sync, AI, roster import and export, backup, the waiting list, the assistant).
- `src/app/shared/ui/`: pieces shared between screens (top tools, sidebar, waiting list, tab strip, assistant window).
- `src/styles/`: design tokens and shared styles.
- `supabase/migrations/`: the database, as 24 dated changes.
- `supabase/functions/`: the server functions.

### Server functions

| Function | Job |
|---|---|
| `annotate` | Drafts comments and rubric scores for one paper |
| `assistant` | Answers the assistant's questions and proposes actions |
| `criterion-reply`, `student-form`, `student-email` | Draft a rubric answer, an assessment form, and a message to a student |
| `drive-auth`, `drive-token` | Connect her Google Drive and keep the connection alive |
| `model-key` | Stores her own AI key, server-side only |
| `join` | Serves the public join form and writes the student into her course |

## Privacy and safety rules

- Each lecturer sees only her own data; the database enforces this row by row.
- API keys live only on the server and never reach the browser.
- Student ID numbers, addresses and email addresses are never sent to the AI. The assistant never sends paper contents.
- The public join form writes only through a server function, works only while its link is open, caps the number of sign-ups, and shows nothing about the lecturer or other students.
- A paper already in the system is never overwritten by a different file.
- The repository is public, so test papers, backups and student lists are kept out of it.
- Real student work should not be run through the AI on the free tier, because free-tier input may be used to improve the provider's models.

## Known limits

- One paper per student per task. An extra paper gets a task of its own, named after the file, which adds a column for the whole course.
- Margin only notices new papers while it is open; there is no background check on the server.
- Moodle integration was explored and is blocked until the college enables web services.
- Whether Drive lists files inside a folder shared as "anyone with the link" for an account that was not shared directly has not been confirmed against a real folder.

## Related documents

- [brand-guidelines.md](brand-guidelines.md): colours, type and tone.
- [grading-spec.md](grading-spec.md): how grading works.
- [restructure-decisions.md](restructure-decisions.md): why the app is organised by year and course.
- [next-round-spec.md](next-round-spec.md): planned work.
