import { AnnotationKind } from '../models';
import { KIND_LABEL, kindClass } from '../presentation/annotation-kind';
import { GENERATED_KINDS } from './contract';

/**
 * The model may only produce categories the review screen can already render.
 * `GENERATED_KINDS` is the single source of truth: the client sends it as
 * `allowed_kinds`, and the Edge Function builds its JSON-schema enum from what
 * it receives rather than keeping a copy — so there is nothing here to drift.
 */
describe('generated annotation kinds', () => {
  it('covers every kind the app models — no invented categories, none missing', () => {
    const modelled = Object.keys(KIND_LABEL) as AnnotationKind[];
    expect([...GENERATED_KINDS].sort()).toEqual([...modelled].sort());
  });

  it('includes the two neutral kinds alongside the five coloured ones', () => {
    expect(GENERATED_KINDS).toContain('formatting');
    expect(GENERATED_KINDS).toContain('other');
  });

  it('every kind maps to a label and a colour class the review screen uses', () => {
    for (const kind of GENERATED_KINDS) {
      expect(KIND_LABEL[kind]).toBeTruthy();
      expect(kindClass(kind)).toBe(`kind-${kind}`);
    }
  });
});
