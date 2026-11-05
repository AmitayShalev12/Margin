/**
 * The app's side of the `assistant` Edge Function contract.
 *
 * Mirrors `supabase/functions/_shared/assistant.ts`, which the app build
 * cannot import (it is Deno source). `assistant.spec.ts` checks the two action
 * lists are identical, so a new action cannot be added on one side only.
 */

export const ACTION_NAMES = [
  'open_screen',
  'open_student_work',
  'add_student',
  'enroll_student',
  'unenroll_student',
  'create_course',
  'select_course',
  'add_course_rule',
  'set_comment_tone',
  'set_student_folder',
  'draft_comments',
  'delete_student',
  'delete_paper',
  'sync_drive',
  'connect_drive',
  'set_course_folder',
  'post_comments_to_document',
  'add_paper_from_file',
  'add_material_from_file',
  'add_rubric_from_file',
  'add_style_from_file',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export interface ActionArgs {
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
  file_name?: string;
  material_kind?: string;
}

export interface ProposedAction {
  name: ActionName;
  args: ActionArgs;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantContext {
  today: string;
  screen: string;
  current_course: {
    id: string;
    name: string;
    year: string;
    tone: string;
    rubric_criteria: number;
  } | null;
  courses: { id: string; name: string; year: string }[];
  students: {
    id: string;
    name: string;
    course_ids: string[];
    papers: number;
    pending_comments: number;
    latest_paper_file: string | null;
    latest_paper_status: string | null;
  }[];
  drive: {
    connection: string;
    course_folder_set: boolean;
    last_synced_at: string | null;
    unmatched_files: string[];
  };
  /** Files she attached in this conversation: names only, never contents. */
  attached_files: string[];
}

export interface AssistantResponse {
  reply: string;
  actions: ProposedAction[];
  key_source?: 'teacher' | 'shared';
}
