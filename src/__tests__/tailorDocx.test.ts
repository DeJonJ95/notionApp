import PizZip from 'pizzip';
import { tailorDocx } from '@/lib/jobs/docx';

// Build a minimal .docx-shaped zip — tailorDocx only reads word/document.xml,
// so a single-entry zip with realistic paragraph/run XML is enough to exercise
// the paragraph-match + run-rewrite logic without a real Word file.
function makeDocx(paragraphs: string[][]): Buffer {
  const body = paragraphs
    .map(
      (runs) =>
        `<w:p>${runs.map((t) => `<w:r><w:t>${t}</w:t></w:r>`).join('')}</w:p>`,
    )
    .join('');
  const xml =
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
  const zip = new PizZip();
  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
}

function docText(buf: Buffer): string {
  const xml = new PizZip(buf).file('word/document.xml')!.asText();
  return (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
    .map((m) => m.replace(/<[^>]+>/g, ''))
    .join('|');
}

describe('tailorDocx', () => {
  it('replaces a matched paragraph, preserving others', () => {
    const buf = makeDocx([
      ['Led a team of engineers'],
      ['Built internal tooling'],
    ]);
    const { bytes, applied, unmatched } = tailorDocx(buf, [
      { original: 'Led a team of engineers', rewrite: 'Led a cross-functional team of 6 engineers' },
    ]);
    expect(applied).toBe(1);
    expect(unmatched).toHaveLength(0);
    const text = docText(bytes);
    expect(text).toContain('Led a cross-functional team of 6 engineers');
    expect(text).toContain('Built internal tooling');
  });

  it('matches across split runs and collapses them into the rewrite', () => {
    const buf = makeDocx([['Improved ', 'page ', 'load times']]);
    const { bytes, applied } = tailorDocx(buf, [
      { original: 'Improved page load times', rewrite: 'Cut p95 page load times by 40%' },
    ]);
    expect(applied).toBe(1);
    expect(docText(bytes)).toContain('Cut p95 page load times by 40%');
  });

  it('reports tweaks whose original is not present', () => {
    const buf = makeDocx([['Something else entirely']]);
    const { applied, unmatched } = tailorDocx(buf, [
      { original: 'Nonexistent line', rewrite: 'whatever' },
    ]);
    expect(applied).toBe(0);
    expect(unmatched).toHaveLength(1);
  });

  it('escapes XML-special characters in the rewrite', () => {
    const buf = makeDocx([['Worked with R and D']]);
    const { bytes } = tailorDocx(buf, [
      { original: 'Worked with R and D', rewrite: 'Worked with R&D <core> teams' },
    ]);
    const xml = new PizZip(bytes).file('word/document.xml')!.asText();
    expect(xml).toContain('R&amp;D');
    expect(xml).toContain('&lt;core&gt;');
  });
});
