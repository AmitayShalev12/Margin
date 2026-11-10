/**
 * The public sign-up form's rules, kept free of Deno APIs so the app's tests
 * can check the same code the `join` function runs.
 */

export const JOIN_FIELDS = [
  'full_name',
  'id_number',
  'mobile',
  'phone',
  'email',
  'address',
  'pedagogic_year',
  'track',
  'department',
  'folder_url',
] as const;

export type JoinField = (typeof JOIN_FIELDS)[number];
export type JoinValues = Record<JoinField, string>;

export const REQUIRED: readonly JoinField[] = ['full_name', 'mobile', 'email', 'folder_url'];

const MAX_LENGTH: Record<JoinField, number> = {
  full_name: 80,
  id_number: 12,
  mobile: 20,
  phone: 20,
  email: 120,
  address: 160,
  pedagogic_year: 20,
  track: 60,
  department: 60,
  folder_url: 300,
};

/** A Drive folder link's id, or null. Only real folder links count. */
export function folderIdFromLink(value: string): string | null {
  const text = value.trim();
  const match =
    text.match(/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/) ??
    text.match(/^https:\/\/drive\.google\.com\/(?:open|folderview)\?(?:.*&)?id=([A-Za-z0-9_-]{10,})/);
  return match?.[1] ?? null;
}

export type JoinCheck =
  | { ok: true; values: JoinValues; folderId: string }
  | { ok: false; errors: Partial<Record<JoinField, string>> };

/** Trims, length-checks and validates what arrived. Anything else is dropped. */
export function checkJoin(input: unknown): JoinCheck {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const values = {} as JoinValues;
  const errors: Partial<Record<JoinField, string>> = {};

  for (const field of JOIN_FIELDS) {
    const value = typeof raw[field] === 'string' ? (raw[field] as string).trim() : '';
    values[field] = value;
    if (value.length > MAX_LENGTH[field]) errors[field] = 'too_long';
    else if (!value && REQUIRED.includes(field)) errors[field] = 'required';
  }

  if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) errors.email = 'invalid';
  if (values.id_number && !/^\d{5,9}$/.test(values.id_number)) errors.id_number = 'invalid';
  for (const field of ['mobile', 'phone'] as const) {
    if (values[field] && !/^[\d\s+()-]{7,20}$/.test(values[field])) errors[field] = 'invalid';
  }
  const folderId = values.folder_url ? folderIdFromLink(values.folder_url) : null;
  if (values.folder_url && !folderId) errors.folder_url = 'invalid';

  return Object.keys(errors).length || !folderId
    ? { ok: false, errors }
    : { ok: true, values, folderId };
}

export interface JoinLinkRow {
  expires_at: string;
  closed_at: string | null;
  submissions: number;
  max_submissions: number;
}

export function linkIsOpen(link: JoinLinkRow, now: Date = new Date()): boolean {
  return (
    !link.closed_at &&
    new Date(link.expires_at).getTime() > now.getTime() &&
    link.submissions < link.max_submissions
  );
}

const normaliseName = (text: string) =>
  text.toLowerCase().replace(/['’׳״"]/g, '').replace(/\s+/g, ' ').trim();

export interface RosterRow {
  id: string;
  full_name: string;
  email: string | null;
  id_number: string | null;
}

/** Same ID number, else same email, else same name: who she already is, if anyone. */
export function matchExisting(values: JoinValues, roster: readonly RosterRow[]): string | null {
  if (values.id_number) {
    const byId = roster.find((r) => r.id_number && r.id_number === values.id_number);
    if (byId) return byId.id;
  }
  const email = values.email.toLowerCase();
  const byEmail = roster.find((r) => r.email && r.email.toLowerCase() === email);
  if (byEmail) return byEmail.id;
  const name = normaliseName(values.full_name);
  return roster.find((r) => normaliseName(r.full_name) === name)?.id ?? null;
}
