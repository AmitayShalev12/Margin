# Year → course restructure: decisions to bring to the client

Nothing here is final. Each section says what we recommend and what has to be decided.

## Approve: traffic light (requirement 6)

Built with these definitions so they can be seen working. Change them freely.

| Mark | Meaning |
|---|---|
| אדום, "באיחור" | Missed two or more deadlines, or a deadline passed and she has handed in nothing |
| כתום, "מועד אחד הוחמץ" | Missed exactly one deadline, and has handed in something |
| צהוב, "עוד לא התחילה" | Has handed in nothing, and no deadline has passed |
| ירוק, "בזמן" | Has handed in something and missed nothing |

"Missed" means the date passed and that task has no paper of hers. A late paper stops counting as
missed once it arrives. A task with no date can never be missed.

**To decide:** should a paper handed in late stay marked as late? Should "very early stage" be its
own level? That needs a definition of early, such as the first task still to come within 14 days.

## Approve: how a student's data works (requirement 8)

One person is one row. Each course she is in is one enrollment row. Inside a course she appears as
belonging to it; the overview joins the same rows across courses. This is already the database's
shape, so no data moves.

- Email and phone belong to the person, so one person cannot hold two conflicting values.
- The match check runs where a conflict can appear: importing a list flags any value that differs
  from what is saved, and she chooses. The overview also warns about one name with different details
  on two rows, and one address under two names.
- Matching is by name, because ID numbers are not stored. Two different students with one name are
  treated as one on import.
- Removing from a course leaves the person and her work. Deleting the person is only in the overview.

**Existing data:** a student belongs to a course if she is enrolled or has a paper in it. Anyone with
neither is listed inside each course under "תלמידות שלא שויכו לאף קורס", with a button to place her.

**To decide:** attendance has no data source today, so that column is empty. Where would it come from?

## Decide: Outlook (requirement 20)

| | Open a draft (`mailto:`) | Microsoft Graph |
|---|---|---|
| Sends through | Whatever mail app the computer defaults to, not necessarily Outlook | Her Outlook account |
| She sees the final message | Yes, in her mail app | Yes, if we create a draft and link her to it |
| Formatting | Plain text. Outlook is reported to strip HTML | HTML |
| Length | Reported limits of about 2,000 characters in older Outlook | Not an issue |
| Flow chart image | Not possible as far as we can tell; she would have to paste it | Inline attachments exist, but we have not proven this works; test first |
| College IT | Nothing | Register an app in Microsoft Entra, and her organization must allow user consent |

The `Mail.Send` delegated permission is documented as not needing admin consent, but colleges often
block user consent, so **ask IT**.

**Recommendation:** Graph, creating a draft for her to open and send. It is the only option that can
carry the process in the message, and a long description would not fit a `mailto:` link. Start with
`mailto:` only if IT says no; the message then has to be short, with the process as plain text.

## Decide: replies (requirement 20)

**Replies cannot be blocked.** Email has no such control, and any student can write back.

- Set Reply-To to another address. Graph supports this. Replies then go to that mailbox and she does
  not see them unless she checks it.
- Say in the message "this mailbox is not monitored, questions go to…". This is a request, not
  enforcement.
- An automatic rule in Outlook can file these replies away. It is her mailbox setting, and it can bury
  a real question.

A reply sent anyway always reaches whichever address is set. **Recommendation:** the sentence in the
message, plus an Outlook rule if she wants one. A dead Reply-To means a student's urgent question
goes unread.

## Decide: the file with the comments (requirement 20)

| | Link to her Drive paper | Attach the file | Reminder only |
|---|---|---|---|
| Access | Works only if her account can open it | No permission issue | None needed |
| Google Doc | Comments are in the doc | Needs exporting, and is a copy | Fine |
| Word file | Margin cannot post anchored comments to Word files in Drive today; to confirm | Can carry comments only if we generate them | Comments have to be somewhere she can reach |
| Risk | A wrong link or a permission request | A second version, and confidential work in email | She looks in the wrong place |

**Recommendation:** a link, with a one-line fallback ("it is also in your folder in Drive").
The link stays one document with no copies. Word files are the open question; check how many there are.

## Approve: names and layout inside a course (requirement 6)

"קורסים וחומרי רקע" is gone. Pressing a course card opens it on its students, with these parts along
the top: **תלמידות, עבודות, כללים וחומרים, משימות ותהליך, טופס הערכה, הסגנון בקורס, הודעות**. Expect to
refine this after she sees it. Drive connection sits in עבודות, because that is the work it brings in.

Her Gemini key and backups belong to no single course, so they moved to a small "הגדרות" link beside
the account name. That is the one thing beyond "התלמידות שלי" and "העוזר" near the sidebar.

## Approve: where what was already learned goes (requirement 15)

Style now belongs to one course. Her own comments, grade notes and rewrites already record which
course they came from, so they simply stay there. Only imported writing examples were truly shared.

**Built, and nothing deleted:** examples imported before 6 November 2026 keep working in every course,
because the course recorded on them only says what was open at the time. New ones stay in their
course. **To decide:** leave the old ones shared, or have her assign them to courses one by one.

## Before any real student work goes to the AI (requirement 22)

Nothing in the app blocks or warns about a free key today. Which key is deployed could not be checked
from the code. What has to change:

1. **Put a paid Gemini key on the server**, and confirm in Google's console that billing is on.
2. **Fix two functions:** `student-email` and `student-form` read only the shared key and ignore her
   own, so a paid key saved by her would not protect those.
3. **Decide the rule:** should the app refuse to send until someone has confirmed the key is paid? We
   recommend yes, because a tier cannot be detected from the key itself.

Until then, requirements 12, 14 and 15 can be tested only on synthetic papers.

## Decide: work with the app closed (requirement 24)

Today Drive sync and drafting run in her browser, so the bell and "מה מחכה לי?" know only what happened
while the app was open, and she gets no Outlook message (requirement 19).

What it needs:
- **Scheduled server work:** a timed job that runs an Edge Function. Supabase can do this.
- **Reaching her Drive:** her refresh token is already held on the server, so the job can list her
  folders without her. Reading files moves from the browser to the server, which needs its own review.
- **Time limits:** drafting takes a minute or two, close to Edge Function limits. A long paper may
  need splitting into steps.
- **Emailing her:** either Graph, sending from her own account (needs the same IT answer as above), or
  a sending service with its own domain. Check current pricing.
- **Cost:** the Supabase plan (see Pro above), a paid Gemini key, and any sending service.
- **Confidential content:** the email should hold a student's name at most, and a link into the app
  behind her login. Never the paper or comments.

**Recommended first step:** a daily job that only checks Drive for new files and emails her "new work
has arrived, open Margin". No AI and no paper content, so it can start before a paid key.

## Not built yet, and why

| Req. | State | What it needs |
|---|---|---|
| 14 Past graded papers | Only comment import exists | Paid key, then a design for storing paper, comments, fixes and grade form together |
| 16 Chain checks | Two built with no AI: a commented sentence still there word for word, and a skipped earlier task. Topic drift needs reading for meaning | Paid key. New checks are one function each |
| 17 Comments that follow the stage | Absent. The prompt has no stage | Paid key, and 14 |
| 18 How the AI understands the process | Stages and each student's progress are built; the AI's understanding is not | 14 |
| 19 Message to her in Outlook | Not built | Requirement 24 and the Outlook decision |
| 21 Opening in Outlook | Opens through `mailto:`, so whichever mail app is the computer's default, as plain text | Outlook decision |
| Attendance | Column is empty | A source for the data |

**Should the AI-drafted emails stay alongside her templates?** They are kept for now, behind a link in
the approval flow.

## Open questions from the build

- **Drive files and tasks:** a file from Drive has no task. It goes to the course's first task, and
  a later version of it becomes a new round. How should Drive know which task a file is for? A folder
  per task, or the file name?
- **Papers possibly in the wrong course:** before this change an upload could attach to another
  course's assignment. Those papers are not lost, but may show under the wrong course. This should be
  checked on the real data once deployed.
- **Markers:** new ones are plain, but still the circled character ①, because the app recognises them
  by it. Coloured markers already in documents stay coloured. "הסרת הסימונים מהמסמך" removes those of
  the latest round; older rounds' stay. Removing them all needs a separate tool, and has to avoid
  deleting a glyph she typed.

Sources: [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference),
[create message](https://learn.microsoft.com/en-us/graph/api/user-post-messages),
[send message](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0),
[update message, replyTo](https://learn.microsoft.com/en-us/graph/api/message-update?view=graph-rest-1.0),
[reply](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0),
[attachments](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0),
[mailto limits, reported](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/13317429/mailto-max-length-of-each-internet-browsers),
[Outlook and mailto, vendor post](https://mailtomaker.pages.dev/blog/outlook-mailto-link-issues).
