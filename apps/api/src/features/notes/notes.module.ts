import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { NotesController } from './notes.controller.js';
import { NotesRepository } from './notes.repository.js';
import { NotesService } from './notes.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [NotesController],
  providers: [NotesService, NotesRepository],
})
export class NotesModule {}
