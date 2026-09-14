import { z } from 'zod';

export const createNoteSchema = z.strictObject({
  title: z.string().trim().min(1, 'Enter a title.').max(120),
});

export const noteSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
});

export const notesListSchema = z.array(noteSchema);

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type Note = z.infer<typeof noteSchema>;
