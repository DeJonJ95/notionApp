import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatementCoverageBar } from '../components/budget/StatementCoverageBar';

describe('StatementCoverageBar', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(2026, 9, 20, 9)));
  afterEach(() => jest.useRealTimers());

  it('says how far the budget is accounted for and what to download next', () => {
    render(<StatementCoverageBar coverage={{ account: 'Huntington', from: '2026-07-13', through: '2026-10-16', gaps: [] }} onImport={() => {}} />);
    expect(screen.getByText('Accounted for through Oct 16')).toBeInTheDocument();
    expect(screen.getByText('Next download: Oct 17 to today')).toBeInTheDocument();
  });

  it('lists each missing range', () => {
    render(<StatementCoverageBar coverage={{ account: null, from: '2026-07-01', through: '2026-10-20', gaps: [{ from: '2026-09-16', to: '2026-09-30', days: 15 }] }} onImport={() => {}} />);
    expect(screen.getByText('Accounted for through today')).toBeInTheDocument();
    expect(screen.getByText('Missing Sep 16 to Sep 30 (15 days)')).toBeInTheDocument();
    expect(screen.queryByText(/Next download/)).not.toBeInTheDocument();
  });

  it('asks for the first statement when nothing is imported', () => {
    const onImport = jest.fn();
    render(<StatementCoverageBar coverage={null} onImport={onImport} />);
    fireEvent.click(screen.getByText('Import statement'));
    expect(onImport).toHaveBeenCalled();
  });
});
