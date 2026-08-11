import { Annotation, LearningFeedbackLog, TeacherStyleExample } from '../models';
import { buildStyleProfile, countDecisions, deriveTraits, describeEdit } from './style-profile';

/**
 * The derivations, on their own. Everything the style screen claims about her
 * comes through here, so the thing worth pinning is what it refuses to claim:
 * a thin log has to produce silence, not a weaker sentence.
 */

let counter = 0;

function log(overrides: Partial<LearningFeedbackLog> = {}): LearningFeedbackLog {
  counter += 1;
  return {
    id: `log-${counter}`,
    teacher_id: 't1',
    course_id: 'c1',
    target_type: 'annotation',
    target_id: `an-${counter}`,
    action: 'edited',
    ai_text: 'יש להימנע משימוש בפועל ״הוכיחו״ בהקשר של מחקר מתאמי, שכן אין בכוחו לבסס טענה סיבתית.',
    final_text: '״הוכיחו״ חזק מדי למחקר מתאמי.',
    change_note: null,
    context_excerpt: null,
    created_at: `2026-08-0${(counter % 9) + 1}T09:00:00.000Z`,
    ...overrides,
  };
}

function annotation(id: string, kind: Annotation['kind']): Annotation {
  return {
    id,
    submission_id: 's1',
    round_id: 'r1',
    anchor: { block_id: 'b', block_index: 0, start: 0, end: 3, quote: 'טקסט' },
    kind,
    body: 'הערה',
    ai_body: 'הערה',
    origin: 'ai',
    edited_by_teacher: false,
    status: 'dismissed',
    confidence: null,
    grading_category_id: null,
    resolved_in_round: null,
    sort_order: 0,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
  };
}

describe('describeEdit', () => {
  it('names a shortening', () => {
    expect(
      describeEdit(
        'ההסתמכות על מחקרים אינה מלווה בהפניות ביבליוגרפיות ויש להשלימן בהתאם לכללי הציטוט.',
        'אילו מחקרים? שני שמות ושנה יעשו את העבודה.',
      ),
    ).toContain('קיצרת');
  });

  it('names a turn into a question', () => {
    expect(describeEdit('המדגם אינו אקראי.', 'האם באמת אקראי, או נוחות?')).toContain('הפכת לשאלה');
  });

  it('names both when both happened, in reading order', () => {
    const note = describeEdit(
      'המדגם מתואר כאקראי אך תיאור ההליך אינו תומך בכך ויש לתקן את הניסוח.',
      'באמת אקראי?',
    );
    expect(note).toBe('קיצרת, הפכת לשאלה');
  });

  it('says nothing when she barely touched it, rather than inventing a change', () => {
    // A word swapped, the length essentially unchanged: there is no honest
    // one-word description of that, so it gets none.
    expect(
      describeEdit('הסדר המקובל הוא משתתפים, כלים, הליך.', 'הסדר הנהוג הוא משתתפים, כלים, הליך.'),
    ).toBeNull();
  });
});

describe('deriveTraits', () => {
  it('claims nothing from a handful of edits', () => {
    const logs = [log(), log(), log()];
    expect(deriveTraits(logs)).toEqual([]);
  });

  it('reports that she shortens, and says what that rests on', () => {
    // Six rewrites, every one much shorter than the draft.
    const logs = Array.from({ length: 6 }, () => log());
    const traits = deriveTraits(logs);

    const brevity = traits.find((t) => t.text.includes('מקצרת'));
    expect(brevity).toBeTruthy();
    expect(brevity!.evidence).toBe('מתוך 6 תיקונים');
  });

  it('does not report shortening when her rewrites are not shorter', () => {
    const logs = Array.from({ length: 6 }, () =>
      log({
        ai_text: 'קצר.',
        final_text: 'ניסוח ארוך בהרבה שמסביר בדיוק מה חסר כאן ולמה זה חשוב.',
      }),
    );
    expect(deriveTraits(logs).some((t) => t.text.includes('מקצרת'))).toBe(false);
  });

  it('reports that she turns comments into questions', () => {
    const logs = [
      log({ final_text: 'האם באמת אקראי?' }),
      log({ final_text: 'איזה גודל אפקט?' }),
      log({ final_text: 'קצר.' }),
      log({ final_text: 'קצר.' }),
    ];
    const trait = deriveTraits(logs).find((t) => t.text.includes('שאלה'));
    expect(trait?.evidence).toBe('2 מתוך 4 תיקונים');
  });

  /**
   * The category she gives up on is the one signal that needs the annotation
   * itself, because the log records the wording and not the kind.
   */
  it('names the category she throws away most', () => {
    const logs = [
      log({ action: 'dismissed', final_text: null, target_id: 'a1' }),
      log({ action: 'dismissed', final_text: null, target_id: 'a2' }),
      log({ action: 'dismissed', final_text: null, target_id: 'a3' }),
    ];
    const annotations = [
      annotation('a1', 'formatting'),
      annotation('a2', 'formatting'),
      annotation('a3', 'sources'),
    ];

    const trait = deriveTraits(logs, annotations).find((t) => t.text.includes('מוותרת'));
    expect(trait).toBeTruthy();
    expect(trait!.kind).toBe('formatting');
    expect(trait!.evidence).toBe('2 מתוך 3 הערות שוויתרת עליהן');
  });

  it('ignores dismissals whose comment has since been deleted', () => {
    const logs = [
      log({ action: 'dismissed', final_text: null, target_id: 'gone-1' }),
      log({ action: 'dismissed', final_text: null, target_id: 'gone-2' }),
      log({ action: 'dismissed', final_text: null, target_id: 'gone-3' }),
    ];
    expect(deriveTraits(logs, []).some((t) => t.text.includes('מוותרת'))).toBe(false);
  });
});

describe('the export', () => {
  const examples: TeacherStyleExample[] = [
    {
      id: 'sx1',
      teacher_id: 't1',
      course_id: 'c1',
      source: 'past_feedback',
      student_text: null,
      teacher_text: 'קודם השאלה, אחר כך ההשערה.',
      tags: [],
      active: true,
      created_at: '2026-05-01T09:00:00.000Z',
      updated_at: '2026-05-01T09:00:00.000Z',
    },
    {
      id: 'sx2',
      teacher_id: 't1',
      course_id: 'c1',
      source: 'manual',
      student_text: null,
      teacher_text: 'כבר לא רלוונטי.',
      tags: [],
      active: false,
      created_at: '2026-05-02T09:00:00.000Z',
      updated_at: '2026-05-02T09:00:00.000Z',
    },
  ];

  it('carries both halves of every decision, not a summary of them', () => {
    const logs = [log({ created_at: '2026-08-01T09:00:00.000Z' })];
    const profile = buildStyleProfile({ logs, examples, exportedAt: '2026-08-11T12:00:00.000Z' });

    expect(profile.format).toBe('margin.style-profile');
    expect(profile.decisions.length).toBe(1);
    expect(profile.decisions[0].ai_text).toBe(logs[0].ai_text);
    expect(profile.decisions[0].final_text).toBe(logs[0].final_text);
    expect(profile.decisions[0].action).toBe('edited');
  });

  it('leaves out examples she switched off, and counts only the live ones', () => {
    const profile = buildStyleProfile({
      logs: [],
      examples,
      exportedAt: '2026-08-11T12:00:00.000Z',
    });

    expect(profile.style_examples.map((e) => e.teacher_text)).toEqual([
      'קודם השאלה, אחר כך ההשערה.',
    ]);
    expect(profile.counts.examples).toBe(1);
  });

  it('orders decisions newest first, so the file opens on her latest thinking', () => {
    const logs = [
      log({ created_at: '2026-01-01T09:00:00.000Z', final_text: 'ישן' }),
      log({ created_at: '2026-08-01T09:00:00.000Z', final_text: 'חדש' }),
    ];
    const profile = buildStyleProfile({
      logs,
      examples: [],
      exportedAt: '2026-08-11T12:00:00.000Z',
    });

    expect(profile.decisions.map((d) => d.final_text)).toEqual(['חדש', 'ישן']);
  });

  it('survives a round trip through JSON, which is the only way she will read it', () => {
    const logs = [log()];
    const profile = buildStyleProfile({ logs, examples, exportedAt: '2026-08-11T12:00:00.000Z' });

    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  });
});

describe('countDecisions', () => {
  it('counts each action separately', () => {
    const logs = [
      log({ action: 'accepted' }),
      log({ action: 'accepted' }),
      log({ action: 'edited' }),
      log({ action: 'dismissed', final_text: null }),
    ];
    expect(countDecisions(logs, [])).toEqual({
      accepted: 2,
      edited: 1,
      dismissed: 1,
      examples: 0,
    });
  });
});
