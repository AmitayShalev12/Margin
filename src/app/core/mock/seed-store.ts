import { DataStore } from '../data/data-store';
import { EMPTY_SNAPSHOT, PersistedSnapshot } from '../data/repository';
import * as seed from './seed-data';

/**
 * The demonstration records, installed into a store. **Tests only.**
 *
 * `seed-data.ts` used to be the app's starting state: a fictional course, a
 * fictional class and their marked-up papers were on screen before anyone
 * signed in. They looked exactly like real records — the names rendered, the
 * AI prompt quoted them, the store handed them out — and every write against
 * one was refused, because Postgres had never heard of them. Nothing in
 * `src/app` imports the fixtures now; the app starts empty and holds only what
 * she made or what came out of her Drive.
 *
 * The fixtures are still worth keeping, because a review screen with no
 * comments on it tests very little. They go in through `applySnapshot` — the
 * same path a real load takes — so a spec cannot pass against merge rules the
 * app does not actually use.
 */
export function fixtureSnapshot(): PersistedSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    courses: [seed.COURSE],
    assignments: [seed.ASSIGNMENT],
    students: seed.STUDENTS,
    courseRules: seed.COURSE_RULES,
    courseMaterials: seed.COURSE_MATERIALS,
    submissions: seed.SUBMISSIONS,
    rounds: seed.ROUNDS,
    annotations: seed.ANNOTATIONS,
    feedbackLogs: seed.FEEDBACK_LOGS,
    styleExamples: seed.STYLE_EXAMPLES,
  };
}

/** Puts the fixture course, roster and reviewed papers on screen. */
export function seedStore(store: DataStore): void {
  store.applySnapshot(fixtureSnapshot());
}
