# The grading form, as ליאורה asked for it

Written down because it arrived as voice notes and a mail thread, and neither
survives a laptop change. Her own words are quoted where the wording _is_ the
requirement — a paraphrase of "no score yet, only comments" is exactly the kind
of thing that drifts into "a low score".

Source: ד"ר ליאורה חייבי (`lioravc@gmail.com`), voice notes and mail, 25–26
August 2026. She is the מנחה; the students are B.Ed. seminar students.

## Her rubric

Read out of `תבנית טופס ציון פז.docx` by `core/import/rubric.ts` rather than
retyped. Four sections, seventeen criteria, 100 points:

| §   | Section             | Points |
| --- | ------------------- | ------ |
| 1   | נושא העבודה והתקציר | 10     |
| 2   | פרק תאורטי          | 42     |
| 3   | פרק מחקרי           | 43     |
| 4   | דרך ההגשה           | 5      |

The final grade is composed below the rubric, and is also read from the
document: **ציון העבודה 65% · פרזנטציה 10% · מטלות שוטפות 25%**.

## What she asked for

### The form fills in during the year, not at the end

> "אני רוצה שטופס הציון יתעדכן במקביל לפי הפרמטרים שם."

Each round scores whatever the submitted text supports, and leaves the rest
alone. Provisional scores are marked as draft — her suggestion was a colour —
and carry the date they were last updated.

On a re-submission the score moves, and it says **what changed**:

> "נוסף איזה... נגיד היא שיפרה את זה והזה, הוסיפה זה וזה... ואת הנקודות
> המעודכנות, שזה כאילו עלה בניקוד."

She can edit anything at the end: "אם אני רוצה לשנות הערה או לשנות משהו".

### When scoring starts — and when it must not

This is more specific than "score what you can", and the early case is the one
worth getting right:

- **The single-paragraph submission → comments only, no score at all.**
  > "יהיה פעם אחת שהם יגישו פסקה, אז את הפסקה צריך להעריך בלי ציון... לתת רק
  > הערות על הפסקה."
- **From the first part of chapter 1 (~6–7 pages) → scoring begins**, and rises
  as the work improves.
  > "זה בערך שבעה עמודים, שישה עמודים, אז שם מהחלק הזה אני אבקש כבר שהוא כן
  > ייתן ציונים ושהציונים גם ישתדרגו ביחס לשדרוגים."

A score on a paragraph is not a small inaccuracy — it is a number a student
will read as a verdict on work she has barely started.

### Two criteria the model may never score

Confirmed by her, and permanent:

- **2.2 שילוב מקורות חב"ד בהשקפה חסידית (3)** — she judges it.
- **4.2 הגשה נאה (2)** — she explained it means layout and typesetting
  ("העימוד שלה"), which the model cannot see. "אני אוכל להעריך את זה בעצמי."

Left blank for her rather than guessed at. That is 5 of the 100 points.

### The final grade

The 65/10/25 arithmetic happens **only at the end** — "לא צריך את זה לפני כן".
The 25% (מטלות שוטפות) she types in herself; nothing in Margin ever sees it.

### Sources and APA

She sent two links and asked, directly, whether the bot can read them:

> "תבדוק אם זה טוב לבוט או שהוא לא מצליח ללמוד מכזה קישור"

**It cannot open a link.** That is answered in the app: a source is carried to
the model as a name plus her note, and the prompt says so — see the sources
section in the README. What she wants followed:

- The most current APA rules.
- **אחידות** — consistency above all.
- Separate precision for Hebrew and for English. She is sending the specifics in
  writing; they belong in the source's notes field, verbatim.
- Academic and theoretical writing conventions, syntax and register.

Her links: `education.biu.ac.il/APA7_guides`, and the Open University writing
centre page.

## Not now — for the start of next year

She was explicit that this is not for the current papers:

> "לתחילת שנה הקרובה תזכור שאנחנו צריכים שתהיה הגשה של מאמרים."

One of the submissions will be **a folder of articles**, and she wants Margin
to:

The third of these is **half-built already**: `core/reliability/citations.ts`
compares what the paper cites against its own bibliography, which is the same
comparison with a different right-hand side. Pointing it at her folder of
articles instead of the reference list is the remaining work.

1. Read each article and respond to it individually.
2. Judge whether each is academic ("לא יודעת אם הם אקדמיים או לא").
3. **Cross-check the paper against the folder** — are the sources cited inside
   the work actually present among the articles she was given?

Point 3 is the substantial one and is a feature in its own right.

## The Word document

Asked whether she needs the filled `.docx` back or just the scores on screen:

> "ברור שהכי טוב שיהיה הטופס מוכן ורק אני אערוך על הטופס ואני אוכל להוריד אותו...
> אבל אם אתה רואה שאני אטבח עם זה, אז אפשר גם בדרך אחרת."

So: preferred, not required. **Built** — `core/export/zip-writer.ts` and
`core/export/grade-docx.ts`, the counterparts to `core/import/zip.ts`. The
button is on טפסי הערכה.

It is not pixel-identical to her template, which is the trade that was made
explicit before building it: matching her typesetting would mean shipping the
template as a binary and patching it, and that breaks the moment she edits it.
What it does carry is her sections, her criteria, her point values and her
65/10/25 weighting in her order, right to left.

The document is stricter than the screen about absence, because it is read
without any of the screen's context: an unscored criterion prints `—`, 2.2 and
4.2 print `לשיפוטך`, and no final grade appears until every part of it is in.

## AI detection — asked for, and refused as asked

A detector that scores a paper for being AI-written was requested and not
built. They do not work reliably, they are trained overwhelmingly on English,
and what they read as machine-written is careful formal register — which is
exactly what a seminary student produces when reaching for an academic voice.
The output is an accusation against a named girl with no evidence to show her.

That is the same rule the reliability module already applies to `bulk_paste`
and `few_revisions`: refused outright, not softened.

What was built instead is the citation check above. Invented references are the
most reliable trace an AI-written paper actually leaves, and unlike a score it
produces something she can look at: this paper cites Cohen 2021, and Cohen 2021
is in no reference list.

## Still open

- Do the students ever see a draft score, or only the comments she sends?
- Her written APA specifics, once they arrive.
