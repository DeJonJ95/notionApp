import { planChanges, keepValid } from '@/lib/assist/projectPlan';
import { resolveTarget, type ProjectData, type Target } from '@/lib/assist/projects';
import { parseResult, parseRoute, fillIns, projectText } from '@/lib/assist/parse';
import { docText } from '@/lib/assist/notes';
import { todoKey } from '@/lib/assist/todoKey';

const prop = (id: string, name: string, type: string) => ({ id, name, type, formula: null });

const data: ProjectData = {
  databaseId: 'db1',
  name: 'Website Refresh',
  workspaceId: 'ws1',
  props: { status: prop('st', 'Status', 'select'), phase: prop('ph', 'Phase', 'select'), due: prop('du', 'Due Date', 'date'), waitsOn: prop('wo', 'Waits on', 'relation') },
  statusOptions: ['Not Started', 'In Progress', 'Complete'],
  phaseOptions: ['Design', 'Build'],
  tasks: [
    { id: 't1', title: 'Wireframes', status: 'Complete', phase: 'Design', due: '2026-10-01', waitsOn: [] },
    { id: 't2', title: 'Visual design', status: 'In Progress', phase: 'Design', due: '2026-10-20', waitsOn: ['t1'] },
    { id: 't3', title: 'Build pages', status: 'Not Started', phase: 'Build', due: '2026-11-01', waitsOn: ['t2'] },
  ],
};

const TODAY = '2026-10-15';

describe('planChanges', () => {
  it('keeps real edits, drops unknown ids and no-ops, and coerces values', () => {
    const plan = planChanges([
      { op: 'update', taskId: 't2', due: '2026-10-27', status: 'in progress', reason: 'Slipped a week' },
      { op: 'update', taskId: 'nope', due: '2026-10-27' },
      { op: 'update', taskId: 't1', status: 'Complete' },
      { op: 'update', taskId: 't3', status: 'Blocked', due: 'next week' },
    ], data, TODAY);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ op: 'update', taskId: 't2', title: 'Visual design', set: { due: '2026-10-27', status: 'In Progress' }, reason: 'Slipped a week' });
    expect(plan[0].fields).toEqual([{ field: 'due', before: '2026-10-20', after: '2026-10-27' }]);
  });

  it('lets new tasks depend on each other by ref and names them in the diff', () => {
    const plan = planChanges([
      { op: 'add', ref: 'n1', title: 'Content audit', phase: 'Content', due: '2026-10-25', waitsOn: ['t1'] },
      { op: 'add', ref: 'n2', title: 'Write copy', due: '2026-10-30', waitsOn: ['n1', 'ghost'] },
      { op: 'update', taskId: 't3', waitsOn: ['t2', 'n2'] },
    ], data, TODAY);
    expect(plan.map((c) => c.op)).toEqual(['add', 'add', 'update']);
    expect(plan[1].set.waitsOn).toEqual(['n1']);
    expect(plan[0].set.phase).toBe('Content');
    expect(plan[2].fields).toEqual([{ field: 'waitsOn', before: 'Visual design', after: 'Visual design, Write copy' }]);
  });

  it('warns when a task would come due before what it waits on, or in the past', () => {
    const plan = planChanges([
      { op: 'update', taskId: 't2', due: '2026-11-05' },
      { op: 'add', ref: 'n1', title: 'Build pages', due: '2026-10-10' },
    ], data, TODAY);
    expect(plan[0].warnings).toEqual([]);
    expect(plan[1].warnings).toEqual(['A task with this name already exists.', 'Due date is in the past.']);
    const t3 = planChanges([{ op: 'update', taskId: 't3', due: '2026-10-18' }], data, TODAY)[0];
    expect(t3.warnings).toEqual(['Due before Visual design (2026-10-20), which it waits on.']);
  });

  it('re-checks an accepted plan against the list as it is now', () => {
    const plan = planChanges([
      { op: 'add', ref: 'n1', title: 'QA pass', waitsOn: ['t3'] },
      { op: 'update', taskId: 't2', due: '2026-10-22' },
      { op: 'add', ref: 'n2', title: 'Launch', waitsOn: ['n1'] },
    ], data, TODAY);
    const now = { ...data, tasks: data.tasks.filter((t) => t.id !== 't3') };
    const kept = keepValid(plan, [0, 1], now);
    expect(kept.map((c) => c.title)).toEqual(['QA pass', 'Visual design']);
    expect(kept[0].set.waitsOn).toEqual([]);
  });
});

describe('resolveTarget', () => {
  const targets: Target[] = [
    { databaseId: 'a', name: 'Website Refresh', kind: 'project' },
    { databaseId: 'b', name: 'Company Retreat 2027', kind: 'project' },
    { databaseId: 'c', name: 'Personal tasks', kind: 'list' },
  ];
  it('matches exact, partial and reordered names', () => {
    expect(resolveTarget(targets, 'website refresh')?.databaseId).toBe('a');
    expect(resolveTarget(targets, 'retreat')?.databaseId).toBe('b');
    expect(resolveTarget(targets, 'refresh of website')?.databaseId).toBe('a');
    expect(resolveTarget(targets, 'garden')).toBeNull();
    expect(resolveTarget(targets, null)).toBeNull();
  });
});

describe('parsing', () => {
  it('falls back to answer for an unknown intent', () => {
    expect(parseRoute({ intent: 'dance', target: ' ', search: 'Midland credit' })).toEqual({ intent: 'answer', target: null, search: 'Midland credit' });
  });

  it('finds the blanks in a draft and strips em dashes', () => {
    const r = parseResult('draft', { kind: 'email', to: '', subject: 'Account [[account number]]', body: 'Hello — I am writing about [[account number]] and [[amount]].', reply: 'Drafted.' });
    expect(r).toMatchObject({ intent: 'draft', body: 'Hello, I am writing about [[account number]] and [[amount]].' });
    expect(r.intent === 'draft' && r.fillIns).toEqual(['account number', 'amount']);
    expect(fillIns('none here')).toEqual([]);
  });

  it('describes a project with ids the model can reference', () => {
    const t = projectText(data);
    expect(t).toContain('id=t2 title="Visual design" status=In Progress phase=Design due=2026-10-20 waitsOn=[t1]');
    expect(t).toContain('PHASES: Design, Build');
  });

  it('reads note text out of a TipTap document', () => {
    const doc = { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'Midland' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Acct ' }, { type: 'text', text: '4471' }] }] };
    expect(docText(doc)).toBe('Midland\nAcct 4471\n');
  });

  it('keys a to-do by its text, ignoring case, spacing and end punctuation', () => {
    expect(todoKey('  Write email to  Bill collector. ')).toBe('write email to bill collector');
  });
});

describe('quickRoute', () => {
  const { quickRoute, searchTerms } = jest.requireActual('@/lib/assist/quickRoute') as typeof import('@/lib/assist/quickRoute');
  const targets: Target[] = [{ databaseId: 'a', name: 'Website Refresh', kind: 'project' }, { databaseId: 'b', name: 'Office Move', kind: 'project' }];
  it('routes clear wording without a model call', () => {
    expect(quickRoute('Write email to bill collector about the overdue Visa balance', targets)).toEqual({ intent: 'draft', target: null, search: 'bill or collector or overdue or visa or balance' });
    expect(quickRoute('Update Website Refresh timeline, launch slips two weeks', targets)).toMatchObject({ intent: 'project', target: 'Website Refresh' });
    expect(quickRoute('Plan packing for the office move', targets)).toBeNull();
    expect(quickRoute('Plan packing for the new apartment', targets)?.intent).toBe('steps');
    expect(quickRoute('Should I refinance the car?', targets)?.intent).toBe('answer');
    expect(quickRoute('Groceries', targets)).toBeNull();
    expect(quickRoute('Do the dishes', targets)).toBeNull();
    expect(quickRoute('Update the text on the Website Refresh homepage', targets)).toMatchObject({ intent: 'project', target: 'Website Refresh' });
    expect(quickRoute('Email the team about the Website Refresh timeline', targets)?.intent).toBe('draft');
  });
  it('builds an OR query from content words', () => {
    expect(searchTerms('Email the landlord')).toBe('landlord');
    expect(searchTerms('to do it')).toBeNull();
  });
});
