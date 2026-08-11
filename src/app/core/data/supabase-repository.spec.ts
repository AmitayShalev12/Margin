import { TestBed } from '@angular/core/testing';

import { Annotation, Submission, SubmissionRound } from '../models';
import { SupabaseService } from '../supabase/supabase';
import { SupabaseRepository } from './supabase-repository';

/**
 * The Supabase path can't be exercised against a live project here, so these
 * pin the contract instead: which tables are touched, that writes are upserts
 * on the primary key (so re-syncing a file updates rather than duplicating),
 * and that the records go across as-is with no mapping layer.
 */

interface Call {
  table: string;
  op: 'select' | 'upsert' | 'update';
  row?: unknown;
  onConflict?: string;
  eq?: [string, unknown];
}

class FakeSupabase {
  isConfigured = true;
  calls: Call[] = [];
  /** Rows `select` hands back, keyed by table. */
  rows: Record<string, unknown[]> = {};
  /** Tables whose `update` should report matching no rows. */
  updateMisses = new Set<string>();

  client = {
    from: (table: string) => ({
      select: (_columns: string) => {
        this.calls.push({ table, op: 'select' });
        return Promise.resolve({ data: this.rows[table] ?? [], error: null });
      },
      upsert: (row: unknown, options: { onConflict: string }) => {
        this.calls.push({ table, op: 'upsert', row, onConflict: options.onConflict });
        return Promise.resolve({ error: null });
      },
      update: (row: unknown) => ({
        eq: (column: string, value: unknown) => ({
          select: (_columns: string) => {
            this.calls.push({ table, op: 'update', row, eq: [column, value] });
            return Promise.resolve({
              data: this.updateMisses.has(table) ? [] : [{ id: value }],
              error: null,
            });
          },
        }),
      }),
    }),
  };
}

function makeRepository(supabase: FakeSupabase) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [SupabaseRepository, { provide: SupabaseService, useValue: supabase }],
  });
  return TestBed.inject(SupabaseRepository);
}

const SUBMISSION = {
  id: '11111111-1111-4111-8111-111111111111',
  assignment_id: '22222222-2222-4222-8222-222222222222',
  student_id: '33333333-3333-4333-8333-333333333333',
  status: 'new',
  current_round: 1,
  drive_file_id: 'file-1',
  drive_metadata_raw: { file: { id: 'file-1' } },
} as unknown as Submission;

describe('SupabaseRepository', () => {
  let supabase: FakeSupabase;

  beforeEach(() => {
    supabase = new FakeSupabase();
  });

  it('loads every record set plus the configured folders', async () => {
    const repository = makeRepository(supabase);
    supabase.rows['submissions'] = [SUBMISSION];
    supabase.rows['courses'] = [{ id: 'course-1', drive_folder_id: 'folder-1' }];
    supabase.rows['assignments'] = [{ id: 'assignment-1', drive_folder_id: null }];

    const snapshot = await repository.load();

    expect(supabase.calls.filter((c) => c.op === 'select').map((c) => c.table)).toEqual([
      'submissions',
      'submission_rounds',
      'annotations',
      'courses',
      'assignments',
      'learning_feedback_logs',
      'teacher_style_examples',
    ]);
    expect(snapshot.submissions).toEqual([SUBMISSION]);
    // A course with no folder set must not appear as an empty one.
    expect(snapshot.driveFolders).toEqual({ 'course-1': 'folder-1' });
  });

  it('upserts a submission on its primary key, so a re-sync updates it', async () => {
    const repository = makeRepository(supabase);
    await repository.saveSubmission(SUBMISSION);

    const call = supabase.calls[0];
    expect(call.table).toBe('submissions');
    expect(call.op).toBe('upsert');
    expect(call.onConflict).toBe('id');
    // Sent as-is: the model's field names are the column names.
    expect(call.row).toBe(SUBMISSION);
  });

  it('upserts rounds and annotations the same way', async () => {
    const repository = makeRepository(supabase);
    await repository.saveRound({ id: 'r1' } as unknown as SubmissionRound);
    await repository.saveAnnotation({ id: 'a1' } as unknown as Annotation);

    expect(supabase.calls.map((c) => [c.table, c.op, c.onConflict])).toEqual([
      ['submission_rounds', 'upsert', 'id'],
      ['annotations', 'upsert', 'id'],
    ]);
  });

  it('writes the folder onto the course row', async () => {
    const repository = makeRepository(supabase);
    await repository.saveDriveFolder('course-1', 'folder-9');

    expect(supabase.calls).toEqual([
      {
        table: 'courses',
        op: 'update',
        row: { drive_folder_id: 'folder-9' },
        eq: ['id', 'course-1'],
      },
    ]);
  });

  it('falls back to the assignment row when the id is not a course', async () => {
    const repository = makeRepository(supabase);
    supabase.updateMisses.add('courses');

    await repository.saveDriveFolder('assignment-1', 'folder-9');

    expect(supabase.calls.map((c) => c.table)).toEqual(['courses', 'assignments']);
  });

  it('clears the folder rather than writing an empty string', async () => {
    const repository = makeRepository(supabase);
    await repository.saveDriveFolder('course-1', null);

    expect(supabase.calls[0].row).toEqual({ drive_folder_id: null });
  });

  it('surfaces a write failure instead of losing it', async () => {
    const repository = makeRepository(supabase);
    supabase.client.from = () =>
      ({
        upsert: () => Promise.resolve({ error: { message: 'permission denied' } }),
      }) as never;

    await expect(repository.saveSubmission(SUBMISSION)).rejects.toThrow(/permission denied/);
  });
});
