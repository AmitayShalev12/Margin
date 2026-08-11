import { extractFolderId } from './drive-folder';

describe('extractFolderId', () => {
  it('takes the id out of a pasted folder URL', () => {
    expect(extractFolderId('https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0j')).toBe(
      '1A2b3C4d5E6f7G8h9I0j',
    );
  });

  it('ignores query parameters tacked onto the URL', () => {
    expect(
      extractFolderId('https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0j?usp=sharing'),
    ).toBe('1A2b3C4d5E6f7G8h9I0j');
  });

  it('reads the older open?id= form', () => {
    expect(extractFolderId('https://drive.google.com/open?id=1A2b3C4d5E6f7G8h9I0j')).toBe(
      '1A2b3C4d5E6f7G8h9I0j',
    );
  });

  it('accepts a bare id', () => {
    expect(extractFolderId('1A2b3C4d5E6f7G8h9I0j')).toBe('1A2b3C4d5E6f7G8h9I0j');
  });

  it('tolerates surrounding whitespace from a copy-paste', () => {
    expect(extractFolderId('  1A2b3C4d5E6f7G8h9I0j\n')).toBe('1A2b3C4d5E6f7G8h9I0j');
  });

  it('rejects empty or obviously wrong input', () => {
    expect(extractFolderId('')).toBeNull();
    expect(extractFolderId('   ')).toBeNull();
    expect(extractFolderId('התיקייה שלי')).toBeNull();
    expect(extractFolderId('short')).toBeNull();
  });
});
