import { readZipParts } from './zip';

export interface SheetCell {
  text: string;
  /** Stored by Excel as a number, which is how a real date cell arrives. */
  numeric: boolean;
}

export class SheetError extends Error {
  constructor(readonly hebrew: string) {
    super(hebrew);
    this.name = 'SheetError';
  }
}

function columnIndex(ref: string): number {
  let index = 0;
  for (const letter of ref.replace(/\d/g, '')) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

/** The first sheet of an Excel file, as rows of cells. */
export async function readSheet(data: ArrayBuffer): Promise<SheetCell[][]> {
  let parts: Map<string, string>;
  try {
    parts = await readZipParts(data, ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);
  } catch {
    throw new SheetError('הקובץ לא נפתח. צריך קובץ Excel מסוג .xlsx.');
  }
  const sheet = parts.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new SheetError('לא מצאתי גיליון בקובץ. צריך קובץ Excel מסוג .xlsx.');

  const parser = new DOMParser();
  const textOf = (element: Element) =>
    [...element.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
  const shared = [
    ...parser
      .parseFromString(parts.get('xl/sharedStrings.xml') ?? '<sst/>', 'application/xml')
      .getElementsByTagName('si'),
  ].map(textOf);

  return [...parser.parseFromString(sheet, 'application/xml').getElementsByTagName('row')].map(
    (row) => {
      const cells: SheetCell[] = [];
      for (const cell of row.getElementsByTagName('c')) {
        const type = cell.getAttribute('t');
        const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
        const text =
          type === 's' ? (shared[Number(raw)] ?? '') : type === 'inlineStr' ? textOf(cell) : raw;
        cells[columnIndex(cell.getAttribute('r') ?? 'A')] = {
          text,
          numeric: !type || type === 'n',
        };
      }
      return cells;
    },
  );
}
