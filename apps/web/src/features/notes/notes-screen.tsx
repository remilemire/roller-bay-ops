'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createNoteSchema, type Note } from '@roller-bay/shared/notes';
import { createNote, listNotes } from './notes.api';

export function NotesScreen() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listNotes(controller.signal)
      .then(setNotes)
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Could not load notes.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = createNoteSchema.safeParse({ title });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Enter a valid title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const note = await createNote(result.data);
      setNotes((current) => [note, ...current]);
      setTitle('');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save this note.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Roller Bay Ops</p>
      <h1>A place to start.</h1>
      <p className="intro">Capture a note and come back to it later.</p>
      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes</h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="note-title">New note</label>
          <div className="form-row">
            <input
              id="note-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
              placeholder="What’s on your mind?"
              disabled={saving}
            />
            <button type="submit" disabled={saving || loading}>
              {saving ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div aria-live="polite" aria-busy={loading}>
          {loading ? (
            <p className="muted">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="muted">No notes yet. Add your first one above.</p>
          ) : (
            <ul>
              {notes.map((note) => (
                <li key={note.id}>
                  <span>{note.title}</span>
                  <time dateTime={note.createdAt}>
                    {new Date(note.createdAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
