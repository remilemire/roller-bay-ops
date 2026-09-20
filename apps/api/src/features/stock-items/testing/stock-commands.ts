import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

/**
 * Stock changes only through audited commands, each naming the revision it
 * expects. These read that revision first, so a test states what it changes
 * and the status it expects without tracking revisions it is not about.
 */
export function stockCommands(session: {
  server: Parameters<typeof request>[0];
  cookie: string;
  origin: string;
}) {
  const { server, cookie, origin } = session;
  const send = async (
    id: string,
    command: 'corrections' | 'void',
    body: object,
    status: number,
  ) => {
    const current = await request(server)
      .get(`/api/stock-items/${id}`)
      .set('Cookie', cookie);
    const response = await request(server)
      .post(`/api/stock-items/${id}/${command}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        // An unknown id has no revision; the command must still answer for it.
        expectedRevision: current.body.revision ?? 1,
        reason: 'Integration test',
        ...body,
      });
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response;
  };
  return {
    correct: (id: string, changes: object, status = 200) =>
      send(id, 'corrections', { changes }, status),
    voidStock: (id: string, status = 200) => send(id, 'void', {}, status),
  };
}
