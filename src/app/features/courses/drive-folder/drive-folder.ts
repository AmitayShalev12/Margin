import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { GoogleDriveAuth } from '../../../core/drive/google-auth';
import { SyncService } from '../../../core/drive/sync';
import { relativeDay } from '../../../core/presentation/submission-status';

/**
 * Connecting Google Drive and pointing the course at a folder.
 *
 * It sits on the course screen because that is where the rest of "what this
 * course is made of" lives, and it stays one card: connect, name a folder,
 * and a line saying when work last came in.
 */
@Component({
  selector: 'app-drive-folder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drive-folder.html',
  styleUrl: './drive-folder.scss',
})
export class DriveFolder {
  private readonly store = inject(DataStore);
  private readonly sync = inject(SyncService);
  protected readonly auth = inject(GoogleDriveAuth);

  protected readonly folderId = computed(() => this.store.course().drive_folder_id);
  protected readonly syncState = this.store.sync;

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly checking = signal(false);
  protected readonly checkError = signal<string | null>(null);

  protected readonly supabaseReady = this.auth.canConnect;
  protected readonly connecting = this.auth.busy;
  protected readonly googleEmail = this.auth.googleEmail;

  protected readonly lastSyncedLabel = computed(() => {
    const at = this.syncState().last_synced_at;
    if (!at) return 'עדיין לא סונכרן';
    const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
    if (minutes < 1) return 'סונכרן הרגע';
    if (minutes < 60) return `סונכרן לפני ${minutes} דקות`;
    return `סונכרן ${relativeDay(at)}`;
  });

  constructor() {
    // The connection lives on the server, so the card asks rather than
    // reading anything local. Also picks up the ?drive=connected redirect
    // Google sends us back with.
    void this.auth.refreshStatus().then(() => this.clearRedirectParams());
  }

  protected connect() {
    void this.auth.connect();
  }

  protected disconnect() {
    void this.auth.disconnect();
  }

  protected startEdit() {
    this.draft.set(this.folderId() ?? '');
    this.checkError.set(null);
    this.editing.set(true);
  }

  protected cancelEdit() {
    this.editing.set(false);
    this.checkError.set(null);
  }

  /**
   * Checks the folder exists before saving it. A mistyped id that silently
   * saved would look identical to an empty folder, and she would have no way
   * to tell which it was.
   */
  protected async save() {
    const id = extractFolderId(this.draft());
    if (!id) {
      this.checkError.set('צריך להדביק כאן קישור לתיקייה בדרייב, או את המזהה שלה.');
      return;
    }

    this.checking.set(true);
    this.checkError.set(null);

    const result = await this.sync.describeFolder(id);
    this.checking.set(false);

    if ('error' in result) {
      this.checkError.set(result.error);
      return;
    }

    this.store.setDriveFolder(this.store.course().id, id);
    this.editing.set(false);
    void this.sync.syncNow();
  }

  protected async syncNow() {
    await this.sync.syncNow();
  }

  /** Tidies `?drive=connected` out of the address bar after the round trip. */
  private clearRedirectParams() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('drive')) return;
    url.searchParams.delete('drive');
    url.searchParams.delete('drive_error');
    window.history.replaceState({}, '', url.toString());
  }
}

/**
 * Accepts either a bare folder id or a pasted Drive URL. Teachers copy the
 * address bar, not the id — asking them to extract it themselves is the kind
 * of small cruelty that makes a tool feel hostile.
 */
export function extractFolderId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const fromUrl = /\/folders\/([a-zA-Z0-9_-]+)/.exec(text);
  if (fromUrl) return fromUrl[1];

  const fromQuery = /[?&]id=([a-zA-Z0-9_-]+)/.exec(text);
  if (fromQuery) return fromQuery[1];

  // A bare id: Drive ids are long, opaque and have no spaces or slashes.
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;

  return null;
}
