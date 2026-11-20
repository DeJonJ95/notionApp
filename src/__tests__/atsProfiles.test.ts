import { detectAts } from '@/lib/jobs/atsProfiles';
import { shapeForAts } from '@/lib/jobs/atsShape';
import { tailorFromText } from '@/lib/jobs/tailorRun';
import type { Block } from '@/lib/jobs/docxBlocks';

describe('detectAts', () => {
  it.each([
    ['https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R1', 'workday'],
    ['https://boards.greenhouse.io/acme/jobs/123', 'greenhouse'],
    ['https://job-boards.greenhouse.io/acme/jobs/123', 'greenhouse'],
    ['https://careers.acme.com/open-roles?gh_jid=555', 'greenhouse'],
    ['https://jobs.lever.co/acme/abc', 'lever'],
    ['https://careers-acme.icims.com/jobs/1/job', 'icims'],
    ['https://acme.taleo.net/careersection/2/jobdetail.ftl?job=1', 'taleo'],
    ['https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1', 'oracle'],
    ['https://career5.successfactors.eu/career?company=acme', 'successfactors'],
    ['https://jobs.ashbyhq.com/acme/1', 'ashby'],
    ['https://notworkday.com.example.org/job', 'generic'],
    ['not a url', 'generic'],
  ])('%s is %s', (url, id) => expect(detectAts(url)).toBe(id));

  it('falls through a listing link to the apply link behind it', () => {
    expect(detectAts(null, 'https://hiring.cafe/job/1', 'https://jobs.lever.co/acme/1')).toBe('lever');
  });
});

const resume: Block[] = [
  { kind: 'para', text: 'Ada Lovelace' },
  { kind: 'heading', text: 'Career History:' },
  { kind: 'para', text: 'Engineer | Acme | Jan 2020 – Current' },
  { kind: 'para', text: 'Analyst | Initech | 2015–2019' },
  { kind: 'bullet', text: 'Led “Project X” — shipped to 3 teams' },
  { kind: 'heading', text: 'Core Competencies' },
  { kind: 'heading', text: 'Volunteer Experience' },
];

describe('shapeForAts', () => {
  it('leaves the generic copy untouched', () => {
    const out = shapeForAts(resume, 'generic');
    expect(out.blocks).toEqual(resume);
    expect(out.changes).toEqual([]);
    expect(out.yearOnlyDates).toBe(0);
  });

  it('uses standard headings and one date spelling for a form-filling system', () => {
    const out = shapeForAts(resume, 'workday');
    expect(out.blocks.map((b) => b.text)).toEqual([
      'Ada Lovelace',
      'Work Experience',
      'Engineer | Acme | Jan 2020 - Present',
      'Analyst | Initech | 2015 - 2019',
      'Led “Project X” — shipped to 3 teams',
      'Skills',
      'Volunteer Experience',
    ]);
    expect(out.yearOnlyDates).toBe(1);
    expect(out.changes).toHaveLength(2);
  });

  it('also strips typographic characters for Taleo', () => {
    const out = shapeForAts(resume, 'taleo');
    expect(out.blocks[4].text).toBe('Led "Project X" - shipped to 3 teams');
  });

  it('does not change a system that shows the file to a recruiter', () => {
    expect(shapeForAts(resume, 'greenhouse').blocks).toEqual(resume);
  });
});

describe('tailorFromText', () => {
  it('records the target system on the report', () => {
    const out = tailorFromText('Ada Lovelace\nCareer History\nEngineer, Acme, 2020 - 2022', [], { title: 'Engineer', keywords: [], ats: 'workday' });
    expect(out.report.ats).toEqual(expect.objectContaining({ id: 'workday', yearOnlyDates: 1 }));
    expect(out.report.sections.experience).toBe(true);
  });
});
