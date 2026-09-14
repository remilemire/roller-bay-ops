import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  createNoteSchema,
  type CreateNoteInput,
} from '@roller-bay/shared/notes';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { NotesService } from './notes.service.js';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list() {
    return this.notes.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createNoteSchema)) input: CreateNoteInput,
  ) {
    return this.notes.create(input);
  }
}
