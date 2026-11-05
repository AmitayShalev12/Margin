import {
  ASSISTANT_ACTIONS,
  ASSISTANT_INSTRUCTIONS,
  ASSISTANT_SCHEMA,
  MAX_ACTIONS,
  assistantPrompt,
  parseAssistantPayload,
  requestProblem,
} from '../../../../supabase/functions/_shared/assistant.ts';
import { ACTION_NAMES } from './contract';

/**
 * The assistant's contract with the model.
 *
 * The model proposes; the app disposes. What has to hold here is the first of
 * the two gates: whatever the model sends, only allowlisted actions with
 * well-typed arguments get through to the app.
 */

describe('the action allowlist', () => {
  /** The app build cannot import the server module, so the list is mirrored. */
  it('is the same list on the server and in the app', () => {
    expect(ASSISTANT_ACTIONS.map((a) => a.name)).toEqual([...ACTION_NAMES]);
  });

  it('is what the schema lets the model name', () => {
    const items = ASSISTANT_SCHEMA.properties!['actions'].items!;
    expect(items.properties!['name'].enum).toEqual([...ACTION_NAMES]);
  });

  it('is described to the model, every one of it', () => {
    for (const name of ACTION_NAMES) expect(ASSISTANT_INSTRUCTIONS).toContain(name);
  });
});

describe('reading the model answer', () => {
  it('keeps the reply and the allowlisted actions', () => {
    const parsed = parseAssistantPayload(
      JSON.stringify({
        reply: 'מוסיפה את נועה לשני הקורסים',
        actions: [
          { name: 'add_student', args: { full_name: 'נועה כהן', course_ids: ['c1', 'c2'] } },
        ],
      }),
    );

    expect(parsed).toEqual({
      reply: 'מוסיפה את נועה לשני הקורסים',
      actions: [{ name: 'add_student', args: { full_name: 'נועה כהן', course_ids: ['c1', 'c2'] } }],
    });
  });

  /** An operation the app does not have is never passed along. */
  it('drops an action that is not on the list', () => {
    const parsed = parseAssistantPayload(
      JSON.stringify({
        reply: 'בסדר',
        actions: [
          { name: 'drop_database', args: {} },
          { name: 'open_screen', args: { screen: 'courses' } },
        ],
      }),
    );

    expect(parsed!.actions.map((a) => a.name)).toEqual(['open_screen']);
  });

  it('drops arguments of the wrong type, and arguments it does not know', () => {
    const parsed = parseAssistantPayload(
      JSON.stringify({
        reply: 'בסדר',
        actions: [
          {
            name: 'enroll_student',
            args: { student_id: 42, course_ids: ['c1', 7, ''], sql: 'DROP TABLE students' },
          },
        ],
      }),
    );

    expect(parsed!.actions[0].args).toEqual({ course_ids: ['c1'] });
  });

  it('keeps the file a file action names, and its kind', () => {
    const parsed = parseAssistantPayload(
      JSON.stringify({
        reply: 'בסדר',
        actions: [
          {
            name: 'add_material_from_file',
            args: { file_name: 'סילבוס.docx', material_kind: 'syllabus' },
          },
        ],
      }),
    );

    expect(parsed!.actions[0].args).toEqual({ file_name: 'סילבוס.docx', material_kind: 'syllabus' });
  });

  it(`stops at ${MAX_ACTIONS} actions`, () => {
    const actions = Array.from({ length: 20 }, () => ({
      name: 'open_screen',
      args: { screen: 'home' },
    }));
    const parsed = parseAssistantPayload(JSON.stringify({ reply: 'בסדר', actions }));
    expect(parsed!.actions).toHaveLength(MAX_ACTIONS);
  });

  it('refuses an answer with no reply, or that is not JSON', () => {
    expect(parseAssistantPayload(JSON.stringify({ reply: '  ', actions: [] }))).toBeNull();
    expect(parseAssistantPayload('not json')).toBeNull();
  });
});

describe('what is sent to the model', () => {
  const context = {
    today: '2026-11-03',
    screen: '/home',
    current_course: null,
    courses: [{ id: 'c1', name: 'סמינריון', year: 'תשפ״ז' }],
    students: [
      {
        id: 's1',
        name: 'נועה כהן',
        course_ids: ['c1'],
        papers: 1,
        pending_comments: 3,
        latest_paper_file: 'עבודה.docx',
        latest_paper_status: 'submitted',
      },
    ],
    drive: {
      connection: 'connected',
      course_folder_set: true,
      last_synced_at: null,
      unmatched_files: ['קובץ לא משויך.docx'],
    },
    attached_files: ['מחוון.docx'],
  };

  it('tells the model which files are attached and what Drive looks like', () => {
    const prompt = assistantPrompt({ messages: [{ role: 'user', text: 'שלום' }], context });

    expect(prompt).toContain('מחוון.docx');
    expect(prompt).toContain('קובץ לא משויך.docx');
    expect(prompt).toContain('connected');
  });

  it('carries the facts and the conversation, ending with her', () => {
    const prompt = assistantPrompt({
      messages: [
        { role: 'user', text: 'שלום' },
        { role: 'assistant', text: 'שלום, מה לעשות?' },
        { role: 'user', text: 'לפתוח את העבודה של נועה' },
      ],
      context,
    });

    expect(prompt).toContain('"name":"נועה כהן"');
    expect(prompt.trimEnd().endsWith('TEACHER: לפתוח את העבודה של נועה')).toBe(true);
  });

  it('refuses a request whose last turn is not hers, before any model call', () => {
    expect(requestProblem({ messages: [], context })).toBe('no_message');
    expect(requestProblem({ messages: [{ role: 'assistant', text: 'x' }], context })).toBe(
      'no_message',
    );
    expect(requestProblem({ messages: [{ role: 'user', text: 'שלום' }], context })).toBeNull();
  });

  it('refuses a context far larger than a roster', () => {
    const huge = { ...context, screen: 'x'.repeat(90_000) };
    expect(requestProblem({ messages: [{ role: 'user', text: 'שלום' }], context: huge })).toBe(
      'too_large',
    );
  });
});
