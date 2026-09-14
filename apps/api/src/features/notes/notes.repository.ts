import { Injectable } from '@nestjs/common';
import type { CreateNoteInput } from '@roller-bay/shared/notes';
import { desc } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { notes } from './notes.table.js';

@Injectable()
export class NotesRepository {
  constructor(private readonly database: DatabaseService) {}

  list() {
    return this.database.db.select().from(notes).orderBy(desc(notes.createdAt));
  }

  async create(input: CreateNoteInput) {
    const [note] = await this.database.db
      .insert(notes)
      .values(input)
      .returning();
    if (!note) throw new Error('The database did not return the created note.');
    return note;
  }
}
