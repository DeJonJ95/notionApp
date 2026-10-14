// Writes the ATS-safe resume: one column, no tables, text boxes, images,
// header or footer, real Word headings and real list bullets in a standard
// font. Every parser reads this the same way, which is the whole point.

import PizZip from 'pizzip';
import { looksLikeName, type Block } from './docxBlocks';
import { escapeXml } from './xmlText';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CONTENT_TYPES = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;

const ROOT_RELS = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/></Relationships>`;

const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>';

const STYLES = `${XML_HEAD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="000000"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:after="40"/></w:pPr></w:style></w:styles>`;

const NUMBERING = `${XML_HEAD}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr>${FONT}</w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const SECTION = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>';

function paragraph(text: string, style?: string): string {
  const list = style === 'ListBullet' ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '';
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/>${list}</w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

const STYLE_FOR: Record<Block['kind'], string | undefined> = { heading: 'Heading1', bullet: 'ListBullet', para: undefined };

/** The name is the first line, when it reads like one; it becomes the Title. */
function nameIndex(blocks: Block[]): number {
  const first = blocks.findIndex((b) => b.kind !== 'heading');
  const firstHeading = blocks.findIndex((b) => b.kind === 'heading');
  if (firstHeading >= 0 && firstHeading < first) return -1;
  return looksLikeName(blocks[first]) ? first : -1;
}

export function plainDocx(blocks: Block[]): Buffer {
  const name = nameIndex(blocks);
  const body = blocks
    .map((b, i) => paragraph(b.text, i === name ? 'Title' : STYLE_FOR[b.kind]))
    .join('');
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/numbering.xml', NUMBERING);
  zip.file('word/document.xml', `${XML_HEAD}<w:document ${NS}><w:body>${body}${SECTION}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
