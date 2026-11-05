import { normaliseName } from '../drive/file-name';
import { Course, Student } from '../models';

export interface SearchResult {
  id: string;
  kind: 'student' | 'course';
  title: string;
  /** Second line: where this result leads. */
  detail: string;
  link: string;
  queryParams?: Record<string, string>;
}

export interface SearchSource {
  courses: readonly Course[];
  students: readonly Student[];
  /** The selected year, and which of its courses a student is in. */
  coursesInYear: readonly Course[];
  studentsIn(courseId: string): readonly Student[];
}

/**
 * One function per kind of thing she can find. Adding a kind means adding a
 * function to this list; the box and its dropdown do not change.
 */
const SEARCHES: ((query: string, source: SearchSource) => SearchResult[])[] = [
  function courses(query, source) {
    return source.courses
      .filter((c) => normaliseName(c.name).includes(query))
      .map((c) => ({
        id: `course:${c.id}`,
        kind: 'course' as const,
        title: c.name,
        detail: `קורס · ${c.year}`,
        link: `/courses/${c.id}`,
      }));
  },
  function students(query, source) {
    return source.students
      .filter((s) => normaliseName(s.full_name).includes(query))
      .flatMap((student) => {
        const hers = source.coursesInYear.filter((c) =>
          source.studentsIn(c.id).some((s) => s.id === student.id),
        );
        // In no course this year: the overview is where she can still be found.
        if (!hers.length) {
          return [
            {
              id: `student:${student.id}`,
              kind: 'student' as const,
              title: student.full_name,
              detail: 'התלמידות שלי',
              link: '/students',
            },
          ];
        }
        return hers.map((course) => ({
          id: `student:${student.id}:${course.id}`,
          kind: 'student' as const,
          title: student.full_name,
          detail: course.name,
          link: `/courses/${course.id}/students`,
          queryParams: { q: student.full_name },
        }));
      });
  },
];

const MAX_RESULTS = 12;

export function search(text: string, source: SearchSource): SearchResult[] {
  const query = normaliseName(text);
  if (!query) return [];
  return SEARCHES.flatMap((run) => run(query, source)).slice(0, MAX_RESULTS);
}
