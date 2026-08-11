import { Injectable, inject } from '@angular/core';

import { GoogleDriveAuth } from './google-auth';
import {
  DocsDocument,
  DriveFile,
  DriveFileList,
  DriveRevision,
  DriveRevisionList,
} from './drive-types';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_BASE = 'https://docs.googleapis.com/v1';

/** Everything the sync needs about a file, in one `fields` mask. */
const FILE_FIELDS =
  'id,name,mimeType,webViewLink,createdTime,modifiedTime,version,trashed,' +
  'owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),' +
  'sharingUser(displayName,emailAddress)';

/** Drive caps revision pages at 1000; anything longer is genuinely unusual. */
const REVISION_PAGE_SIZE = 1000;

export type DriveErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'network' | 'unknown';

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

  /** Confirms a folder id exists and is really a folder, for the settings UI. */
  async getFolder(folderId: string): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: 'id,name,mimeType',
      supportsAllDrives: 'true',
    });
    return this.get<DriveFile>(`${DRIVE_BASE}/files/${folderId}?${params}`);
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

    if (response.status === 401) {
      // The token aged out mid-sync; stop offering it.
      this.auth.invalidate();
      throw new DriveError('unauthorized', 'Drive rejected the token', 401);
    }

    const kind: DriveErrorKind =
      response.status === 403 ? 'forbidden' : response.status === 404 ? 'not_found' : 'unknown';
    throw new DriveError(kind, `Drive request failed (${response.status})`, response.status);
  }
}
