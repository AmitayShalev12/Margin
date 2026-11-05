import { Injectable, inject } from '@angular/core';

import { GoogleDriveAuth } from './google-auth';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_NAME = 'גיבויים של Margin';

/** Marks what this class created, so it finds its own and nothing of hers. */
const MARK = 'marginBackup';

/**
 * The only write the backup may make: a new file, carrying the mark.
 *
 * `DriveApi` refuses every write that is not a comment, because the app holds
 * the full `drive` scope over students' papers. Backups sit outside it, so they
 * get their own rule, as strict: no file id in the address means no existing
 * file can be altered, whatever the body says.
 */
export function isBackupCreation(url: string, metadata: Record<string, unknown>): boolean {
  const allowed = url === FILES_URL || url === UPLOAD_URL;
  const marked = !!(metadata['appProperties'] as Record<string, string> | undefined)?.[MARK];
  return allowed && marked && !('id' in metadata);
}

export class DriveBackupError extends Error {
  constructor(readonly status: number) {
    super(`Drive backup failed: ${status}`);
    this.name = 'DriveBackupError';
  }
}

/**
 * Daily copies in a folder of her own Drive.
 *
 * Her Drive because it survives anything that happens to the Supabase project,
 * and because the files stay in her account rather than a new place holding
 * students' work. The folder is created in her My Drive, unshared.
 *
 * Old copies are left for her to delete: removing one would need a second kind
 * of write, and a backup that can erase backups is the wrong thing to build.
 */
@Injectable({ providedIn: 'root' })
export class DriveBackup {
  private readonly auth = inject(GoogleDriveAuth);

  /** When the newest backup was made, or null when there is none. */
  async latest(): Promise<string | null> {
    const found = await this.search<{ createdTime: string }>('file', 'createdTime');
    return found?.createdTime ?? null;
  }

  async upload(name: string, json: string): Promise<void> {
    const folder = await this.folder();
    const metadata = { name, parents: [folder], appProperties: { [MARK]: 'file' } };
    const boundary = `margin-${crypto.randomUUID()}`;
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      `${json}\r\n--${boundary}--`;

    await this.create(UPLOAD_URL, metadata, body, `multipart/related; boundary=${boundary}`);
  }

  private async folder(): Promise<string> {
    const existing = await this.search<{ id: string }>('folder', 'id');
    if (existing) return existing.id;

    const metadata = { name: FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { [MARK]: 'folder' } };
    const created = await this.create(
      FILES_URL,
      metadata,
      JSON.stringify(metadata),
      'application/json',
    );
    return created.id;
  }

  private async create(
    url: string,
    metadata: Record<string, unknown>,
    body: string,
    contentType: string,
  ): Promise<{ id: string }> {
    if (!isBackupCreation(url, metadata)) throw new DriveBackupError(0);

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: await this.bearer(), 'content-type': contentType },
      body,
    });
    if (!response.ok) throw new DriveBackupError(response.status);
    return (await response.json()) as { id: string };
  }

  private async search<T>(kind: 'file' | 'folder', field: string): Promise<T | null> {
    const params = new URLSearchParams({
      q: `appProperties has { key='${MARK}' and value='${kind}' } and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize: '1',
      fields: `files(${field})`,
    });

    const response = await fetch(`${FILES_URL}?${params}`, {
      headers: { Authorization: await this.bearer() },
    });
    if (!response.ok) throw new DriveBackupError(response.status);
    const { files } = (await response.json()) as { files?: T[] };
    return files?.[0] ?? null;
  }

  private async bearer(): Promise<string> {
    const token = await this.auth.accessToken();
    if (!token) throw new DriveBackupError(401);
    return `Bearer ${token}`;
  }
}
