// Which applicant system an apply link runs on, and what that system does with
// an uploaded resume. Vendors publish almost nothing about their parsers, so a
// profile holds only behaviour that is visible in the application flow itself.

export const ATS_IDS = [
  'workday', 'taleo', 'oracle', 'icims', 'successfactors', 'adp', 'ukg',
  'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'bamboohr', 'jobvite',
  'generic',
] as const;

export type AtsId = (typeof ATS_IDS)[number];

export type AtsProfile = {
  name: string;
  hosts: RegExp | null;
  /** Reads the file into application form fields the candidate then confirms. */
  formFill: boolean;
  /** Files content under section headings it matches by exact wording. */
  literalHeadings: boolean;
  asciiOnly: boolean;
  tips: string[];
};

const FORM_TIP = 'reads this file into its application form. After upload, check each job title, employer and date field before you continue. Recruiters filter on those fields.';
const HUMAN_TIP = 'keeps the file you upload and a recruiter reads it as is. It parses the text mainly to fill your contact details and make the resume searchable.';

const formFill = (name: string, hosts: RegExp, extra: string[] = []): AtsProfile => ({
  name, hosts, formFill: true, literalHeadings: true, asciiOnly: false, tips: [`${name} ${FORM_TIP}`, ...extra],
});

const humanRead = (name: string, hosts: RegExp): AtsProfile => ({
  name, hosts, formFill: false, literalHeadings: false, asciiOnly: false, tips: [`${name} ${HUMAN_TIP}`],
});

export const ATS: Record<AtsId, AtsProfile> = {
  workday: formFill('Workday', /(^|\.)(myworkdayjobs|myworkdaysite|workday)\.com$/, [
    'Workday date fields take a month and a year, so every role needs both.',
  ]),
  taleo: {
    ...formFill('Taleo', /(^|\.)taleo\.net$/, [
      'If the application has a paste-your-resume box, paste the text of this copy there as well.',
    ]),
    asciiOnly: true,
  },
  oracle: formFill('Oracle Recruiting', /(^|\.)oraclecloud\.com$/),
  icims: formFill('iCIMS', /(^|\.)icims\.com$/),
  successfactors: formFill('SAP SuccessFactors', /(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu)|jobs2web\.com)$/),
  adp: formFill('ADP', /(^|\.)adp\.com$/),
  ukg: formFill('UKG', /(^|\.)(ultipro|ukg)\.com$/),
  greenhouse: humanRead('Greenhouse', /(^|\.)greenhouse\.io$/),
  lever: humanRead('Lever', /(^|\.)lever\.co$/),
  ashby: humanRead('Ashby', /(^|\.)ashbyhq\.com$/),
  smartrecruiters: humanRead('SmartRecruiters', /(^|\.)smartrecruiters\.com$/),
  workable: humanRead('Workable', /(^|\.)workable\.com$/),
  bamboohr: humanRead('BambooHR', /(^|\.)bamboohr\.com$/),
  jobvite: humanRead('Jobvite', /(^|\.)jobvite\.com$/),
  generic: { name: 'Other or unknown', hosts: null, formFill: false, literalHeadings: false, asciiOnly: false, tips: [] },
};

function atsOfUrl(raw: string): AtsId | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const hit = ATS_IDS.find((id) => ATS[id].hosts?.test(host));
  if (hit) return hit;
  // Greenhouse boards embedded on an employer's own domain keep this parameter.
  return url.searchParams.has('gh_jid') ? 'greenhouse' : null;
}

/** The first link that names a known system wins; pass the apply link first. */
export function detectAts(...urls: (string | null | undefined)[]): AtsId {
  for (const raw of urls) {
    const id = raw ? atsOfUrl(raw) : null;
    if (id) return id;
  }
  return 'generic';
}
