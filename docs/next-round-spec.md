# Next round: restructure around the course, the student and the file

Source: the client's notes of October 2026 (voice-dictated, so wording is rough). This is
the same list rewritten as a spec: what is wanted, what already exists, what "done" looks
like, and the three things that need a decision before they can be built.

## Read these first

**1. "API של מודל" almost certainly means Moodle, not an AI model.**
She writes מודל, and the parenthetical says "she already has moodle". That is the LMS.
So the item is: _can Margin connect to Moodle's web-service API and create a folder per
student there?_ It is a research task, not a build task (see Part C).

**2. "Gemini 3.1 Pro on Haviv's card" reverses a standing constraint.**
The model is pinned to Flash in `supabase/functions/_shared/model-config.ts`, with a
comment that Pro tiers are paid-only. That pin was set deliberately for the free tier.
Moving to Pro means a paid key on a card, which is also what unblocks real student work
(free-tier input may be used for model training). So it is the right move, but it is a
decision to confirm, not a quiet config change: see Part B.

**3. Several "missing" items exist but are not findable.** "Add a new course" is built
(קורס או שנה נוספת) but lives inside the courses screen. She did not find it, which is the
same as it being missing. Where an item below says _exists_, the work is placement, not
construction.

## Part A: the structure she wants

### A1. The course is chosen at the top, and everything follows from it

- A course selector in the top bar, on every screen. Choosing a course (and year) changes
  what every screen below shows.
- Beside it, a button to add a course and assign students to it.
- _Exists:_ `DataStore.selectCourse()`, course/year grouping, the add-course form.
  _Missing:_ the selector in the app shell, and the add flow reachable from it.
- Done when: switching course in the top bar changes the roster, submissions and grading
  form without leaving the screen, and a new course can be created from the same bar.

### A2. The home screen is the student list

Per student, one row showing:

- name and her Drive folder address (for now set from a separate "assign folder to
  course-student" panel; later it will come from a form)
- **number of files in her folder**
- **status summary:** works checked, how far the review got (up to which page), and what
  still needs correcting
- a **button to add a file** for her
- a **button to draft comments**, right there on the row

_Exists:_ roster, folder mapping, per-submission status, manual file upload.
_Missing:_ the per-student rollup, a file count, the page-reached figure, the row-level
buttons.

Open question: "up to which page" needs a definition. Documents here are blocks, not
pages. Options: the page of the last reviewed comment (needs a page estimate), or the
share of paragraphs reviewed. Recommend the second; it is real data rather than a guess.

### A3. Opening a file happens inside Margin

- Reading the paper in the app, not a redirect to Google Docs. She notes it already does
  this but the rendering is hard to read.
- Done when: tables render as tables, headings are visibly headings, line length is
  comfortable, and comment markers do not crowd the text. This is a readability pass on
  the review screen, not a new feature.

### A4. The draft button is available from three places

- at the **top of the document** (not only where it is today)
- from the **upload screen**, immediately after a file is added
- from the **home screen**, next to each student
- Done when: all three call the same drafting action and show the same progress state.

### A5. A progress bar for the check

- A real progress bar showing how long the check has left.
- Honest constraint: the model call has no progress signal, so a true percentage does not
  exist. The loader already counts elapsed seconds. A bar can be built from the typical
  duration (about 90s) as an estimate, but it must be labelled as one and must never reach
  100% before the run finishes. Done when it eases toward a ceiling (say 95%) and snaps
  to full only on completion.

### A6. Better entry of comments for training, in "הסגנון שלי"

Underspecified: she says to improve the interface but not what is wrong with it. Ask her
one question before building: what did she try to do and where did it get in the way?
Likely candidates, to propose rather than assume: paste several comments at once, drag a
file onto the page, edit a learned example, and see which examples the model is actually
using.

## Part B: things missing

| Item                                        | State                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Add a new course                            | Exists; needs to move to the top bar (A1)                                          |
| Drag a Docx / Word / PDF file in            | Missing everywhere. Docx works; **PDF is not readable** (needs a parser)           |
| Gemini 3.1 Pro                              | Decision needed (see below)                                                        |
| A button to assign a file to a student      | Exists only inside the Drive folder panel; add it to the home row and the file view |
| Manual import from Drive                    | Missing; pick a Drive file by hand rather than waiting for the sync                |
| OneDrive compatibility                      | Research (Part C)                                                                  |
| Moodle: per-student folders                 | Research (Part C)                                                                  |

**Drag and drop.** One drop zone component, used on the home row, the upload screen and
"הסגנון שלי". Accepts `.docx` today. For PDF, say so rather than failing silently: either
add a PDF text reader (real work: scanned PDFs have no text layer at all) or convert on
the way in. Recommend: support text-layer PDFs, and tell her plainly when a PDF is a scan.

**Gemini 3.1 Pro.** Before changing the pin:

1. confirm the exact model id on her key (earlier, `gemini-3.6-flash` was listed for her
   project; check the Pro id the same way, with a `models` call, not by guessing)
2. make the model a setting beside her API key rather than a constant, so moving back is
   one click and not a deploy
3. note the cost: Pro is several times the price of Flash, and a drafting run reads a
   whole paper. Show an estimate before the first run
4. the card belongs to Haviv, so the key stays in her own key field, never in the repo
5. update the comment in `model-config.ts`, which currently says Pro must not be used

## Part C: research, not code

**OneDrive.** Question: can comments and tracked changes be written into a document's
body? Microsoft Graph can read and write files in OneDrive, but it has no equivalent of
the Docs API's anchored comments. Word comments live in the `.docx` XML itself, so the
realistic route is to download the file, write real Word comments into the XML (the repo
already has a zip reader and writer), and upload it back. Worth a proof of concept before
promising it; the anchoring in particular needs testing against files Word actually
produced.

**Moodle.** Question: can Margin create a folder per student in Moodle? Moodle exposes a
web-service API (token-based) with file and assignment functions, but whether a _folder
per student_ is a first-class concept depends on the plugin in use (Assignment, Folder
resource, or Private files). Needs: the Moodle version, whether web services are enabled,
and an admin who can issue a token. This also decides whether Moodle could become the
_source_ of submissions, replacing the Drive sync for her students. Ask her IT contact
before any design work.

## Suggested order

1. **Top-bar course selector** (A1): everything else hangs off it
2. **Home student list with the rollup and row buttons** (A2, A4)
3. **Drop zone + manual Drive import + assign-to-student button** (Part B)
4. **Review screen readability** (A3) and **progress bar** (A5)
5. **Gemini Pro as a setting**, once the card and key are confirmed
6. Research spikes on OneDrive and Moodle, in parallel and time-boxed

Items 1 and 2 change the app's shape and should land before the smaller ones, so the
smaller ones are built into the new layout rather than the old one.

## Decisions I need from you

- Is "מודל" Moodle? (I have assumed so.)
- Go ahead with Gemini Pro, and who enters the key?
- "Up to which page": paragraphs reviewed, or a page estimate?
- What exactly was awkward in "הסגנון שלי"?
