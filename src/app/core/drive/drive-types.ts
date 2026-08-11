/**
 * The slices of the Google Drive v3 and Google Docs v1 responses this app
 * actually reads. Deliberately partial — every field is optional because the
 * APIs only return what you ask for in `fields`, and a missing field must
 * never be a crash.
 */

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

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

export interface DocsDocument {
  documentId?: string;
  title?: string;
  revisionId?: string;
  body?: { content?: DocsStructuralElement[] };
}
