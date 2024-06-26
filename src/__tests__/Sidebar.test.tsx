import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Sidebar } from '../components/sidebar/Sidebar';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: any) => <a href={href}>{children}</a> }));
jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));
jest.mock('../components/sidebar/PageTree', () => ({ PageTree: () => null }));

describe('Sidebar — fetch error handling', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    jest.restoreAllMocks();
  });

  it('does not crash when /api/workspaces returns an error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    // Should render without throwing
    expect(() => render(<Sidebar />)).not.toThrow();

    // Wait a tick for the effect to run
    await new Promise((r) => setTimeout(r, 0));

    // Error should be logged, not thrown
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('workspaces'),
      expect.anything()
    );
  });

  it('does not corrupt state when /api/pages returns an error response', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })  // workspaces
      .mockResolvedValueOnce({ ok: false, status: 403 });          // pages

    expect(() => render(<Sidebar />)).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('pages'),
      expect.anything()
    );
  });
});
