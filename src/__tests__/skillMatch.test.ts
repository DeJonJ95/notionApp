import { bestSkillMatch, overlapScore, readSkills, scoreResume } from '@/lib/jobs/skillMatch';

const email = {
  id: 'r1',
  label: 'Email',
  skills: [
    { name: 'Salesforce Marketing Cloud', aliases: ['SFMC', 'ExactTarget'] },
    { name: 'HTML email', aliases: [] },
    { name: 'Mailchimp', aliases: [] },
    { name: 'GovDelivery', aliases: ['Granicus'] },
    { name: 'A/B testing', aliases: [] },
  ],
};
const web = { id: 'r2', label: 'Web', skills: [{ name: 'React', aliases: [] }, { name: 'CSS', aliases: [] }] };

describe('skill match', () => {
  it('finds skills by name or alias, with plurals and word boundaries', () => {
    const job = { title: 'Email Developer', description: 'Build HTML emails in SFMC and run A/B testing. Mailchimps welcome.' };
    expect(scoreResume(job, email).matched).toEqual(['Salesforce Marketing Cloud', 'HTML email', 'Mailchimp', 'A/B testing']);
  });

  it('does not match a skill inside a longer word', () => {
    const job = { title: 'Analyst', description: 'Experience with CSSR reporting and Reactive systems.' };
    expect(scoreResume(job, web).matched).toEqual([]);
  });

  it('counts a skill in the title twice', () => {
    const inTitle = scoreResume({ title: 'Mailchimp Specialist', description: 'Mailchimp campaigns' }, email);
    const inBody = scoreResume({ title: 'Specialist', description: 'Mailchimp campaigns' }, email);
    expect(inTitle.score).toBe(overlapScore(2));
    expect(inBody.score).toBe(overlapScore(1));
  });

  it('picks the resume with the most overlap', () => {
    const job = { title: 'Frontend Engineer', description: 'React and CSS, some HTML email.' };
    expect(bestSkillMatch(job, [email, web])?.resumeId).toBe('r2');
  });

  it('reads stored skills defensively', () => {
    expect(readSkills(null)).toBeNull();
    expect(readSkills([{ name: ' SQL ', aliases: ['Postgres', ''] }, { nope: 1 }, { name: '' }])).toEqual([
      { name: 'SQL', aliases: ['Postgres'] },
    ]);
  });
});
