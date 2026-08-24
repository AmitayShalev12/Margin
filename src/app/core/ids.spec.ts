import { derivedId, newId } from './ids';

/**
 * Every `id` column in the schema is `uuid`. An id that is merely unique is
 * not enough — Postgres rejects it outright, and because writes are
 * fire-and-forget the record stays on screen looking saved.
 *
 * That is exactly how `sub-<driveFileId>` survived: it was unique, readable,
 * and unwritable.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('produces something Postgres will accept as a uuid', () => {
    for (let i = 0; i < 50; i++) expect(newId()).toMatch(UUID);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });
});

describe('derivedId', () => {
  const FILE = '1ktTA9r30I79FDEbe1L7lbUFZWNC6JLvKTKN37tT1C0E';

  it('produces something Postgres will accept as a uuid', () => {
    expect(derivedId('submission', FILE)).toMatch(UUID);
    expect(derivedId('round', 'x:1')).toMatch(UUID);
  });

  /**
   * The whole reason it is derived rather than random: `submissions` is unique
   * on `drive_file_id`. A second device syncing the same folder has to land on
   * the same row, or the upsert hits that index instead of updating.
   */
  it('gives the same Drive file the same id every time', () => {
    expect(derivedId('submission', FILE)).toBe(derivedId('submission', FILE));
  });

  it('separates different files, rounds and namespaces', () => {
    const ids = new Set([
      derivedId('submission', FILE),
      derivedId('submission', `${FILE}x`),
      derivedId('round', FILE),
      derivedId('round', `${FILE}:1`),
      derivedId('round', `${FILE}:2`),
    ]);
    expect(ids.size).toBe(5);
  });

  it('does not collide across a folder full of files', () => {
    const ids = new Set(
      Array.from({ length: 2000 }, (_, i) => derivedId('submission', `1ktTA9r30I79FDEbe1L7lb${i}`)),
    );
    expect(ids.size).toBe(2000);
  });

  it('marks itself as derived rather than random', () => {
    // Version nibble 5: a reader can tell these from newId()'s v4 at a glance.
    expect(derivedId('submission', FILE).charAt(14)).toBe('5');
  });
});
