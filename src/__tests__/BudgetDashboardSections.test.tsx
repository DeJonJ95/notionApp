import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BudgetDashboard } from '../components/budget/BudgetDashboard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const dashboard = {
  databaseId: 'db1',
  databaseName: 'Personal Budget',
  monthLabel: 'August 2026',
  month: '2026-08',
  currentMonth: '2026-08',
  income: 9417,
  expenses: 2991,
  net: 6426,
  prevMonth: { income: 7000, expenses: 6900, net: 100 },
  expectedVsActual: { incomeExpected: 0, incomeActual: 0, expenseExpected: 0, expenseActual: 0, rules: [] },
  byCategory: [],
  categoryBudgets: [{ category: 'Food & Dining', budgeted: 400, spent: 250, remaining: 150, pctSpent: 62.5, pctOfMonthElapsed: 80 }],
  categoryOptions: ['Food & Dining', 'Other'],
  excesses: [],
  subscriptions: [],
  repeatVendors: [],
  recentTransactions: [
    { pageId: 'p1', date: '2026-08-05', vendor: 'City of Detroit', amount: 3746, category: 'Other', type: 'Income', account: null },
  ],
  accounts: [{ account: 'Checking', balance: 4170.4, asOf: '2026-08-12', statementBalance: 4000, sinceStatement: 170.4, txCount: 12 }],
  hasBalances: true,
  totalBalance: 4170.4,
  balanceCurve: [],
  negativeBalanceDate: null,
  monthlyForecast: [
    { month: '2026-08', label: 'August 2026', isPartial: true, income: 0, recurringExpenses: 0, variableExpenses: 100, expenses: 100, net: -100, endingBalance: 4070.4 },
  ],
  variableSpendEstimate: 400,
  forecast: [],
  projectedMonthEnd: 6284,
  generatedThisLoad: 0,
  trends: [],
  patternSuggestions: [],
  ruleVariance: [],
  autoBudget: { hasManualBudget: true, monthlyProjectedIncome: 0, monthlyProjectedExpenses: 0, monthlySavingsTotal: 0, availableToBudget: 0 },
};

const routeBody = (url: string) => {
  if (url.includes('/api/budget/dashboard')) return dashboard;
  if (url.includes('/api/budget/imports')) return { imports: [], lastImportDate: null, daysSinceLastImport: null, gaps: [], balanceChecks: [] };
  if (url.includes('/api/budget/waste')) return { findings: [], totalAnnualImpact: 0, monthsAnalyzed: 0, transactionsAnalyzed: 0 };
  return { collisions: [] };
};

beforeEach(() => {
  window.localStorage.clear();
  (global as any).fetch = jest.fn((url: string) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(routeBody(String(url))) }),
  );
});
afterEach(() => jest.resetAllMocks());

// /budget grew to ~14 sections in one session. They collapse now, and the
// defaults decide what a first-time visitor actually sees.
describe('BudgetDashboard collapsible sections', () => {
  it('shows the sections that matter daily expanded', async () => {
    render(<BudgetDashboard />);
    // Budgets is default-open, so its category row is on screen.
    expect(await screen.findByText('Food & Dining')).toBeInTheDocument();
    // Accounts too.
    expect(screen.getByText('Checking')).toBeInTheDocument();
  });

  it('keeps long list sections collapsed but still headed', async () => {
    render(<BudgetDashboard />);
    // The header is present...
    expect(await screen.findByText('Recent transactions')).toBeInTheDocument();
    // ...but the table inside is not rendered.
    expect(screen.queryByText('City of Detroit')).not.toBeInTheDocument();
  });

  it('shows the item count on a collapsed section, so folding hides nothing important', async () => {
    render(<BudgetDashboard />);
    await screen.findByText('Recent transactions');
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('expands on click and remembers the choice', async () => {
    const { unmount } = render(<BudgetDashboard />);
    fireEvent.click(await screen.findByText('Recent transactions'));
    expect(await screen.findByText('City of Detroit')).toBeInTheDocument();
    expect(window.localStorage.getItem('kove-budget-section:recent')).toBe('1');

    // A fresh mount honours the stored preference rather than the default.
    unmount();
    render(<BudgetDashboard />);
    expect(await screen.findByText('City of Detroit')).toBeInTheDocument();
  });

  it('collapses an open section and remembers that too', async () => {
    render(<BudgetDashboard />);
    // 'Budgets' is also a header button, so target the section heading itself.
    fireEvent.click(await screen.findByRole('heading', { name: 'Budgets' }));
    await waitFor(() => expect(screen.queryByText('Food & Dining')).not.toBeInTheDocument());
    expect(window.localStorage.getItem('kove-budget-section:budgets')).toBe('0');
  });
});
