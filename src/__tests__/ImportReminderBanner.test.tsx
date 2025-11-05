import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ImportReminderBanner } from '../components/budget/ImportReminderBanner';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('ImportReminderBanner', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('shows welcome message when no imports yet', () => {
    render(<ImportReminderBanner daysSinceLastImport={null} onImport={jest.fn()} />);
    expect(screen.getByText(/No bank statements imported yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Import now/i)).toBeInTheDocument();
  });

  it('does not show when import was recent (≤14 days)', () => {
    render(<ImportReminderBanner daysSinceLastImport={10} onImport={jest.fn()} />);
    expect(screen.queryByText(/import/i)).not.toBeInTheDocument();
  });

  it('shows reminder when 15 days since last import', () => {
    render(<ImportReminderBanner daysSinceLastImport={15} onImport={jest.fn()} />);
    expect(screen.getByText(/15 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Import now/i)).toBeInTheDocument();
  });

  it('shows urgent warning when 31+ days since last import', () => {
    render(<ImportReminderBanner daysSinceLastImport={35} onImport={jest.fn()} />);
    expect(screen.getByText(/35 days/i)).toBeInTheDocument();
    expect(screen.getByText(/out of date/i)).toBeInTheDocument();
  });

  it('dismiss button hides the banner', () => {
    render(<ImportReminderBanner daysSinceLastImport={20} onImport={jest.fn()} />);
    expect(screen.getByText(/20 days/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Dismiss for 7 days'));
    expect(screen.queryByText(/20 days/i)).not.toBeInTheDocument();
  });

  it('calls onImport when Import now button is clicked', () => {
    const onImport = jest.fn();
    render(<ImportReminderBanner daysSinceLastImport={null} onImport={onImport} />);
    fireEvent.click(screen.getByText(/Import now/i));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('sets localStorage on dismiss', () => {
    render(<ImportReminderBanner daysSinceLastImport={20} onImport={jest.fn()} />);
    fireEvent.click(screen.getByTitle('Dismiss for 7 days'));
    expect(localStorageMock.setItem).toHaveBeenCalledWith('budget-import-reminder-dismissed', expect.any(String));
  });

  it('remains hidden if dismissed within last 7 days', () => {
    // Set a recent dismiss timestamp
    const recent = new Date();
    recent.setDate(recent.getDate() - 2);
    localStorageMock.getItem.mockReturnValueOnce(recent.toISOString());

    render(<ImportReminderBanner daysSinceLastImport={20} onImport={jest.fn()} />);
    expect(screen.queryByText(/20 days/i)).not.toBeInTheDocument();
  });
});