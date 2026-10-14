/** @jest-environment node */
import mammoth from 'mammoth';
import { tailorDocx } from '@/lib/jobs/docx';
import { docxBlocks, textBlocks, partBlocks } from '@/lib/jobs/docxBlocks';
import { plainDocx } from '@/lib/jobs/plainDocx';
import { atsReport, docxHazards } from '@/lib/jobs/atsCheck';
import { makeResumeDocx, documentXml, para, run } from './fixtures/resumeDocx';

describe('tailorDocx on a Word-shaped resume', () => {
  it('rewrites only the quoted span and keeps the bold run before it', () => {
    const { bytes, applied } = tailorDocx(makeResumeDocx(), [
      { original: 'migration to Postgres', rewrite: 'migration to PostgreSQL' },
    ]);
    expect(applied).toBe(1);
    const xml = documentXml(bytes);
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Led the </w:t>');
    expect(xml).toContain('migration to PostgreSQL</w:t>');
    expect(xml).toContain(' for billing.</w:t>');
  });

  it('does not double the closing period', () => {
    const { bytes } = tailorDocx(makeResumeDocx(), [
      { original: 'Built React dashboards used by 40 analysts', rewrite: 'Built React and TypeScript dashboards used by 40 analysts.' },
    ]);
    expect(documentXml(bytes)).toContain('used by 40 analysts.</w:t>');
    expect(documentXml(bytes)).not.toContain('analysts..');
  });

  it('rewrites text-box content in both copies Word keeps', () => {
    const { bytes, applied } = tailorDocx(makeResumeDocx(), [
      { original: 'React, TypeScript, Node.js, SQL', rewrite: 'React, TypeScript, Node.js, SQL, PostgreSQL' },
    ]);
    expect(applied).toBe(1);
    expect(documentXml(bytes).match(/SQL, PostgreSQL/g)).toHaveLength(2);
  });
});

describe('docxBlocks', () => {
  const blocks = docxBlocks(makeResumeDocx());
  const texts = blocks.map((b) => b.text);

  it('moves header contact under the name and reads text boxes once', () => {
    expect(texts.slice(0, 2)).toEqual(['Jane Doe', 'jane@example.com | (555) 123-4567']);
    expect(texts.filter((t) => t.includes('TypeScript'))).toHaveLength(1);
  });

  it('turns tabs and single-line table rows into one line', () => {
    expect(texts).toContain('Acme Corp | 2020 – 2023');
    expect(texts).toContain('Globex | 2018 – 2020');
  });

  it('tags headings and bullets', () => {
    const kind = (t: string) => blocks.find((b) => b.text === t)?.kind;
    expect(kind('EXPERIENCE')).toBe('heading');
    expect(kind('SKILLS')).toBe('heading');
    expect(kind('Education')).toBe('heading');
    expect(kind('Led the migration to Postgres for billing.')).toBe('bullet');
    expect(kind('Jane Doe')).toBe('para');
  });

  it('skips page numbers in the header', () => {
    const b = docxBlocks(makeResumeDocx(undefined, para(run('Page 1 of 2'))));
    expect(b.map((x) => x.text)).not.toContain('Page 1 of 2');
  });
});

describe('textBlocks (PDF text)', () => {
  it('joins wrapped bullets and finds headings', () => {
    const blocks = textBlocks('Jane Doe\nEXPERIENCE\n• Built dashboards used by\nanalysts across sales\n• Led migration\n2');
    expect(blocks).toEqual([
      { kind: 'para', text: 'Jane Doe' },
      { kind: 'heading', text: 'EXPERIENCE' },
      { kind: 'bullet', text: 'Built dashboards used by analysts across sales' },
      { kind: 'bullet', text: 'Led migration' },
    ]);
  });
});

describe('plainDocx', () => {
  it('produces a hazard-free file that reads back with every line', async () => {
    const blocks = docxBlocks(makeResumeDocx());
    const out = plainDocx(blocks);
    expect(docxHazards(out)).toEqual([]);
    const raw = (await mammoth.extractRawText({ buffer: out })).value;
    blocks.forEach((b) => expect(raw).toContain(b.text));
    const xml = documentXml(out);
    expect(partBlocks(xml).slice(1).map((b) => b.kind)).toEqual(blocks.slice(1).map((b) => b.kind));
    expect(xml).toContain('<w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">Jane Doe');
  });
});

describe('ATS report', () => {
  it('finds every layout risk in the styled file', () => {
    expect(docxHazards(makeResumeDocx()).map((h) => h.id).sort()).toEqual(['columns', 'headerContact', 'tables', 'textBoxes']);
  });

  it('measures keywords, title, contact and sections on the extracted text', () => {
    const report = atsReport(docxBlocks(makeResumeDocx()), {
      title: 'Senior Frontend Engineer',
      keywords: ['React', 'TypeScript', 'GraphQL', 'Node.js', 'PostgreSQL'],
    });
    expect(report.keywords).toEqual({ matched: ['React', 'TypeScript', 'Node.js'], missing: ['GraphQL', 'PostgreSQL'] });
    expect(report.title).toEqual({ text: 'Frontend Engineer', found: false });
    expect(report.contact).toEqual({ email: true, phone: true });
    expect(report.sections).toEqual({ experience: true, education: true, skills: true });
  });
});
