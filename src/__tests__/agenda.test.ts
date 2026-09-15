import {
  classifyRow,
  dueProperty,
  isDoneStatus,
  selectOptions,
  statusProperty,
  type Prop,
  type RowInput,
} from '@/lib/agenda';

const due: Prop = { id: 'due', name: 'Due Date', type: 'date', formula: null };
const created: Prop = { id: 'created', name: 'Created', type: 'date', formula: null };
const status: Prop = {
  id: 'status',
  name: 'Status',
  type: 'select',
  formula: JSON.stringify(['Not Started', 'In Progress', 'Complete']),
};
const priority: Prop = { id: 'prio', name: 'Priority', type: 'select', formula: '["Low"]' };

const row = (values: Record<string, unknown>): RowInput => ({
  id: 'r1',
  title: 'Row',
  icon: null,
  properties: Object.entries(values).map(([propertyId, value]) => ({ propertyId, value })),
});

const TODAY = '2026-09-15';

describe('property discovery', () => {
  it('prefers a date property named Due/Deadline, else the first date', () => {
    expect(dueProperty([created, due])?.id).toBe('due');
    expect(dueProperty([created])?.id).toBe('created');
    expect(dueProperty([])).toBeUndefined();
  });

  it('only treats a select named Status/Stage/State as the status', () => {
    expect(statusProperty([priority, status])?.id).toBe('status');
    expect(statusProperty([priority])).toBeUndefined();
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
});

describe('classifyRow', () => {
  it('buckets by due date relative to today', () => {
    expect(classifyRow(row({ due: '2026-09-14' }), due, status, TODAY)?.bucket).toBe('overdue');
    expect(classifyRow(row({ due: '2026-09-15' }), due, status, TODAY)?.bucket).toBe('today');
    expect(classifyRow(row({ due: '2026-09-16' }), due, status, TODAY)).toBeNull();
  });

  it('surfaces in-progress rows with no due date', () => {
    const c = classifyRow(row({ status: 'In Progress' }), due, status, TODAY);
    expect(c).toEqual({ dueDate: null, status: 'In Progress', bucket: 'inProgress' });
  });

  it('hides done rows even when overdue', () => {
    expect(classifyRow(row({ due: '2026-01-01', status: 'Complete' }), due, status, TODAY)).toBeNull();
  });

  it('ignores rows with nothing actionable', () => {
    expect(classifyRow(row({ status: 'Not Started' }), due, status, TODAY)).toBeNull();
    expect(classifyRow(row({}), undefined, undefined, TODAY)).toBeNull();
  });

  it('tolerates datetime strings in date cells', () => {
    expect(classifyRow(row({ due: '2026-09-15T00:00:00.000Z' }), due, undefined, TODAY)?.bucket).toBe('today');
  });
});
