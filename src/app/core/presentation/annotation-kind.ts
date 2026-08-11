import { AnnotationKind, AnnotationStatus } from '../models';

/**
 * The Hebrew label for each comment category. These are the words the teacher
 * sees — short enough to sit in a legend chip at 375px.
 */
export const KIND_LABEL: Record<AnnotationKind, string> = {
  language: 'ניסוח',
  structure: 'מבנה',
  sources: 'מקורות',
  content: 'תוכן',
  praise: 'חיזוק',
  formatting: 'טכני',
  other: 'אחר',
};

/**
 * The five categories shown in the review legend. `formatting` and `other`
 * exist in the model but are rare enough that listing them would only add
 * noise to the legend.
 */
export const LEGEND_KINDS: readonly AnnotationKind[] = [
  'language',
  'structure',
  'sources',
  'content',
  'praise',
];

/** Class carrying the category's custom properties — see `_categories.scss`. */
export function kindClass(kind: AnnotationKind): string {
  return `kind-${kind}`;
}

/**
 * How each state of a comment is described to the teacher. Deliberately in
 * her voice and in the first person ("אישרת"), not as a status code.
 */
export const ANNOTATION_STATE_LABEL: Record<AnnotationStatus, string> = {
  pending: 'ממתין להחלטה שלך',
  accepted: 'אישרת',
  edited: 'ערכת',
  resolved: 'טופל בסבב הזה',
  dismissed: 'הוסר',
};
