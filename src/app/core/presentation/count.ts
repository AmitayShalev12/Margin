import { Pipe, PipeTransform } from '@angular/core';

/**
 * A number and its noun, said the way Hebrew says it.
 *
 * "1 קבצים שנקלטו" is what `${n} קבצים שנקלטו` produces when n is 1, and it is
 * wrong three times over: the noun, the number word and the verb all change
 * ("קובץ אחד שנקלט"). Gender decides the number word too — קובץ אחד, but
 * הערה אחת — and two takes the construct form ("שני קבצים", "שתי הערות"),
 * which reads far more naturally than "2 קבצים".
 *
 * So `one` and `two` are whole phrases, written out by whoever knows what the
 * sentence says; this only picks between them. `many` marks where the number
 * goes with `#`, because in a verb-first sentence the number is not at the
 * start: "נמצאו # הערות" → "נמצאו 7 הערות", "נמצאה הערה אחת".
 *
 * This is the convention the careful parts of the app already followed by hand
 * — `commentsWaiting`, the review screen's `commentCount`, the Drive folder's
 * unmatched-files line. Named, so the next count gets it right by default.
 */
export interface CountForms {
  one: string;
  /** Optional: without it, two is said like any other number. */
  two?: string;
  /** Must contain `#`, where the number goes. */
  many: string;
}

export function count(n: number, forms: CountForms): string {
  if (n === 1) return forms.one;
  if (n === 2 && forms.two) return forms.two;
  return forms.many.replace('#', String(n));
}

/**
 * `count()` for templates.
 *
 *   {{ row.files | count: 'קובץ אחד שנקלט' : '# קבצים שנקלטו' : 'שני קבצים שנקלטו' }}
 *
 * Argument order is one, many, two — `two` last because it is the optional one.
 */
@Pipe({ name: 'count' })
export class CountPipe implements PipeTransform {
  transform(n: number, one: string, many: string, two?: string): string {
    return count(n, { one, many, two });
  }
}
