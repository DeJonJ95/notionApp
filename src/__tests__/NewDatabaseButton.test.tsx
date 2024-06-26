import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NewDatabaseButton } from '../components/database/NewDatabaseButton';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('NewDatabaseButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('does not disable the button when the user cancels the prompt', () => {
    // prompt() returns null on cancel
    jest.spyOn(window, 'prompt').mockReturnValue(null);

    render(<NewDatabaseButton workspaceId="ws-1" />);
    const button = screen.getByRole('button', { name: /new database/i });

    fireEvent.click(button);

    // Button must remain enabled — no fetch should have been called
    expect(button).not.toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('disables the button while the request is in-flight', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue('My DB');

    let resolveFetch!: (value: any) => void;
    (global.fetch as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    render(<NewDatabaseButton workspaceId="ws-1" />);
    const button = screen.getByRole('button', { name: /new database/i });

    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    // Resolve the fetch and confirm the button re-enables
    resolveFetch({ ok: true, json: async () => ({ id: 'db-1' }) });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('navigates to the new database on success', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue('My DB');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'db-42' }),
    });

    render(<NewDatabaseButton workspaceId="ws-1" />);
    fireEvent.click(screen.getByRole('button', { name: /new database/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/database/db-42'));
  });
});
