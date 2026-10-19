import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AccountSelect, matchKnownAccount } from '../components/budget/AccountSelect';

const known = ['Checking 1234', 'Freedom Unlimited', 'Savings 9876'];

describe('matchKnownAccount', () => {
  it('maps a differently formatted label onto the tracked spelling', () => {
    expect(matchKnownAccount('CHECKING ...1234', known)).toBe('Checking 1234');
    expect(matchKnownAccount('freedom unlimited', known)).toBe('Freedom Unlimited');
    expect(matchKnownAccount('Account ending in 9876', known)).toBe('Savings 9876');
  });

  it('keeps the label as read when nothing or more than one account fits', () => {
    expect(matchKnownAccount('Sapphire 5555', known)).toBe('Sapphire 5555');
    expect(matchKnownAccount('Card 1234', ['Checking 1234', 'Visa 1234'])).toBe('Card 1234');
    expect(matchKnownAccount(null, known)).toBe('');
  });
});

function Harness({ accounts, initial }: { accounts: string[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AccountSelect accounts={accounts} value={value} onChange={setValue} />
      <output>{value}</output>
    </>
  );
}

describe('AccountSelect', () => {
  it('lists existing accounts and shows a name field only for a new one', () => {
    render(<Harness accounts={known} initial="Checking 1234" />);
    const select = screen.getByLabelText('Account');
    expect(select).toHaveValue('Checking 1234');
    expect(screen.queryByLabelText('New account name')).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText('New account name'), { target: { value: 'Brokerage' } });
    expect(screen.getByRole('status')).toHaveTextContent('Brokerage');

    fireEvent.change(select, { target: { value: 'Savings 9876' } });
    expect(screen.queryByLabelText('New account name')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Savings 9876');
  });

  it('opens on the name field for an unmatched label, and is only a field with no accounts yet', () => {
    const { unmount } = render(<Harness accounts={known} initial="Sapphire 5555" />);
    expect(screen.getByLabelText('New account name')).toHaveValue('Sapphire 5555');
    unmount();
    render(<Harness accounts={[]} initial="" />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New account name')).toBeInTheDocument();
  });
});
