import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DatabaseView } from '../components/database/DatabaseView';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const makeDatabase = (views = [{ id: 'v1', name: 'Table', type: 'table' }]) => ({
  id: 'db-1',
  workspaceId: 'ws-1',
  name: 'Test DB',
  properties: [],
  views,
  pages: [],
});

describe('DatabaseView — selected view persistence', () => {
  it('keeps the selected view when onUpdate is called (data refresh)', async () => {
    const { rerender } = render(
      <DatabaseView database={makeDatabase([
        { id: 'v1', name: 'Table', type: 'table' },
        { id: 'v2', name: 'Gallery', type: 'gallery' },
      ])} onUpdate={jest.fn()} />
    );

    // Select the second view
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    expect(screen.getByRole('button', { name: 'Gallery' })).toHaveClass('bg-gray-900');

    // Simulate a data refresh by re-rendering with a new views array reference
    // (same content, different object identity — as happens after onUpdate())
    rerender(
      <DatabaseView database={makeDatabase([
        { id: 'v1', name: 'Table', type: 'table' },
        { id: 'v2', name: 'Gallery', type: 'gallery' },
      ])} onUpdate={jest.fn()} />
    );

    // The selected view must still be Gallery, not reset to Table
    expect(screen.getByRole('button', { name: 'Gallery' })).toHaveClass('bg-gray-900');
    expect(screen.getByRole('button', { name: 'Table' })).not.toHaveClass('bg-gray-900');
  });

  it('falls back to the first view when the selected view is removed', () => {
    const { rerender } = render(
      <DatabaseView database={makeDatabase([
        { id: 'v1', name: 'Table', type: 'table' },
        { id: 'v2', name: 'Gallery', type: 'gallery' },
      ])} onUpdate={jest.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));

    // Remove the Gallery view
    rerender(
      <DatabaseView database={makeDatabase([
        { id: 'v1', name: 'Table', type: 'table' },
      ])} onUpdate={jest.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Table' })).toHaveClass('bg-gray-900');
  });
});
