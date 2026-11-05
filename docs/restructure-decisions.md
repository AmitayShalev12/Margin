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

## Decide: "הסגנון שלי" per course (requirement 21)

Today her voice is shared across courses, while corrections already stay in their course
(requirement 13, built).

**Recommendation: keep one shared voice, and let each course add to it.** Her voice is one person's;
what varies by course is strictness, which corrections and rules already carry.

| | Shared voice + per-course corrections | Fully separate per course |
|---|---|---|
| New course | Sounds like her from day one | Sounds generic until taught |
| Strict vs lenient | Handled by corrections and rules | Handled |
| What was learned | Kept as is | Has to be assigned to a course. Imported examples have none, so they either apply everywhere or need sorting by hand |

If she still wants separate: existing examples would stay global as a fallback, and new ones go to
the course. That loses nothing, so it can be added later.

## Before any real student work goes to the AI (requirement 22)

Nothing in the app blocks or warns about a free key today. Which key is deployed could not be checked
from the code. What has to change:

1. **Put a paid Gemini key on the server**, and confirm in Google's console that billing is on.
2. **Fix two functions:** `student-email` and `student-form` read only the shared key and ignore her
   own, so a paid key saved by her would not protect those.
3. **Decide the rule:** should the app refuse to send until someone has confirmed the key is paid? We
   recommend yes, because a tier cannot be detected from the key itself.

Until then, requirements 12, 14 and 15 can be tested only on synthetic papers.

## Not built yet, and why

| Req. | State | What it needs |
|---|---|---|
| 12 Past graded papers | Only comment import exists | Paid key, then a design for storing paper, comments, fixes and grade form together |
| 14 Chain checks, unanswered comments | Absent. The model sees only the current round | Paid key. Tasks now give the order of submissions, and flags can be a list of independent checks |
| 15 Comments that follow the stage | Absent. The prompt has no stage | Paid key, and 12 |
| 16 How the AI understands the process | Stages and counts are built; the AI's understanding is not | 12 |
| 17–18 Message to the student | Not built. Today's AI-drafted mail screen is untouched | Outlook decision. **Should the AI drafts stay alongside her templates?** |

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
