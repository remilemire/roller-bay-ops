import {
  createNoteSchema,
  noteSchema,
  notesListSchema,
  type CreateNoteInput,
} from '@roller-bay/shared/notes';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function listNotes(signal?: AbortSignal) {
  const response = await fetch(`${apiUrl}/notes`, { signal });
  if (!response.ok)
    throw new Error(
      'Could not load notes. Check that the API and database are running.',
    );
  return notesListSchema.parse(await response.json());
}

export async function createNote(input: CreateNoteInput) {
  const response = await fetch(`${apiUrl}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createNoteSchema.parse(input)),
  });
  if (!response.ok)
    throw new Error('Could not save this note. Please try again.');
  return noteSchema.parse(await response.json());
}
