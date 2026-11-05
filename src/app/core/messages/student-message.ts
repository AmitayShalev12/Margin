import { dayOf, dualDateText, hebrewParts } from '../dates/hebrew-date';
import { Assignment } from '../models';

/** A slot she fills in herself. Nothing is written here for her. */
export interface MessageTemplate {
  id: string;
  teacher_id: string;
  slot: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export const TEMPLATE_SLOTS = 5;

export interface MessageInput {
  name: string;
  templateBody: string;
  tasks: readonly Assignment[];
  handedIn: ReadonlySet<string>;
  /** The task this paper belongs to, which is where she is now. */
  currentTaskId: string;
  today: string;
  link: string | null;
}

/** The first date still ahead of today. */
export function nextDeadline(tasks: readonly Assignment[], today: string): Assignment | null {
  const dated = tasks
    .filter((t) => (dayOf(t.due_at) ?? '') >= today && !!dayOf(t.due_at))
    .sort((a, b) => dayOf(a.due_at)!.localeCompare(dayOf(b.due_at)!));
  return dated[0] ?? null;
}

/** Stages in order, marking what is done, where she is, and what comes next. */
export function processText(input: MessageInput): string {
  return input.tasks
    .map((task, index) => {
      const mark = input.handedIn.has(task.id)
        ? task.id === input.currentTaskId
          ? '← את כאן'
          : '✓'
        : 'בהמשך';
      const date = dualDateText(task.due_at);
      return `${index + 1}. ${task.title}${date ? `, ${date}` : ''} ${mark}`;
    })
    .join('\n');
}

/**
 * The whole message, in the order the requirements set: the next deadline first,
 * then her name and that she has corrections, the template, the process, the link.
 */
export function buildMessage(input: MessageInput): string {
  const next = nextDeadline(input.tasks, input.today);
  const month = hebrewParts(input.today)?.month;
  const parts = [
    next ? `המועד הבא: ${next.title}, ${dualDateText(next.due_at)}` : '',
    `שלום ${input.name},\nהעבודה שלך נבדקה ויש בה תיקונים.`,
    input.templateBody.trim(),
    input.tasks.length
      ? `${month ? `אנחנו בחודש ${month}. ` : ''}כך נראה התהליך:\n${processText(input)}`
      : '',
    input.link ? `העבודה עם ההערות: ${input.link}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

/** Long `mailto:` links are cut off by some mail apps, so this is reported, never silent. */
export const SAFE_MAILTO_LENGTH = 1800;

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
