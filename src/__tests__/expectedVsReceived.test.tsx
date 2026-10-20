import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExpectedVsReceived } from '../components/budget/ExpectedVsReceived';
import type { ExpectedVsActual } from '../lib/budgetExpected';

const data: ExpectedVsActual = {
  incomeExpected: 1926, incomeActual: 2593.53, expenseExpected: 293, expenseActual: 151,
  rules: [
    { ruleId: 'p', name: 'City of Detroit', type: 'income', expectedAmt: 1926, expectedCount: 1, matchedCount: 1, unconfirmedCount: 0, matchedTotal: 2593.53,
      dueDates: [{ due: '2026-10-02', state: 'paid', payment: { date: '2026-09-30', vendor: 'City of Detroit', amount: 2593.53 } }] },
    { ruleId: 'ns', name: 'National Storage', type: 'expense', expectedAmt: 151, expectedCount: 1, matchedCount: 1, unconfirmedCount: 0, matchedTotal: 151,
      dueDates: [{ due: '2026-10-01', state: 'paid', payment: { date: '2026-10-01', vendor: 'National Storage', amount: 151 } }] },
    { ruleId: 'x', name: 'Exeter Finance', type: 'expense', expectedAmt: 142, expectedCount: 1, matchedCount: 0, unconfirmedCount: 1, matchedTotal: 0,
      dueDates: [{ due: '2026-10-18', state: 'unconfirmed', payment: null }] },
  ],
};

describe('ExpectedVsReceived', () => {
  beforeEach(() => window.localStorage.clear());

  it('opens the bills behind the expense figures on click', () => {
    render(<ExpectedVsReceived data={data} monthLabel="October 2026" />);
    expect(screen.queryByText('Exeter Finance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Show 2 bills'));
    expect(screen.getByText('National Storage')).toBeInTheDocument();
    expect(screen.getByText(/Paid \$151\.00 on Oct 1/)).toBeInTheDocument();
    expect(screen.getByText(/Not confirmed yet/)).toBeInTheDocument();
    expect(screen.queryByText('City of Detroit')).not.toBeInTheDocument();
  });

  it('opens paychecks separately', () => {
    render(<ExpectedVsReceived data={data} monthLabel="October 2026" />);
    fireEvent.click(screen.getByText('Show 1 paycheck'));
    expect(screen.getByText(/Received \$2,593\.53 on Sep 30/)).toBeInTheDocument();
    expect(screen.getByText('Hide 1 paycheck')).toBeInTheDocument();
  });
});
