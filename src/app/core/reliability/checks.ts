import { DriveMetadataSnapshot } from '../drive/drive-types';
import {
  ReliabilityCheck,
  ReliabilityFlag,
  ReliabilityFlagCode,
  Student,
  Submission,
  SubmissionRound,
  UUID,
} from '../models';
import { derivedId } from '../ids';

/**
 * What Margin is willing to say about whether a paper is the student's own.
 *
 * The governing rule, and the reason this file is smaller than the model that
 * describes it: **only checks the data genuinely supports.** Three of the seven
 * flag codes in `ReliabilityFlagCode` are deliberately never raised, and not
 * behind a setting or with softer wording either. Drive's revision history for
 * a Google Doc is consolidated, not per-session — a paper written honestly over
 * three weeks routinely comes back as four revisions, indistinguishable from
 * one pasted in at midnight. `bulk_paste`, `few_revisions` and the
 * editing-session count would therefore be manufacturing an accusation out of
 * an API limitation, and the cost of being wrong is carried by a teenager.
 * `RevisionSummary` is left unpopulated for the same reason.
 *
 * What remains rests on fields Drive reports accurately: who created the file,
 * who owns it now, which accounts edited it. Plus text similarity, which
 * compares against work actually submitted here and nothing else.
 *
 * Every flag is phrased as an observation with its evidence attached, and none
 * is ever `high` severity. This is a prompt to look, never a verdict.
 */

/** Whether a check ran, and what it found. */
export type CheckOutcome = 'raised' | 'clear' | 'no_data';

export interface CheckResult {
  code: ReliabilityFlagCode;
  /** Short Hebrew name of what was checked. */
  title: string;
  outcome: CheckOutcome;
  flag: ReliabilityFlag | null;
  /**
   * Why it could not run, in her terms. The important half of the design:
   * "nothing raised" and "could not be checked" must never look alike.
   */
  unavailable: string | null;
}

/**
 * Checks Margin does not perform, and will not.
 *
 * Shown to the teacher beside the results, because an authenticity panel that
 * lists only what it found reads as a clean bill of health — and she would be
 * entitled to conclude, from silence, that the things not listed here had been
 * ruled out. They have not.
 */
export const NOT_CHECKED: readonly { title: string; why: string }[] = [
  {
    title: 'האם הטקסט נכתב בעזרת בינה מלאכותית',
    why: 'אין לזה שיטת זיהוי אמינה. כלים שמתיימרים לכך טועים לא מעט, והטעות נופלת על התלמידה.',
  },
  {
    title: 'העתקה מהאינטרנט או מעבודות של בתי ספר אחרים',
    why: 'ההשוואה נעשית רק מול עבודות שהוגשו כאן, ולא מול שום מקור חיצוני.',
  },
  {
    title: 'אם העבודה נכתבה ברצף אחד או לאורך זמן',
    why: 'היסטוריית הגרסאות של גוגל דוקס גסה מדי לשאלה הזו: עבודה שנכתבה לאורך שבועות נראית בה בדיוק כמו עבודה שהודבקה בבת אחת. אין ניסוח שהופך את ההשוואה הזו להוגנת, ולכן היא לא נעשית.',
  },
];

// ---------------------------------------------------------------------------
// Text similarity
// ---------------------------------------------------------------------------

/** Long enough that shared phrasing on a shared topic doesn't register. */
const SHINGLE_WORDS = 5;

/**
 * Deliberately high.
 *
 * Two papers on the same assignment share a brief, a reading list and a set of
 * headings, so overlap is expected and normal. At five-word granularity,
 * independent writing sits far below this; reaching it means long stretches of
 * identical text.
 */
const SIMILARITY_THRESHOLD = 0.5;

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    out.add(words.slice(i, i + SHINGLE_WORDS).join(' '));
  }
  return out;
}

/** Overlap of two shingle sets, 0–1. */
export function similarity(left: string, right: string): number {
  const a = shingles(left);
  const b = shingles(right);
  if (!a.size || !b.size) return 0;

  let shared = 0;
  for (const shingle of a) if (b.has(shingle)) shared += 1;
  return shared / (a.size + b.size - shared);
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface CheckInput {
  submission: Submission;
  round: SubmissionRound | null;
  student: Student | undefined;
  /** Every other submission, for the archive and for editor familiarity. */
  others: readonly Submission[];
  rounds: readonly SubmissionRound[];
  /** Her own address, so the teacher's own edits are never "unknown". */
  teacherEmail: string | null;
  checkedAt: string;
}

function lower(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

/** Editors Drive reports, from the metadata captured at sync. */
function editorsOf(submission: Submission): { emails: string[]; known: boolean } {
  const raw = submission.drive_metadata_raw as DriveMetadataSnapshot | null;
  const revisions = raw?.revisions;
  if (!revisions?.length) return { emails: [], known: false };

  const emails = new Set<string>();
  for (const revision of revisions) {
    const email = lower(revision.lastModifyingUser?.emailAddress);
    if (email) emails.add(email);
  }
  return { emails: [...emails], known: true };
}

function creatorMismatch(input: CheckInput): CheckResult {
  const base = { code: 'creator_mismatch' as const, title: 'מי יצר את הקובץ' };
  const creator = lower(input.submission.drive_creator_email);
  const hers = lower(input.student?.drive_account_email);

  if (!creator) {
    return {
      ...base,
      outcome: 'no_data',
      flag: null,
      unavailable: 'גוגל לא דיווחה מי יצר את הקובץ.',
    };
  }
  if (!hers) {
    return {
      ...base,
      outcome: 'no_data',
      flag: null,
      unavailable: `כדי להשוות צריך לדעת מאיזה חשבון ${input.student?.full_name ?? 'התלמידה'} מגישה. אפשר להשלים את זה ברשימת התלמידות.`,
    };
  }
  if (creator === hers) return { ...base, outcome: 'clear', flag: null, unavailable: null };

  return {
    ...base,
    outcome: 'raised',
    unavailable: null,
    flag: {
      code: 'creator_mismatch',
      severity: 'attention',
      /**
       * Reworded with the Drive model, not just restyled.
       *
       * "לא בחשבון שממנו היא מגישה בדרך כלל" described a habit — where she
       * *tends* to submit from — which was as much as could be claimed when the
       * documents lived on the teacher's account. Now she owns the file she
       * hands in, so the account is hers by construction and a different
       * creator means the document began somewhere else. Still an observation
       * with its evidence attached, and still not a verdict: a girl who wrote
       * it on a school computer and moved it is the innocent version.
       */
      message: `הקובץ נוצר בחשבון ${creator}, ולא בחשבון שהיא מגישה ממנו. יכול להיות שהתחילה אותו במקום אחר והעבירה.`,
      evidence: { creator, expected: hers },
    },
  };
}

/**
 * Whether the document changed hands.
 *
 * Re-read after the Drive model changed, because the old framing had stopped
 * describing what this detects. When the work effectively lived on the
 * teacher's account, creator ≠ owner was the *ordinary* case — a student made
 * the file, the teacher ended up owning the copy — and the check raised on
 * routine submissions. Now each student keeps her own document and moves it
 * into the year folder, so creator = owner = her is the expectation, and a
 * mismatch is a real anomaly rather than a description of the workflow.
 *
 * One case is carved out rather than raised: the teacher owning it. That is
 * what a file imported under the old arrangement looks like, and it says
 * nothing about the student. Reporting it as "the document changed hands"
 * would be technically true and completely misleading.
 */
function ownershipTransferred(input: CheckInput): CheckResult {
  const base = { code: 'ownership_transferred' as const, title: 'האם הבעלות על הקובץ עברה' };
  const creator = lower(input.submission.drive_creator_email);
  const owner = lower(input.submission.drive_owner_email);
  const teacher = lower(input.teacherEmail);

  if (!creator || !owner) {
    return {
      ...base,
      outcome: 'no_data',
      flag: null,
      unavailable: 'גוגל לא דיווחה גם מי יצר את הקובץ וגם מי הבעלים שלו.',
    };
  }
  if (creator === owner) return { ...base, outcome: 'clear', flag: null, unavailable: null };

  // Hers. An older way of collecting work, not a finding about the student.
  if (teacher && owner === teacher) {
    return {
      ...base,
      outcome: 'no_data',
      flag: null,
      unavailable:
        'הקובץ הזה נמצא בבעלותך ולא בבעלות התלמידה, ולכן אי אפשר ללמוד מכאן דבר על מי כתב אותו. כשהתלמידה מגישה קובץ משלה הבדיקה הזו עובדת.',
    };
  }

  return {
    ...base,
    outcome: 'raised',
    unavailable: null,
    flag: {
      code: 'ownership_transferred',
      severity: 'attention',
      // Says what it now means: she is expected to own what she hands in.
      message: `הקובץ נוצר בחשבון ${creator} והבעלות עליו נמצאת עכשיו אצל ${owner} — ולא אצל התלמידה שהגישה אותו.`,
      evidence: { creator, owner, expected_owner: 'student' },
    },
  };
}

/**
 * An account that edited this paper and appears nowhere else in her work.
 *
 * Only ever a positive claim. A truncated revision list means accounts may be
 * missing, which makes absence meaningless — but an account Drive *did* report
 * is one that really touched the file.
 */
function unknownEditor(input: CheckInput): CheckResult {
  const base = { code: 'unknown_editor' as const, title: 'מי ערך את המסמך' };
  const { emails, known } = editorsOf(input.submission);

  if (!known) {
    return {
      ...base,
      outcome: 'no_data',
      flag: null,
      unavailable: 'גוגל לא מסרה היסטוריית עריכה לקובץ הזה. זה קורה גם כשהקובץ תקין לגמרי.',
    };
  }

  const familiar = new Set(
    [
      lower(input.student?.drive_account_email),
      lower(input.submission.drive_owner_email),
      lower(input.teacherEmail),
    ].filter((email): email is string => !!email),
  );

  // Accounts that edited her other work are hers by demonstration, whatever
  // the roster says.
  for (const other of input.others) {
    if (other.student_id !== input.submission.student_id) continue;
    if (other.id === input.submission.id) continue;
    for (const email of editorsOf(other).emails) familiar.add(email);
  }

  const strangers = emails.filter((email) => !familiar.has(email));
  if (!strangers.length) return { ...base, outcome: 'clear', flag: null, unavailable: null };

  return {
    ...base,
    outcome: 'raised',
    unavailable: null,
    flag: {
      code: 'unknown_editor',
      severity: 'attention',
      message:
        strangers.length === 1
          ? `חשבון נוסף ערך את המסמך: ${strangers[0]}. הוא לא מופיע בעבודות אחרות שלה.`
          : `${strangers.length} חשבונות נוספים ערכו את המסמך, ואינם מופיעים בעבודות אחרות שלה.`,
      evidence: { editors: strangers },
    },
  };
}

/**
 * Overlap with another paper submitted here.
 *
 * The archive is real submitted work only — a submission with a Drive file
 * behind it. Seeded demonstration rounds all carry the same text by
 * construction, and comparing against them would flag every student in the
 * course against every other on their first sync. A fixture is not evidence
 * about anybody.
 */
function similarToPastWork(input: CheckInput): CheckResult {
  const base = { code: 'similar_to_past_work' as const, title: 'דמיון לעבודות אחרות שהוגשו' };
  const text = input.round?.document_text?.trim();

  if (!text) {
    return {
      ...base,
      outcome: 'no_data',
      flag: null,
      unavailable: 'אין טקסט קריא לעבודה הזו להשוות אותו.',
    };
  }

  const archive = input.others.filter(
    (other) =>
      other.id !== input.submission.id &&
      other.student_id !== input.submission.student_id &&
      !!other.drive_file_id,
  );

  if (!archive.length) {
    return {
      ...base,
      outcome: 'no_data',
      flag: null,
      unavailable:
        'אין עדיין עבודות אחרות שהוגשו דרך הדרייב להשוות מולן. ההשוואה תתחיל לעבוד ככל שייסנכרנו עוד עבודות.',
    };
  }

  let best = 0;
  let bestId: UUID | null = null;

  for (const other of archive) {
    const otherText = input.rounds
      .filter((r) => r.submission_id === other.id)
      .map((r) => r.document_text ?? '')
      .join('\n');
    if (!otherText.trim()) continue;

    const score = similarity(text, otherText);
    if (score > best) {
      best = score;
      bestId = other.id;
    }
  }

  if (best < SIMILARITY_THRESHOLD || !bestId) {
    return { ...base, outcome: 'clear', flag: null, unavailable: null };
  }

  return {
    ...base,
    outcome: 'raised',
    unavailable: null,
    flag: {
      code: 'similar_to_past_work',
      severity: 'attention',
      message: `חלקים ניכרים מהטקסט מופיעים גם בעבודה אחרת שהוגשה כאן (${Math.round(best * 100)}% חפיפה).`,
      evidence: { similarity: best, submission_id: bestId },
    },
  };
}

// ---------------------------------------------------------------------------

export interface CheckOutput {
  check: ReliabilityCheck;
  results: CheckResult[];
}

/**
 * Runs every check Margin is willing to run, and reports each one's outcome —
 * including the ones that could not run at all.
 */
export function buildCheck(input: CheckInput): CheckOutput {
  const results = [
    creatorMismatch(input),
    ownershipTransferred(input),
    unknownEditor(input),
    similarToPastWork(input),
  ];

  const similar = results.find((r) => r.code === 'similar_to_past_work');
  const evidence = similar?.flag?.evidence as { similarity?: number; submission_id?: UUID } | null;

  // The accounts the unknown-editor check singled out, so the stored record
  // marks the same ones the screen does rather than recomputing differently.
  const strangerEvidence = results.find((r) => r.code === 'unknown_editor')?.flag?.evidence as
    { editors?: string[] } | null | undefined;
  const strangers = new Set(strangerEvidence?.editors ?? []);

  const check: ReliabilityCheck = {
    // One per round, so a re-run updates rather than accumulating verdicts.
    id: derivedId('reliability', `${input.submission.id}:${input.round?.id ?? 'no-round'}`),
    submission_id: input.submission.id,
    round_id: input.round?.id ?? null,
    checked_at: input.checkedAt,
    file_creator_email: input.submission.drive_creator_email,
    file_owner_email: input.submission.drive_owner_email,
    // Populated only from what Drive reports; no session or burst analysis.
    editors: editorsOf(input.submission).emails.map((email) => ({
      email,
      display_name: null,
      // Timestamps and per-account revision counts are left null on purpose:
      // they are the raw material for the session analysis this module does
      // not do, and storing them would invite someone to do it later.
      first_edit_at: null,
      last_edit_at: null,
      revision_count: 0,
      unfamiliar: strangers.has(email),
    })),
    // Deliberately null. See the note at the top of this file.
    revision_summary: null,
    max_similarity: evidence?.similarity ?? null,
    similar_submission_id: evidence?.submission_id ?? null,
    flags: results.map((r) => r.flag).filter((flag): flag is ReliabilityFlag => !!flag),
    dismissed: false,
    dismissed_note: null,
    created_at: input.checkedAt,
    updated_at: input.checkedAt,
  };

  return { check, results };
}
