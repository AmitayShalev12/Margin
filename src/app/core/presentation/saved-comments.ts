import { Annotation, AnnotationKind } from '../models';

/**
 * Notes she wrote before, offered again while she writes a new one.
 *
 * There is no list to keep and no screen to manage: anything she wrote herself
 * or rewrote in her own words is already a saved comment. The ones she used
 * most come first, the ones of the kind she is writing before the others, and
 * typing narrows them.
 */
export function savedComments(
  annotations: readonly Annotation[],
  typed: string,
  kind: AnnotationKind,
  limit = 4,
): string[] {
  const used = new Map<string, { count: number; sameKind: boolean }>();

  for (const a of annotations) {
    const hers = a.origin === 'teacher' || a.edited_by_teacher;
    const body = a.body.trim();
    if (!hers || a.status === 'dismissed' || !body) continue;
    const entry = used.get(body) ?? { count: 0, sameKind: false };
    entry.count++;
    entry.sameKind ||= a.kind === kind;
    used.set(body, entry);
  }

  const needle = typed.trim();
  return [...used.entries()]
    .filter(([body]) => body !== needle && (needle.length < 2 || body.includes(needle)))
    .sort(
      ([, a], [, b]) => Number(b.sameKind) - Number(a.sameKind) || b.count - a.count,
    )
    .slice(0, limit)
    .map(([body]) => body);
}
