import {
  checkJoin,
  folderIdFromLink,
  linkIsOpen,
  matchExisting,
} from '../../../../supabase/functions/_shared/join.ts';
import { isFolderLink } from '../../features/join/join';
import { expiryFor, isActive } from './join-links';

const FOLDER = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp';
const good = {
  full_name: 'דנה לוי',
  mobile: '050-1234567',
  email: 'dana@example.com',
  folder_url: FOLDER,
};

describe('join rules', () => {
  it('accepts only real Drive folder links, the same on both sides', () => {
    const cases: [string, boolean][] = [
      [FOLDER, true],
      ['https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp?usp=sharing', true],
      ['https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp', true],
      ['https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit', false],
      ['drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp', false],
      ['https://evil.example/drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp', false],
      ['not a link', false],
    ];
    for (const [link, ok] of cases) {
      expect(!!folderIdFromLink(link), link).toBe(ok);
      expect(isFolderLink(link), link).toBe(ok);
    }
    expect(folderIdFromLink(FOLDER)).toBe('1AbCdEfGhIjKlMnOp');
  });

  it('needs name, mobile, email and folder; the rest may be blank', () => {
    expect(checkJoin(good).ok).toBe(true);
    const missing = checkJoin({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(Object.keys(missing.errors).sort()).toEqual(['email', 'folder_url', 'full_name', 'mobile']);
    }
  });

  it('rejects bad values and anything too long, and drops unknown fields', () => {
    const bad = checkJoin({
      ...good,
      email: 'nope',
      id_number: '12a',
      mobile: 'call me',
      address: 'x'.repeat(1000),
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toEqual({
        email: 'invalid',
        id_number: 'invalid',
        mobile: 'invalid',
        address: 'too_long',
      });
    }
    const extra = checkJoin({ ...good, teacher_id: 'someone', full_name: '  דנה לוי  ' });
    expect(extra.ok && extra.values).toEqual(expect.objectContaining({ full_name: 'דנה לוי' }));
    expect(extra.ok && 'teacher_id' in extra.values).toBe(false);
  });

  it('a link is open only before it expires, before it is closed, and under its cap', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const link = { expires_at: '2026-11-11T12:00:00Z', closed_at: null, submissions: 0, max_submissions: 100 };
    expect(linkIsOpen(link, now)).toBe(true);
    expect(linkIsOpen({ ...link, expires_at: '2026-11-10T11:00:00Z' }, now)).toBe(false);
    expect(linkIsOpen({ ...link, closed_at: '2026-11-10T10:00:00Z' }, now)).toBe(false);
    expect(linkIsOpen({ ...link, submissions: 100 }, now)).toBe(false);
  });

  it('finds her by ID number, else email, else name', () => {
    const roster = [
      { id: 'by-id', full_name: 'אחרת', email: null, id_number: '123456789' },
      { id: 'by-email', full_name: 'עוד אחת', email: 'Dana@Example.com', id_number: null },
      { id: 'by-name', full_name: 'דנה  לוי', email: null, id_number: null },
    ];
    const values = (extra: object) => {
      const result = checkJoin({ ...good, ...extra });
      if (!result.ok) throw new Error('fixture should be valid');
      return result.values;
    };
    expect(matchExisting(values({ id_number: '123456789' }), roster)).toBe('by-id');
    expect(matchExisting(values({}), roster)).toBe('by-email');
    expect(matchExisting(values({ email: 'other@example.com' }), roster)).toBe('by-name');
    expect(matchExisting(values({ email: 'other@example.com', full_name: 'מישהי חדשה' }), roster)).toBeNull();
  });

  it('works out when a new link closes', () => {
    const now = new Date('2026-11-10T12:00:00');
    expect(expiryFor('day', '', now)?.getTime()).toBe(now.getTime() + 86_400_000);
    expect(expiryFor('week', '', now)?.getTime()).toBe(now.getTime() + 7 * 86_400_000);
    expect(expiryFor('date', '2026-12-01', now)?.toISOString()).toBe(new Date('2026-12-01T23:59:59').toISOString());
    expect(expiryFor('date', '2026-11-01', now)).toBeNull();
    expect(expiryFor('date', '', now)).toBeNull();
    const link = { id: '1', token: 't', course_id: 'c', created_at: '', expires_at: '2026-11-11T00:00:00', max_submissions: 100, submissions: 3, closed_at: null };
    expect(isActive(link, now)).toBe(true);
    expect(isActive({ ...link, closed_at: 'x' }, now)).toBe(false);
  });
});
