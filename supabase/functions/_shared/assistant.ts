/**
 * The assistant's contract with the model — pure, so it can be tested from
 * the app's own suite the way the annotation adapter is.
 *
 * The model never performs anything. It answers in a fixed shape: a reply in
 * Hebrew, and a list of actions drawn from the allowlist below. The app runs
 * each action itself, as the signed-in teacher, through the same store
 * methods her buttons use — so the database's row-level security applies to
 * it exactly as it does to a click — and reports what actually happened. The
 * model cannot invent an operation, and cannot claim one succeeded.
 *
 * Structured output rather than function calling: the Interactions API's
 * schema-constrained JSON is what this app already runs in production for
 * drafting comments, and it fits a single round trip — the app holds every
 * fact the model needs to choose an action, and sends them with the request.
 */
import type { JsonSchema } from './gemini.ts';

/** Every operation the assistant may ask for. Nothing outside this list runs. */
export const ASSISTANT_ACTIONS = [
  {
    name: 'open_screen',
    args: ['screen'],
    description:
      'Open one of the main screens. screen is one of: home, students, submissions, courses, grading-forms, style.',
  },
  {
    name: 'open_student_work',
    args: ['student_id'],
    description: "Open a student's most recent paper in the review screen.",
  },
  {
    name: 'add_student',
    args: ['full_name', 'email', 'course_ids'],
    description:
      'Add a new student to the roster, once, and enroll her in every course in course_ids (may be empty). email is optional.',
  },
  {
    name: 'enroll_student',
    args: ['student_id', 'course_ids'],
    description: 'Enroll an existing student in more courses.',
  },
  {
    name: 'unenroll_student',
    args: ['student_id', 'course_ids'],
    description: 'Take a student out of courses. She stays on the roster.',
  },
  {
    name: 'create_course',
    args: ['course_name', 'year'],
    description: 'Create a new course (e.g. year "תשפ״ז"). It becomes the current course.',
  },
  {
    name: 'select_course',
    args: ['course_id'],
    description: 'Switch the current course.',
  },
  {
    name: 'add_course_rule',
    args: ['text'],
    description:
      "Add one of the teacher's own marking rules to the current course (it guides future drafted comments).",
  },
  {
    name: 'set_comment_tone',
    args: ['tone'],
    description:
      'Set how gently comments are worded in the current course. tone is one of: gentle, balanced, direct.',
  },
  {
    name: 'set_student_folder',
    args: ['student_id', 'folder_url'],
    description: "Set a student's Google Drive folder from a folder link the teacher gave.",
  },
  {
    name: 'draft_comments',
    args: ['student_id'],
    description:
      "Draft comments on a student's most recent paper with the AI drafting pass. Takes a minute or two.",
  },
  {
    name: 'delete_student',
    args: ['student_id'],
    description:
      'Remove a student and all her papers. The app asks the teacher to confirm before anything is deleted.',
  },
] as const;

export type AssistantActionName = (typeof ASSISTANT_ACTIONS)[number]['name'];

export const SCREENS = [
  'home',
  'students',
  'submissions',
  'courses',
  'grading-forms',
  'style',
] as const;
export const TONES = ['gentle', 'balanced', 'direct'] as const;

export interface AssistantActionArgs {
  screen?: string;
  student_id?: string;
  full_name?: string;
  email?: string;
  course_ids?: string[];
  course_id?: string;
  course_name?: string;
  year?: string;
  text?: string;
  tone?: string;
  folder_url?: string;
}

export interface AssistantAction {
  name: AssistantActionName;
  args: AssistantActionArgs;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** What the app knows, sent with each request. Names and ids — never papers. */
export interface AssistantContext {
  today: string;
  screen: string;
  current_course: { id: string; name: string; year: string } | null;
  courses: { id: string; name: string; year: string }[];
  students: {
    id: string;
    name: string;
    course_ids: string[];
    papers: number;
    pending_comments: number;
  }[];
}

export interface AssistantRequest {
  messages: AssistantTurn[];
  context: AssistantContext;
}

/** At most this many actions in one answer; a request for more is not a chat. */
export const MAX_ACTIONS = 6;
/** The conversation sent with each request, newest last. */
export const MAX_TURNS = 12;
const MAX_TURN_CHARS = 4000;

const STRING_ARGS = [
  'screen',
  'student_id',
  'full_name',
  'email',
  'course_id',
  'course_name',
  'year',
  'text',
  'tone',
  'folder_url',
] as const;

/**
 * The shape the model must answer in. Every argument is optional — an action
 * carries only the ones it uses — so nothing here needs `nullable`.
 */
export const ASSISTANT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ASSISTANT_ACTIONS.map((a) => a.name) },
          args: {
            type: 'object',
            properties: {
              ...Object.fromEntries(STRING_ARGS.map((key) => [key, { type: 'string' }])),
              course_ids: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        required: ['name'],
      },
    },
  },
  required: ['reply', 'actions'],
};

export const ASSISTANT_INSTRUCTIONS = `
You are the assistant inside Margin, an app a Hebrew-speaking teacher uses to review her B.Ed
students' seminar papers. You help her by doing things in the app, not by explaining how to do them.

How you act:
- To do something, put it in "actions". The app performs each action itself and shows her whether it
  succeeded or failed. So in "reply", say what you are doing ("מוסיפה את נועה לשני הקורסים"), never
  that it is already done, and never invent an outcome.
- Use only the actions listed below, and only ids that appear in the context. Never make up an id.
- Match names loosely (spelling, missing surname), but if a name could be two different students or
  courses, ask which one instead of acting.
- If she asks something the context answers (who has comments waiting, which courses exist), answer
  it in "reply" with no actions.
- If she asks for something no action can do, say so plainly in one sentence and suggest the nearest
  thing you can do.
- Several actions in one answer are fine when she asked for several things.

How you write:
- Hebrew only, addressed to her in the feminine second person (את), short and plain. One or two
  sentences. No exclamation marks, no flattery.
- Students are female (תלמידה, תלמידות).

Actions:
${ASSISTANT_ACTIONS.map((a) => `- ${a.name}(${a.args.join(', ')}): ${a.description}`).join('\n')}
`.trim();

/** The request as the model reads it: the facts, then the conversation. */
export function assistantPrompt(request: AssistantRequest): string {
  const turns = request.messages
    .slice(-MAX_TURNS)
    .map(
      (t) => `${t.role === 'user' ? 'TEACHER' : 'ASSISTANT'}: ${t.text.slice(0, MAX_TURN_CHARS)}`,
    )
    .join('\n\n');

  return [
    '# What the app knows right now',
    JSON.stringify(request.context),
    '',
    '# The conversation (answer the last TEACHER message)',
    turns,
  ].join('\n');
}

/**
 * Checks an incoming request before any model call is spent on it.
 * Returns the reason it is unusable, or null.
 */
export function requestProblem(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'bad_request';
  const { messages, context } = body as Partial<AssistantRequest>;
  if (!Array.isArray(messages) || messages.length === 0) return 'no_message';
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.text !== 'string' || !last.text.trim()) {
    return 'no_message';
  }
  if (!context || typeof context !== 'object') return 'bad_request';
  // A roster of a few dozen girls is a few kilobytes; far past that is not a
  // roster, and would spend her quota on padding.
  if (JSON.stringify(context).length > 80_000) return 'too_large';
  return null;
}

export type AssistantPayload = { reply: string; actions: AssistantAction[] };

/**
 * The model's answer, reduced to what the app will act on.
 *
 * Actions with a name outside the allowlist are dropped, as are arguments of
 * the wrong type; an answer with no usable reply is refused. The client
 * validates again against her actual records before running anything — this
 * is the first of two checks, not the only one.
 */
export function parseAssistantPayload(text: string): AssistantPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const reply = (raw as { reply?: unknown }).reply;
  if (typeof reply !== 'string' || !reply.trim()) return null;

  const allowed = new Set<string>(ASSISTANT_ACTIONS.map((a) => a.name));
  const list = (raw as { actions?: unknown }).actions;
  const actions: AssistantAction[] = [];

  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const { name, args } = item as { name?: unknown; args?: unknown };
    if (typeof name !== 'string' || !allowed.has(name)) continue;

    const clean: AssistantActionArgs = {};
    const source = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    for (const key of STRING_ARGS) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
    }
    if (Array.isArray(source['course_ids'])) {
      clean.course_ids = (source['course_ids'] as unknown[]).filter(
        (v): v is string => typeof v === 'string' && !!v.trim(),
      );
    }

    actions.push({ name: name as AssistantActionName, args: clean });
    if (actions.length === MAX_ACTIONS) break;
  }

  return { reply: reply.trim(), actions };
}
