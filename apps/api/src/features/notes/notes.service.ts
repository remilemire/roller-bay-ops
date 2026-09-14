import { Injectable } from '@nestjs/common';
import type { CreateNoteInput, Note } from '@roller-bay/shared/notes';
import { NotesRepository } from './notes.repository.js';
import type { notes } from './notes.table.js';

function toNote(row: typeof notes.$inferSelect): Note {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class NotesService {
  constructor(private readonly repository: NotesRepository) {}

  async list(): Promise<Note[]> {
    return (await this.repository.list()).map(toNote);
  }

  async create(input: CreateNoteInput): Promise<Note> {
    return toNote(await this.repository.create(input));
  }
}
