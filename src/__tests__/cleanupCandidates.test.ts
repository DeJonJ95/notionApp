import { collectCandidates, noteReasons, type NoteRow } from '@/lib/cleanup/candidates';

const now = new Date('2026-10-08T12:00:00Z');
const old = new Date('2025-01-01T00:00:00Z');
const fresh = new Date('2026-10-01T00:00:00Z');

function note(over: Partial<NoteRow>): NoteRow {
  return { id: 'n', title: 'Plan', workspace: 'Personal', updatedAt: fresh, isArchived: false, isJournal: false, blocks: 3, children: 0, ...over };
}

describe('cleanup candidates', () => {
  it('leaves a fresh note with content alone', () => {
    expect(noteReasons(note({}), now)).toEqual([]);
  });

  it('flags empty, untitled, test-named, and stale notes', () => {
    expect(noteReasons(note({ blocks: 0 }), now)).toEqual(['empty']);
    expect(noteReasons(note({ title: 'Untitled' }), now)).toEqual(['untitled']);
    expect(noteReasons(note({ title: 'Map test (delete me)' }), now)).toEqual(['test']);
    expect(noteReasons(note({ updatedAt: old }), now)).toEqual(['stale']);
  });

  it('does not call a note empty when it has subpages', () => {
    expect(noteReasons(note({ blocks: 0, children: 2 }), now)).toEqual([]);
  });

  it('never flags a journal entry just for age', () => {
    expect(noteReasons(note({ isJournal: true, updatedAt: old }), now)).toEqual([]);
  });

  it('reports sidebar-deleted notes only as trashed', () => {
    expect(noteReasons(note({ isArchived: true, blocks: 0, title: 'test' }), now)).toEqual(['trashed']);
  });

  it('flags empty and test databases and sorts oldest first', () => {
    const out = collectCandidates(
      [note({ id: 'a', blocks: 0, updatedAt: fresh })],
      [
        { id: 'd1', name: 'GuestList', workspace: 'Side Projects', rows: 0, lastEdited: old },
        { id: 'd2', name: 'Personal Budget', workspace: 'Personal', rows: 1005, lastEdited: fresh },
      ],
      now,
    );
    expect(out.map((c) => [c.kind, c.id, c.reasons])).toEqual([
      ['database', 'd1', ['empty', 'stale']],
      ['page', 'a', ['empty']],
    ]);
  });
});
