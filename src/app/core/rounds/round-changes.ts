import { Annotation, SubmissionRound, UUID } from '../models';

/**
 * What a corrected version changed, read against the version before it.
 *
 * Text only, with no model behind it. It answers the two things she would
 * otherwise reread the whole paper for: which paragraphs are new or rewritten,
 * and for each note she gave last time, whether the sentence it was about is
 * still there word for word.
 */

export interface EarlierNote {
  id: UUID;
  body: string;
  quote: string;
  kind: Annotation['kind'];
  /**
   * `changed`: the sentence is no longer in the paper as it was.
   * `same`: it is still there, word for word.
   */
  state: 'changed' | 'same';
}

export interface RoundChanges {
  /** Paragraphs of the new version that were not in the earlier one. */
  changedBlockIds: ReadonlySet<string>;
  notes: EarlierNote[];
  /** How many of the notes had their sentence changed. */
  handled: number;
}

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

export function roundChanges(
  previous: SubmissionRound | undefined,
  current: SubmissionRound | undefined,
  annotations: readonly Annotation[],
): RoundChanges | null {
  if (!previous || !current || previous.id === current.id) return null;

  const before = new Set((previous.document_blocks ?? []).map((b) => squeeze(b.text)));
  const changedBlockIds = new Set<string>();
  // With nothing to compare against, calling every paragraph new would be noise.
  if (before.size) {
    for (const block of current.document_blocks ?? []) {
      if (block.type !== 'heading' && !before.has(squeeze(block.text))) {
        changedBlockIds.add(block.id);
      }
    }
  }

  const text = squeeze(current.document_text ?? '');
  const notes = annotations
    .filter(
      (a) =>
        a.round_id === previous.id &&
        (a.status === 'accepted' || a.status === 'edited' || a.status === 'resolved') &&
        // Praise asks for nothing, so there is nothing to have handled.
        a.kind !== 'praise' &&
        a.anchor.quote.trim().length > 0,
    )
    .sort(
      (a, b) => a.anchor.block_index - b.anchor.block_index || a.anchor.start - b.anchor.start,
    )
    .map<EarlierNote>((a) => ({
      id: a.id,
      body: a.body,
      quote: a.anchor.quote,
      kind: a.kind,
      state: text.includes(squeeze(a.anchor.quote)) ? 'same' : 'changed',
    }));

  return {
    changedBlockIds,
    notes,
    handled: notes.filter((n) => n.state === 'changed').length,
  };
}
