/**
 * The slices of the Google Drive v3 and Google Docs v1 responses this app
 * actually reads. Deliberately partial — every field is optional because the
 * APIs only return what you ask for in `fields`, and a missing field must
 * never be a crash.
 */

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
/** A pointer to a file that lives elsewhere — not the work itself. */
export const GOOGLE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

// ---------------------------------------------------------------------------
// Drive v3
// ---------------------------------------------------------------------------

export interface DriveUser {
  displayName?: string;
  emailAddress?: string;
}

export interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  /** False for a student's own document — the normal case now. */
  ownedByMe?: boolean;
  /**
   * Set only when this entry is a shortcut rather than a document.
   *
   * A student can put her work in the teacher's folder two ways: move the file
   * in, or add a shortcut to it. The folder listing looks the same either way,
   * but a shortcut is its own file with its own mime type — followed blindly it
   * produces a submission with no text at all, and no error to say why.
   */
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  /** Monotonic counter Drive bumps on every change. */
  version?: string;
  trashed?: boolean;
  owners?: DriveUser[];
  lastModifyingUser?: DriveUser;
  sharingUser?: DriveUser;
}

export interface DriveFileList {
  files?: DriveFile[];
  nextPageToken?: string;
}

export interface DriveRevision {
  id: string;
  modifiedTime?: string;
  lastModifyingUser?: DriveUser;
  keepForever?: boolean;
  size?: string;
}

export interface DriveRevisionList {
  revisions?: DriveRevision[];
  nextPageToken?: string;
}

/**
 * Everything the sync captured about a file, stored verbatim on
 * `Submission.drive_metadata_raw`.
 *
 * Phase 5 analyses this; Phase 3 only records it. Keeping the untouched API
 * payloads means the reliability checks can be written — and rewritten —
 * without re-syncing every document.
 */
export interface DriveMetadataSnapshot {
  captured_at: string;
  file: DriveFile;
  revisions: DriveRevision[];
  /**
   * True when Drive returned a partial revision history. For Google Docs the
   * API exposes far less than the editor's own version history, so a short
   * list here is a limit of the API, not evidence about the document.
   */
  revisions_truncated: boolean;
}

// ---------------------------------------------------------------------------
// Docs v1 — only the structural pieces we walk
// ---------------------------------------------------------------------------

export interface DocsTextRun {
  content?: string;
}

export interface DocsParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: DocsTextRun;
}

export interface DocsParagraph {
  elements?: DocsParagraphElement[];
  paragraphStyle?: { namedStyleType?: string };
  /** Present when the paragraph is a list item. */
  bullet?: { listId?: string; nestingLevel?: number };
}

export interface DocsTableCell {
  content?: DocsStructuralElement[];
}

export interface DocsTable {
  tableRows?: { tableCells?: DocsTableCell[] }[];
}

export interface DocsStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: DocsParagraph;
  table?: DocsTable;
  sectionBreak?: unknown;
  tableOfContents?: { content?: DocsStructuralElement[] };
}

/** A span of the document, as the Docs API addresses it. */
export interface DocsRange {
  startIndex: number;
  endIndex: number;
  segmentId?: string;
}

/**
 * The only `documents.batchUpdate` request this app is permitted to send.
 *
 * Docs gained comment insertion where the Drive API never had it: this anchors
 * to a real range rather than to the opaque string Workspace editors ignore.
 * Developer Preview at the time of writing.
 */
export interface InsertCommentRequest {
  insertComment: {
    content: string;
    range: DocsRange;
  };
}

export interface DocsBatchUpdateBody {
  requests: InsertCommentRequest[];
}

export interface DocsDocument {
  documentId?: string;
  title?: string;
  revisionId?: string;
  body?: { content?: DocsStructuralElement[] };
}

/**
 * A comment as Drive returns it. Only the id is load-bearing — it goes on the
 * annotation so a second send knows this one is already out there.
 */
export interface DriveComment {
  id?: string;
  createdTime?: string;
  content?: string;
}
