import { ANNOTATIONS, DOCUMENT_BLOCKS } from './seed-data';

/**
 * The seed builds anchors by locating each quote in its block, so a typo in
 * either the document text or a quote silently produces a comment pointing at
 * the wrong words. These lock that down.
 */
describe('seed data anchors', () => {
  it('anchors every annotation to text that is actually there', () => {
    for (const a of ANNOTATIONS) {
      const block = DOCUMENT_BLOCKS.find((b) => b.id === a.anchor.block_id);
      expect(block).toBeTruthy();
      expect(block!.text.slice(a.anchor.start, a.anchor.end)).toBe(a.anchor.quote);
    }
  });

  it('records the block index the anchor claims', () => {
    for (const a of ANNOTATIONS) {
      const block = DOCUMENT_BLOCKS.find((b) => b.id === a.anchor.block_id)!;
      expect(a.anchor.block_index).toBe(block.index);
    }
  });

  it('keeps the AI original whenever the teacher edited a comment', () => {
    for (const a of ANNOTATIONS.filter((x) => x.status === 'edited')) {
      expect(a.edited_by_teacher).toBe(true);
      expect(a.ai_body).toBeTruthy();
      expect(a.ai_body).not.toBe(a.body);
    }
  });

  it('stamps the round on resolved comments only', () => {
    for (const a of ANNOTATIONS) {
      if (a.status === 'resolved') expect(a.resolved_in_round).toBe(2);
      else expect(a.resolved_in_round).toBeNull();
    }
  });
});
