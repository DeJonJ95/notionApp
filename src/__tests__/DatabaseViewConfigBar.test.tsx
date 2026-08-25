import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DatabaseView } from '../components/database/DatabaseView';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

// The component fetches workspaces on mount; jsdom has no fetch.
beforeEach(() => {
  (global as any).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('[]') }),
  );
});
afterEach(() => {
  jest.resetAllMocks();
});

const database = (viewType: string) => ({
  id: 'db-1',
  workspaceId: 'ws-1',
  name: 'Personal Budget',
  properties: [
    { id: 'p-type', name: 'Type', type: 'select', formula: '["Income","Expense"]', position: 1 },
    { id: 'p-date', name: 'Date', type: 'date', formula: null, position: 2 },
  ],
  views: [{ id: 'v1', name: 'All Transactions', type: viewType }],
  pages: [],
});

// The filter bar existed for a long time but only rendered in split-view mode:
// the default branch inlined its own tab strip and called renderViewContent
// directly, skipping renderViewConfigBar. Nothing caught it because no test
// mounted the component and looked.
describe('view config bar', () => {
  it('renders on a table view in the normal (non-split) layout', () => {
    render(<DatabaseView database={database('table') as any} onUpdate={jest.fn()} />);
    expect(screen.getByText('Filter')).toBeInTheDocument();
    expect(screen.getByText('Sort')).toBeInTheDocument();
  });

  it('renders for every record view type', () => {
    for (const t of ['table', 'list', 'gallery', 'board']) {
      const { unmount } = render(<DatabaseView database={database(t) as any} onUpdate={jest.fn()} />);
      expect(screen.getByText('Filter')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders for a type this build does not recognize, which still shows a table', () => {
    render(<DatabaseView database={database('Table') as any} onUpdate={jest.fn()} />);
    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('stays hidden on the purpose-built budget views', () => {
    for (const t of ['budget-summary', 'spending-breakdown', 'calendar']) {
      const { unmount } = render(<DatabaseView database={database(t) as any} onUpdate={jest.fn()} />);
      expect(screen.queryByText('Filter')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('offers an Add filter control so a condition can be created', () => {
    render(<DatabaseView database={database('table') as any} onUpdate={jest.fn()} />);
    expect(screen.getByText('Add filter')).toBeInTheDocument();
  });
});
