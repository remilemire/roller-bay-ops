import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { noteSchema, notesListSchema } from '@roller-bay/shared/notes';
import request from 'supertest';
import { NotesController } from './notes.controller.js';
import { NotesRepository } from './notes.repository.js';
import { NotesService } from './notes.service.js';

let app: INestApplication;
let writes = 0;
const row = {
  id: '2a175c69-fd72-444a-b05c-a0b62e10a0cb',
  title: 'First note',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

before(async () => {
  const module = await Test.createTestingModule({
    controllers: [NotesController],
    providers: [
      NotesService,
      {
        provide: NotesRepository,
        useValue: {
          list: async () => [row],
          create: async (input: { title: string }) => {
            writes += 1;
            return { ...row, title: input.title };
          },
        },
      },
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
});

after(async () => {
  await app?.close();
});

test('lists notes using the shared JSON contract', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/notes')
    .expect(200);
  const result = notesListSchema.parse(response.body);
  assert.equal(result[0]?.createdAt, row.createdAt.toISOString());
});

test('trims valid titles before writing and returns the shared contract', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/notes')
    .send({ title: '  Hello  ' })
    .expect(201);
  assert.equal(noteSchema.parse(response.body).title, 'Hello');
});

test('rejects malformed input before it can reach the database', async () => {
  const writesBefore = writes;
  for (const body of [
    {},
    { title: '  ' },
    { title: 12 },
    { title: 'x'.repeat(121) },
    { title: 'Hello', admin: true },
  ]) {
    await request(app.getHttpServer())
      .post('/api/notes')
      .send(body)
      .expect(400);
  }
  assert.equal(writes, writesBefore);
});
