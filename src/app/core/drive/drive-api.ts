import { Injectable, inject } from '@angular/core';

import { GoogleDriveAuth } from './google-auth';
import { Rgb, isMarker } from './markers';
import {
  DocsBatchUpdateBody,
  DocsDocument,
  DocsRange,
  DriveComment,
  DriveFile,
  DriveFileList,
  DriveRevision,
  DriveRevisionList,
  GOOGLE_DOC_MIME,
} from './drive-types';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_BASE = 'https://docs.googleapis.com/v1';

/** Everything the sync needs about a file, in one `fields` mask. */
const FILE_FIELDS =
  'id,name,mimeType,webViewLink,createdTime,modifiedTime,version,trashed,' +
  // `ownedByMe` is false for a student's own document, which is now the normal
  // case; `shortcutDetails` is how a listing entry admits it is a pointer
  // rather than the work itself.
  'ownedByMe,shortcutDetails(targetId,targetMimeType),' +
  'owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),' +
  'sharingUser(displayName,emailAddress)';

/** Drive caps revision pages at 1000; anything longer is genuinely unusual. */
const REVISION_PAGE_SIZE = 1000;

/** Owner addresses per `sharedWithMe` query, so the URL stays a sane length. */
const OWNER_CHUNK = 12;

/** Student names per query, for the same reason. */
const NAME_CHUNK = 12;

/** Pages of her shared documents the picker will read before stopping. */
const MAX_SHARED_PAGES = 5;

/** What a handed-in paper can be. Anything else shared with her is not one. */
const DOCUMENT_MIMES = [
  GOOGLE_DOC_MIME,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

/**
 * A string literal for a Drive query.
 *
 * Drive's `q` is a small language and these values are addresses and mime
 * types rather than anything a student types — but a stray quote would not
 * fail loudly here, it would change what was asked for, and a query that
 * silently means something else is the exact failure this codebase keeps
 * refusing to leave lying around.
 */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export type DriveErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'insufficient_scope'
  | 'api_disabled'
  | 'not_found'
  | 'network'
  | 'unknown';

/**
 * The API itself is switched off in the Google Cloud project.
 *
 * A newly created OAuth client does not enable any APIs — that is a separate
 * step — and until it is done every single call comes back 403, whatever the
 * folder, whatever the scopes, however correct the account. It is the first
 * thing to suspect when nothing has ever worked, and it looks exactly like a
 * permissions problem if you only read the status code.
 */
const API_DISABLED_REASONS = [
  'accessNotConfigured',
  'has not been used in project',
  'SERVICE_DISABLED',
  'it is disabled',
];

/**
 * Reasons Drive gives for a 403 that mean "this token is too small", as
 * opposed to "this account cannot see that file".
 *
 * The distinction is invisible in the status code — both are 403 — and it is
 * the difference between "reconnect and tick both boxes" and "check who owns
 * the folder". Sending a teacher after the wrong one of those costs an hour.
 */
const SCOPE_REASONS = [
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'insufficientPermissions',
  'insufficientScopes',
  'forbidden: insufficient',
  // Google's human-readable form. It appears in `error.message` even when the
  // structured `reason` is absent or spelled differently, so matching it too
  // keeps a scope refusal from being read as a missing folder.
  'insufficient authentication scopes',
];

function matchesAny(body: string, reasons: string[]): boolean {
  const haystack = body.toLowerCase();
  return reasons.some((reason) => haystack.includes(reason.toLowerCase()));
}

/**
 * The only address in Google's API surface this app may write to.
 *
 * Margin holds the `drive` scope, which permits far more than it does: with
 * that token it *could* rewrite a student's paper, and the only thing standing
 * between the two is code. So the rule is enforced at the one function that
 * issues a non-GET, rather than left as an intention: creating a comment on a
 * file, and nothing else. A Docs `batchUpdate`, a file `PATCH`, a permissions
 * change and a delete are all refused here before a request is built.
 *
 * If a future change needs another kind of write, it has to widen this on
 * purpose, in a diff someone reviews.
 */
const COMMENT_CREATE_URL =
  /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[^/?#]+\/comments(\?|$)/;

export function isCommentCreation(url: string): boolean {
  return COMMENT_CREATE_URL.test(url);
}

/**
 * The Docs endpoint that can insert an *anchored* comment.
 *
 * `documents.batchUpdate` is the most dangerous URL this app could ever call:
 * the same endpoint that inserts a comment also deletes content, replaces text,
 * restyles paragraphs and rewrites tables. Allowing it by URL alone would hand
 * the app every one of those.
 *
 * So the body is inspected, not just the address. A batch is permitted only if
 * every request in it is `insertComment` and nothing else — no `insertText`, no
 * `deleteContentRange`, no `replaceAllText`, no style change. A student's
 * writing cannot be altered through this path, and that is checked here rather
 * than promised in a comment.
 */
const DOCS_BATCH_UPDATE_URL =
  /^https:\/\/docs\.googleapis\.com\/v1\/documents\/[^/?#:]+:batchUpdate(\?|$)/;

/**
 * A batch that may touch the document, and the narrow shape it must have.
 *
 * Margin inserts numbered markers because Google will not anchor a comment.
 * That reverses the rule this file previously enforced outright — so the rule
 * becomes a shape rather than a prohibition, and the shape is checked here on
 * every request before anything is sent.
 *
 * Three kinds are permitted, each bounded so it cannot reach her writing:
 *
 * - `insertText` whose text is **exactly one marker glyph**. Not a sentence,
 *   not a space, not a marker with anything appended.
 * - `updateTextStyle` over **exactly one character**. Colouring a glyph we
 *   just inserted; a range of two could restyle a word of hers.
 * - `deleteContentRange` over **exactly one character**. Removing a marker.
 *   The caller verifies the character *is* a marker by re-reading the document
 *   first — this is the backstop, not the check.
 *
 * `replaceAllText`, paragraph and table operations, image replacement and
 * suggestion handling stay refused outright: none of them can be bounded to a
 * single character, and none is needed.
 */
function isMarkerEdit(request: Record<string, unknown>): boolean {
  const keys = Object.keys(request);
  if (keys.length !== 1) return false;

  const insert = request['insertText'] as { text?: unknown } | undefined;
  if (insert) return typeof insert.text === 'string' && isMarker(insert.text);

  const style = request['updateTextStyle'] as { range?: DocsRange } | undefined;
  if (style) return spansOneCharacter(style.range);

  const remove = request['deleteContentRange'] as { range?: DocsRange } | undefined;
  if (remove) return spansOneCharacter(remove.range);

  return false;
}

function spansOneCharacter(range: DocsRange | undefined): boolean {
  if (!range) return false;
  const { startIndex, endIndex } = range;
  return (
    typeof startIndex === 'number' &&
    typeof endIndex === 'number' &&
    endIndex - startIndex === 1 &&
    startIndex >= 0
  );
}

/**
 * A batch of marker edits, and nothing else.
 *
 * Kept separate from the comment-insert check so neither vouches for the
 * other: a batch is either all comments or all marker edits, and a request
 * that is neither stops the whole batch.
 */
export function isMarkerEditBatch(url: string, body: unknown): boolean {
  if (!DOCS_BATCH_UPDATE_URL.test(url)) return false;

  const requests = (body as { requests?: unknown })?.requests;
  if (!Array.isArray(requests) || requests.length === 0) return false;

  return requests.every(
    (request) =>
      !!request && typeof request === 'object' && isMarkerEdit(request as Record<string, unknown>),
  );
}

export function isAnchoredCommentInsert(url: string, body: unknown): boolean {
  if (!DOCS_BATCH_UPDATE_URL.test(url)) return false;

  const requests = (body as { requests?: unknown })?.requests;
  if (!Array.isArray(requests) || requests.length === 0) return false;

  return requests.every((request) => {
    if (!request || typeof request !== 'object') return false;
    const keys = Object.keys(request as object);
    // Exactly one key, and it is the one kind of change that adds nothing to
    // and removes nothing from the student's text.
    return keys.length === 1 && keys[0] === 'insertComment';
  });
}

/** Thrown rather than sent. Never reaches the network. */
export class DriveWriteRefused extends Error {
  constructor(url: string) {
    super(`Refusing a non-comment write to ${url}`);
    this.name = 'DriveWriteRefused';
  }
}

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }

  /** Hebrew wording for the sync line — she should never see a status code. */
  get hebrew(): string {
    switch (this.kind) {
      case 'unauthorized':
        return 'החיבור לגוגל פג. צריך להתחבר מחדש.';
      case 'forbidden':
        return 'אין הרשאה לתיקייה הזו בחשבון שחיברת.';
      case 'insufficient_scope':
        return 'החיבור לגוגל לא כולל את כל ההרשאות. צריך להתחבר מחדש ולאשר את כל התיבות במסך של גוגל.';
      case 'api_disabled':
        return 'ממשק הדרייב עדיין לא הופעל בפרויקט של גוגל. זו הגדרה חד־פעמית, ואין לזה קשר לתיקייה.';
      case 'not_found':
        return 'לא נמצאה תיקייה עם המזהה הזה.';
      case 'network':
        return 'לא הצלחתי להגיע לגוגל. בדקי את החיבור לאינטרנט.';
      default:
        return 'משהו השתבש בסנכרון מהדרייב.';
    }
  }
}

/**
 * Thin typed wrapper over Drive v3 and Docs v1.
 *
 * Deliberately does no interpretation — it fetches, it types, it throws a
 * `DriveError`. Deciding what a file *means* is the sync service's job.
 */
@Injectable({ providedIn: 'root' })
export class DriveApi {
  private readonly auth = inject(GoogleDriveAuth);

  /** Files directly inside a folder, excluding trashed ones, following pages. */
  async listFolder(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '200',
        // Shared drives are common in schools; without these the query
        // silently returns nothing for a folder that plainly exists.
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const page = await this.get<DriveFileList>(`${DRIVE_BASE}/files?${params}`);
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return files;
  }

  /**
   * Documents a named account has shared directly with the teacher.
   *
   * The second way work arrives. A student who never moves her file into the
   * year folder — who just presses Share and types the teacher's address —
   * produces a document that is nowhere in her Drive: `'folder' in parents`
   * cannot find it, because it genuinely has no parent the teacher can see.
   * `sharedWithMe` is the corpus those files live in, and it is the only way
   * to reach them.
   *
   * Asked **per owner**, never wholesale. "Shared with me" is the teacher's
   * entire shared surface — every memo, every colleague's draft, years of it —
   * and enumerating that on every sync would be both noisy and a great deal
   * more of her Drive than this app has any business reading. Naming the
   * accounts means Drive returns her students' work and nothing else.
   *
   * Chunked because the query is a URL: a class of thirty addresses in one
   * `or` chain is long enough to be refused, and a refusal here would look
   * exactly like "no-one shared anything".
   */
  async listSharedByOwners(emails: readonly string[]): Promise<DriveFile[]> {
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!wanted.length) return [];

    const files: DriveFile[] = [];
    for (let i = 0; i < wanted.length; i += OWNER_CHUNK) {
      const chunk = wanted.slice(i, i + OWNER_CHUNK);
      const owners = chunk.map((email) => `${quote(email)} in owners`).join(' or ');
      files.push(...(await this.listShared(`and (${owners})`)));
    }
    return files;
  }

  /**
   * Shared documents whose name starts with one of these words.
   *
   * The other half of the shared search, and the one that works before any
   * account has been confirmed: students are asked to name their file
   * `שם התלמידה - שם העבודה`, and Drive's `contains` is **prefix** matching on
   * `name` — `name contains 'Hello'` finds `HelloWorld` and not `otherHello`.
   * So the query itself enforces "the name begins with hers", and the strict
   * parse in `file-name.ts` enforces the rest.
   *
   * Chunked for the same reason as the owner query: a class of thirty in one
   * `or` chain makes a URL long enough to be refused, and a refusal here looks
   * exactly like "nobody shared anything".
   */
  async listSharedNamedAfter(prefixes: readonly string[]): Promise<DriveFile[]> {
    const wanted = [...new Set(prefixes.map((p) => p.trim()).filter(Boolean))];
    if (!wanted.length) return [];

    const files: DriveFile[] = [];
    for (let i = 0; i < wanted.length; i += NAME_CHUNK) {
      const names = wanted
        .slice(i, i + NAME_CHUNK)
        .map((prefix) => `name contains ${quote(prefix)}`)
        .join(' or ');
      files.push(...(await this.listShared(`and (${names})`)));
    }
    return files;
  }

  /**
   * Everything shared with her that could be a paper, newest first.
   *
   * The bootstrap case, and the only call that reads her shared surface
   * broadly — so it is never part of a sync. She asks for it, from a screen
   * that says what it is about to look at, in order to point at one document
   * and say whose it is. After that the account is on file and the sync finds
   * that student's work by the narrow query above.
   *
   * Bounded by mime type and by page count rather than trusted to be small.
   */
  async listSharedDocuments(): Promise<DriveFile[]> {
    const kinds = DOCUMENT_MIMES.map((mime) => `mimeType = ${quote(mime)}`).join(' or ');
    return this.listShared(`and (${kinds})`, MAX_SHARED_PAGES);
  }

  /**
   * The `sharedWithMe` corpus, with a caller-supplied narrowing.
   *
   * Written bare — `sharedWithMe`, not `sharedWithMe = true` — which is the
   * form Google's own documentation uses for it.
   */
  private async listShared(clause: string, maxPages = 20): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        q: `sharedWithMe and trashed = false ${clause}`.trim(),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '100',
        // Newest first, so a bounded read returns the term's work rather than
        // whatever happens to sort first.
        orderBy: 'modifiedTime desc',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const page = await this.get<DriveFileList>(`${DRIVE_BASE}/files?${params}`);
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && ++pages < maxPages);

    return files;
  }

  /** Confirms a folder id exists and is really a folder, for the settings UI. */
  async getFolder(folderId: string): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: 'id,name,mimeType',
      supportsAllDrives: 'true',
    });
    return this.get<DriveFile>(`${DRIVE_BASE}/files/${folderId}?${params}`);
  }

  /**
   * One file's metadata, by id.
   *
   * Used to follow a shortcut to the document it points at: the shortcut entry
   * carries only a target id, and everything the sync reasons about — owner,
   * creation time, mime type — belongs to the target.
   */
  async getFile(fileId: string): Promise<DriveFile> {
    const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' });
    return this.get<DriveFile>(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?${params}`);
  }

  /**
   * Revision history as Drive exposes it.
   *
   * Worth being clear-eyed: for Google Docs this is far coarser than the
   * editor's own version history — Drive reports a handful of consolidated
   * revisions, not every keystroke session. Phase 5 has to reason with that,
   * so the raw list is stored untouched and marked when it looks truncated.
   */
  async listRevisions(fileId: string): Promise<{ revisions: DriveRevision[]; truncated: boolean }> {
    const params = new URLSearchParams({
      fields:
        'nextPageToken,revisions(id,modifiedTime,keepForever,size,lastModifyingUser(displayName,emailAddress))',
      pageSize: String(REVISION_PAGE_SIZE),
    });

    try {
      const page = await this.get<DriveRevisionList>(
        `${DRIVE_BASE}/files/${fileId}/revisions?${params}`,
      );
      return { revisions: page.revisions ?? [], truncated: !!page.nextPageToken };
    } catch (error) {
      // A file the teacher can read but does not own often refuses its
      // revision list. That is not a sync failure — the rest of the metadata
      // is still worth having.
      if (
        error instanceof DriveError &&
        (error.kind === 'forbidden' || error.kind === 'not_found')
      ) {
        return { revisions: [], truncated: true };
      }
      throw error;
    }
  }

  /** The structured document, which is where headings survive. */
  async getDocument(documentId: string): Promise<DocsDocument> {
    return this.get<DocsDocument>(`${DOCS_BASE}/documents/${documentId}`);
  }

  /**
   * Inserts comments anchored to real ranges, through the Docs API.
   *
   * The thing the Drive endpoint below cannot do. Drive's `anchor` is stored
   * and then ignored by Workspace editors — Google documents this, and on a
   * Doc the comment renders as *"Original content deleted"*, which reads to a
   * student as though her writing had been removed. This anchors to a
   * `startIndex`/`endIndex` the editor understands.
   *
   * Developer Preview, so it can refuse on an account not enrolled. The caller
   * treats any failure as a reason to fall back rather than as a lost write.
   */
  async insertAnchoredComments(
    documentId: string,
    comments: readonly { content: string; range: DocsRange }[],
  ): Promise<void> {
    if (!comments.length) return;

    const body: DocsBatchUpdateBody = {
      requests: comments.map((c) => ({ insertComment: { content: c.content, range: c.range } })),
    };

    await this.post<unknown>(
      `${DOCS_BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      body,
    );
  }

  /**
   * Inserts marker glyphs and colours them, in one batch.
   *
   * **Back to front.** Every insertion shifts every index after it, so the
   * caller passes positions in the document's own order and this reverses
   * them: inserting at the last position first leaves all the earlier ones
   * exactly where they were measured. Doing it forwards would leave each
   * marker one place further off than the last, and the drift is invisible in
   * a diff — it only shows as a number sitting inside the wrong word.
   *
   * The colouring for each glyph is issued immediately after its insertion,
   * while its index is still known.
   */
  async insertMarkers(
    documentId: string,
    markers: readonly { index: number; glyph: string; colour: Rgb }[],
  ): Promise<void> {
    if (!markers.length) return;

    const requests: unknown[] = [];
    for (const marker of [...markers].sort((a, b) => b.index - a.index)) {
      requests.push({ insertText: { location: { index: marker.index }, text: marker.glyph } });
      requests.push({
        updateTextStyle: {
          range: { startIndex: marker.index, endIndex: marker.index + 1 },
          textStyle: { foregroundColor: { color: { rgbColor: marker.colour } }, bold: true },
          fields: 'foregroundColor,bold',
        },
      });
    }

    await this.post<unknown>(
      `${DOCS_BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      { requests },
    );
  }

  /**
   * Removes marker glyphs, back to front for the same reason.
   *
   * The caller has already re-read the document and confirmed each index holds
   * a marker; the guard here refuses anything spanning more than one character
   * regardless, so a wrong index can cost one glyph and never a sentence.
   */
  async removeMarkers(documentId: string, indexes: readonly number[]): Promise<void> {
    if (!indexes.length) return;

    const requests = [...indexes]
      .sort((a, b) => b - a)
      .map((index) => ({
        deleteContentRange: { range: { startIndex: index, endIndex: index + 1 } },
      }));

    await this.post<unknown>(
      `${DOCS_BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      { requests },
    );
  }

  /**
   * Posts one comment to a file. The unanchored fallback.
   *
   * **Deliberately unanchored.** Drive's `comments.create` takes an `anchor`,
   * and on a Google Doc it is a trap: the API stores it and returns it happily,
   * but Workspace editors treat such comments as unanchored, and the Docs UI
   * renders them as *"Original content deleted"* — no highlight, and a line
   * that reads to a student as though her writing had been removed. Google
   * documents this ("the anchor is saved and returned … however Google
   * Workspace editor apps treat these comments as un-anchored comments") and it
   * is open as issuetracker.google.com/issues/491884714. There is no public API
   * on Drive or Docs that produces a genuinely anchored comment.
   *
   * So the anchor is carried where it survives: the quoted sentence is the
   * first line of the comment body. It is unanchored on purpose, and sending an
   * anchor would be strictly worse than not.
   */
  async createComment(fileId: string, content: string): Promise<DriveComment> {
    const params = new URLSearchParams({ fields: 'id,createdTime,content' });
    return this.post<DriveComment>(
      `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments?${params}`,
      // The whole payload. No `anchor`, and nothing that touches the document.
      { content },
    );
  }

  /**
   * The single write path, gated on the URL before anything is sent.
   *
   * The guard is here and not at the call site so that adding a method to this
   * class cannot quietly acquire the ability to modify a document: any other
   * target throws without touching the network.
   */
  private async post<T>(url: string, body: object): Promise<T> {
    // Two permitted writes, and nothing else reaches the network.
    if (
      !isCommentCreation(url) &&
      !isAnchoredCommentInsert(url, body) &&
      !isMarkerEditBatch(url, body)
    ) {
      throw new DriveWriteRefused(url);
    }

    const token = await this.auth.accessToken();
    if (!token) throw new DriveError('unauthorized', 'No Drive access token');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new DriveError('network', String(cause));
    }

    if (response.ok) return (await response.json()) as T;
    throw this.failure(response, await response.text().catch(() => ''));
  }

  private async get<T>(url: string): Promise<T> {
    // Minted server-side per request window; never read from browser storage.
    const token = await this.auth.accessToken();
    if (!token) throw new DriveError('unauthorized', 'No Drive access token');

    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (cause) {
      throw new DriveError('network', String(cause));
    }

    if (response.ok) return (await response.json()) as T;

    // Read the body. Google explains a 403 in it, and that explanation is the
    // only thing separating a permission she never granted from a folder she
    // genuinely cannot see.
    throw this.failure(response, await response.text().catch(() => ''));
  }

  /** Shared by both paths, so a failed post is classified as carefully as a read. */
  private failure(response: Response, body: string): DriveError {
    if (response.status === 401) {
      // The token aged out mid-sync; stop offering it.
      this.auth.invalidate();
      return new DriveError('unauthorized', 'Drive rejected the token', 401);
    }

    let kind: DriveErrorKind = 'unknown';
    if (response.status === 403) {
      // Order matters: a disabled API refuses everything, so it has to be
      // ruled out before blaming the token or the folder.
      kind = matchesAny(body, API_DISABLED_REASONS)
        ? 'api_disabled'
        : matchesAny(body, SCOPE_REASONS)
          ? 'insufficient_scope'
          : 'forbidden';
    } else if (response.status === 404) {
      kind = 'not_found';
    }

    return new DriveError(
      kind,
      `Drive request failed (${response.status}) ${body.slice(0, 300)}`,
      response.status,
    );
  }
}
