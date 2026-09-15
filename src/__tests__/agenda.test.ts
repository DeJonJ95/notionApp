import {
  classifyRow,
  doneProperty,
  dueProperty,
  isDoneStatus,
  isInProgressStatus,
  selectOptions,
  statusProperty,
  taskSchema,
  type Prop,
  type RowInput,
} from '@/lib/agenda';

const due: Prop = { id: 'due', name: 'Due Date', type: 'date', formula: null };
const created: Prop = { id: 'created', name: 'Last Completed', type: 'date', formula: null };
const status: Prop = {
  id: 'status',
  name: 'Status',
  type: 'select',
  formula: JSON.stringify(['Not Started', 'In Progress', 'Complete']),
};
const priority: Prop = { id: 'prio', name: 'Priority', type: 'select', formula: '["Low"]' };
const done: Prop = { id: 'done', name: 'Done', type: 'checkbox', formula: null };

const row = (values: Record<string, unknown>): RowInput => ({
  id: 'r1',
  title: 'Row',
  icon: null,
  properties: Object.entries(values).map(([propertyId, value]) => ({ propertyId, value })),
});

const TODAY = '2026-09-15';
const schema = { due, status };

describe('property discovery', () => {
  it('only treats a date named Due/Deadline as the deadline', () => {
    expect(dueProperty([created, due])?.id).toBe('due');
    expect(dueProperty([created])).toBeUndefined();
  });

  it('only treats a select named Status/Stage/State as the status', () => {
    expect(statusProperty([priority, status])?.id).toBe('status');
    expect(statusProperty([priority])).toBeUndefined();
  });

  it('finds a Done/Complete checkbox', () => {
    expect(doneProperty([done, priority])?.id).toBe('done');
    expect(taskSchema([due, status, done])).toEqual({ due, status, done });
  });

  it('parses select options from the JSON in formula', () => {
    expect(selectOptions(status)).toEqual(['Not Started', 'In Progress', 'Complete']);
    expect(selectOptions({ ...status, formula: 'not json' })).toEqual([]);
    expect(selectOptions(undefined)).toEqual([]);
  });

  it('recognises done-like status values', () => {
    expect(isDoneStatus('Complete')).toBe(true);
    expect(isDoneStatus(' done ')).toBe(true);
    expect(isDoneStatus('In Review')).toBe(false);
    expect(isDoneStatus(null)).toBe(false);
  });

  it('recognises in-progress values as whole words only', () => {
    expect(isInProgressStatus('In Progress')).toBe(true);
    expect(isInProgressStatus('Active')).toBe(true);
    expect(isInProgressStatus('In Review')).toBe(true);
    expect(isInProgressStatus('Inactive')).toBe(false);
    expect(isInProgressStatus('Unstarted')).toBe(false);
    expect(isInProgressStatus('Not Started')).toBe(false);
  });
});

describe('classifyRow', () => {
  it('buckets by due date relative to today', () => {
    expect(classifyRow(row({ due: '2026-09-14' }), schema, TODAY)?.bucket).toBe('overdue');
    expect(classifyRow(row({ due: '2026-09-15' }), schema, TODAY)?.bucket).toBe('today');
    expect(classifyRow(row({ due: '2026-09-16' }), schema, TODAY)).toBeNull();
  });

  it('surfaces in-progress rows with no due date', () => {
    const c = classifyRow(row({ status: 'In Progress' }), schema, TODAY);
    expect(c).toEqual({ dueDate: null, status: 'In Progress', bucket: 'inProgress' });
  });

  it('hides done rows even when overdue', () => {
    expect(classifyRow(row({ due: '2026-01-01', status: 'Complete' }), schema, TODAY)).toBeNull();
    expect(classifyRow(row({ due: '2026-01-01', done: true }), { due, done }, TODAY)).toBeNull();
    expect(classifyRow(row({ due: '2026-01-01', done: false }), { due, done }, TODAY)?.bucket).toBe('overdue');
  });

  it('ignores rows with nothing actionable', () => {
    expect(classifyRow(row({ status: 'Not Started' }), schema, TODAY)).toBeNull();
    expect(classifyRow(row({ status: 'Inactive' }), schema, TODAY)).toBeNull();
    expect(classifyRow(row({ created: '2020-01-01' }), {}, TODAY)).toBeNull();
  });

  it('tolerates datetime strings in date cells', () => {
    expect(classifyRow(row({ due: '2026-09-15T00:00:00.000Z' }), { due }, TODAY)?.bucket).toBe('today');
  });
});
