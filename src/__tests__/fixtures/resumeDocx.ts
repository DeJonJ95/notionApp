import PizZip from 'pizzip';

// A Word-shaped resume carrying the layouts ATS parsers trip on: contact
// details in the page header, a table row, a text box (with the VML fallback
// copy Word writes), a two-column section, tabs and split formatted runs.

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
].join(' ');

export const run = (t: string, bold = false) =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
export const para = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
export const bullet = (t: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(t)}</w:p>`;

const textBox = (lines: string[]) => {
  const inner = lines.map((l) => para(run(l))).join('');
  return `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx></wps:wsp></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
};

export const BODY = [
  para(run('Jane Doe')),
  para(run('EXPERIENCE', true)),
  para(run('Acme Corp', true), '<w:r><w:tab/></w:r>', run('2020 – 2023')),
  bullet('Built React dashboards used by 40 analysts.'),
  `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>${run('Led the ', true)}${run('migration to Postgres')}${run(' for billing.')}</w:p>`,
  `<w:tbl><w:tr><w:tc>${para(run('Globex'))}</w:tc><w:tc>${para(run('2018 – 2020'))}</w:tc></w:tr></w:tbl>`,
  bullet('Maintained Node.js services'),
  textBox(['SKILLS', 'React, TypeScript, Node.js, SQL']),
  para(run('Education')),
  para(run('B.S. Computer Science, State University')),
  '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:cols w:num="2" w:space="720"/></w:sectPr>',
].join('');

export function makeResumeDocx(body = BODY, header = para(run('jane@example.com | (555) 123-4567'))): Buffer {
  const rels = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rels}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH" Type="${rels}/header" Target="header1.xml"/></Relationships>`);
  zip.file('word/header1.xml', `<?xml version="1.0"?><w:hdr ${NS}>${header}</w:hdr>`);
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
}

export function documentXml(buf: Buffer): string {
  return new PizZip(buf).file('word/document.xml')!.asText();
}
