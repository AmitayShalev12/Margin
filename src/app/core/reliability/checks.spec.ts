import { ReliabilityFlagCode, Student, Submission, SubmissionRound } from '../models';
import { CheckInput, NOT_CHECKED, buildCheck, similarity } from './checks';

/**
 * What Margin will and will not say about a student's honesty.
 *
 * More than half of this file asserts refusals, and that is the point. The
 * flags are cheap; the discipline about which ones exist, and about never
 * letting silence read as exoneration, is the whole module.
 */

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: 'st-1',
    teacher_id: 't1',
    full_name: 'נועה ברקוביץ׳',
    email: null,
    class_name: null,
    drive_account_email: 'noa@school.org.il',
    notes: null,
    active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'sub-1',
    assignment_id: 'a1',
    student_id: 'st-1',
    status: 'in_review',
    current_round: 1,
    title: null,
    drive_file_id: 'file-1',
    drive_file_name: 'נועה ברקוביץ׳',
    drive_mime_type: 'application/vnd.google-apps.document',
    drive_web_view_link: null,
    drive_owner_email: 'noa@school.org.il',
    drive_creator_email: 'noa@school.org.il',
    drive_created_at: '2026-07-01T08:00:00.000Z',
    drive_modified_at: '2026-08-01T08:00:00.000Z',
    drive_revision_count: 4,
    drive_metadata_raw: null,
    last_synced_at: null,
    word_count: 900,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function round(text: string, submissionId = 'sub-1'): SubmissionRound {
  return {
    id: `round-${submissionId}`,
    submission_id: submissionId,
    round_number: 1,
    document_text: text,
    document_blocks: null,
    drive_revision_id: null,
    received_at: '',
    notes_sent_at: null,
    ai_summary: null,
    ai_summary_confirmed_at: null,
    created_at: '',
    updated_at: '',
  };
}

/** Drive's captured metadata, with the editors it reported. */
function withEditors(emails: string[]): Submission['drive_metadata_raw'] {
  return {
    captured_at: '',
    file: {},
    revisions: emails.map((email, i) => ({
      id: `rev${i}`,
      lastModifyingUser: { emailAddress: email },
    })),
    revisions_truncated: false,
  } as unknown as Submission['drive_metadata_raw'];
}

function run(overrides: Partial<CheckInput> = {}) {
  return buildCheck({
    submission: submission(),
    round: round('טקסט כלשהו של העבודה'),
    student: student(),
    others: [],
    rounds: [],
    teacherEmail: 'ronit@school.org.il',
    checkedAt: '2026-08-15T09:00:00.000Z',
    ...overrides,
  });
}

const outcome = (results: ReturnType<typeof run>['results'], code: ReliabilityFlagCode) =>
  results.find((r) => r.code === code)!;

describe('what is never checked', () => {
  /**
   * The refusal this module was scoped around. Drive reports consolidated
   * revisions, not sessions — a paper written over three weeks comes back
   * looking exactly like one pasted in at midnight, and no wording makes that
   * comparison fair when a student carries the cost of being wrong.
   */
  it('raises nothing about how the work was typed, whatever the metadata says', () => {
    const { check, results } = run({
      submission: submission({
        drive_revision_count: 1,
        drive_metadata_raw: withEditors(['noa@school.org.il']),
      }),
    });

    const codes = results.map((r) => r.code);
    expect(codes).not.toContain('bulk_paste');
    expect(codes).not.toContain('few_revisions');
    expect(check.flags.map((f) => f.code)).not.toContain('bulk_paste');
    expect(check.flags.map((f) => f.code)).not.toContain('few_revisions');
    // The raw material for that analysis is not even stored.
    expect(check.revision_summary).toBeNull();
  });

  it('tells her what it does not check, and why', () => {
    expect(NOT_CHECKED.length).toBeGreaterThanOrEqual(3);
    const all = NOT_CHECKED.map((n) => `${n.title} ${n.why}`).join(' ');

    expect(all).toContain('בינה מלאכותית');
    expect(all).toContain('האינטרנט');
    // And the revision-granularity refusal, in her terms rather than Drive's.
    expect(all).toContain('היסטוריית הגרסאות');
  });

  it('never raises anything at the highest severity', () => {
    const { check } = run({
      submission: submission({
        drive_creator_email: 'someone@else.com',
        drive_owner_email: 'noa@school.org.il',
        drive_metadata_raw: withEditors(['stranger@else.com']),
      }),
    });

    expect(check.flags.length).toBeGreaterThan(0);
    for (const flag of check.flags) expect(flag.severity).not.toBe('high');
  });
});

describe('the metadata checks', () => {
  it('notices a file created in another account', () => {
    const { results } = run({
      submission: submission({ drive_creator_email: 'someone@else.com' }),
    });

    const result = outcome(results, 'creator_mismatch');
    expect(result.outcome).toBe('raised');
    expect(result.flag?.message).toContain('someone@else.com');
  });

  it('says so when it cannot compare, rather than passing silently', () => {
    // The roster has no Drive account for her — extremely common.
    const { results } = run({ student: student({ drive_account_email: null }) });

    const result = outcome(results, 'creator_mismatch');
    expect(result.outcome).toBe('no_data');
    expect(result.outcome).not.toBe('clear');
    expect(result.unavailable).toContain('מאיזה חשבון');
  });

  it('notices ownership sitting somewhere other than where the file began', () => {
    const { results } = run({
      submission: submission({
        drive_creator_email: 'friend@school.org.il',
        drive_owner_email: 'noa@school.org.il',
      }),
    });

    expect(outcome(results, 'ownership_transferred').outcome).toBe('raised');
  });

  it('names an editing account that appears nowhere else in her work', () => {
    const { results } = run({
      submission: submission({
        drive_metadata_raw: withEditors(['noa@school.org.il', 'helper@gmail.com']),
      }),
    });

    const result = outcome(results, 'unknown_editor');
    expect(result.outcome).toBe('raised');
    expect(result.flag?.message).toContain('helper@gmail.com');
  });

  it('does not call the teacher a stranger on her own students’ documents', () => {
    const { results } = run({
      submission: submission({
        drive_metadata_raw: withEditors(['noa@school.org.il', 'ronit@school.org.il']),
      }),
    });

    expect(outcome(results, 'unknown_editor').outcome).toBe('clear');
  });

  /** An account that edits all her work is hers, whatever the roster says. */
  it('treats an account seen across her other submissions as familiar', () => {
    const other = submission({
      id: 'sub-2',
      drive_file_id: 'file-2',
      drive_metadata_raw: withEditors(['noa.b.2026@gmail.com']),
    });

    const { results } = run({
      submission: submission({
        drive_metadata_raw: withEditors(['noa.b.2026@gmail.com']),
      }),
      others: [other],
    });

    expect(outcome(results, 'unknown_editor').outcome).toBe('clear');
  });

  it('says so when Drive gave no editing history at all', () => {
    const { results } = run({ submission: submission({ drive_metadata_raw: null }) });

    const result = outcome(results, 'unknown_editor');
    expect(result.outcome).toBe('no_data');
    // And says it is not itself suspicious, because it very often isn't.
    expect(result.unavailable).toContain('תקין');
  });
});

describe('similarity to other submitted work', () => {
  const COPIED = 'המדגם נבחר באופן אקראי וכלל 42 תלמידות מכיתות יא ויב שמילאו שאלון בן 24 היגדים';

  it('measures overlap on long runs, not on shared vocabulary', () => {
    expect(similarity(COPIED, COPIED)).toBe(1);
    expect(
      similarity('המדגם כלל תלמידות רבות מן השכבה', 'הכלי היה שאלון קצר בן עשרים היגדים'),
    ).toBeLessThan(0.2);
  });

  /**
   * The fixture trap. Every seeded round in this app spreads the same document
   * by construction, so an archive that included them would flag every student
   * in the course against every other on her first sync.
   */
  it('ignores work that never came from Drive, so fixtures accuse nobody', () => {
    const twin = submission({ id: 'sub-2', student_id: 'st-2', drive_file_id: null });

    const { results } = run({
      round: round(COPIED),
      others: [twin],
      rounds: [round(COPIED, 'sub-2')],
    });

    const result = outcome(results, 'similar_to_past_work');
    expect(result.outcome).toBe('no_data');
    expect(result.flag).toBeNull();
  });

  it('stays quiet with no archive, and says that is why', () => {
    const result = outcome(run().results, 'similar_to_past_work');

    expect(result.outcome).toBe('no_data');
    expect(result.unavailable).toContain('אין עדיין עבודות אחרות');
  });

  it('raises overlap against another student’s submitted work', () => {
    const other = submission({ id: 'sub-2', student_id: 'st-2', drive_file_id: 'file-2' });

    const { check, results } = run({
      round: round(COPIED),
      others: [other],
      rounds: [round(COPIED, 'sub-2')],
    });

    expect(outcome(results, 'similar_to_past_work').outcome).toBe('raised');
    expect(check.max_similarity).toBeGreaterThan(0.5);
    expect(check.similar_submission_id).toBe('sub-2');
  });

  it('does not compare a student against herself', () => {
    const hers = submission({ id: 'sub-2', student_id: 'st-1', drive_file_id: 'file-2' });

    const { results } = run({
      round: round(COPIED),
      others: [hers],
      rounds: [round(COPIED, 'sub-2')],
    });

    expect(outcome(results, 'similar_to_past_work').outcome).toBe('no_data');
  });
});

describe('the stored record', () => {
  it('is one per round, so a re-run replaces rather than accumulates', () => {
    const first = run().check;
    const second = run({ checkedAt: '2026-08-16T09:00:00.000Z' }).check;

    expect(second.id).toBe(first.id);
  });

  it('keeps no per-account timing, which is the material for the refused checks', () => {
    const { check } = run({
      submission: submission({ drive_metadata_raw: withEditors(['a@b.com', 'c@d.com']) }),
    });

    expect(check.editors.length).toBe(2);
    for (const editor of check.editors) {
      expect(editor.first_edit_at).toBeNull();
      expect(editor.last_edit_at).toBeNull();
      expect(editor.revision_count).toBe(0);
    }
  });
});
