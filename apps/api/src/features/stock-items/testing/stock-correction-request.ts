import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
/** Existing measurement scenarios read the updated stock after an audited command. */
export function stockCorrectionRequest(
  server: Parameters<typeof request>[0],
  cookie: string,
  origin: string,
  url: string,
  changes?: object,
) {
  const run = async () => {
    const stock = await request(server).get(url).set('Cookie', cookie);
    const response = await request(server)
      .post(`${url}/${changes ? 'corrections' : 'void'}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: stock.body.revision ?? 1,
        reason: 'Integration measurement correction',
        ...(changes ? { changes } : {}),
      });
    if (response.status === 200 && changes) {
      const updated = await request(server)
        .get(url)
        .set('Cookie', cookie)
        .expect(200);
      response.body = updated.body;
    }
    return response;
  };
  return {
    expect: async (status: number) => {
      const response = await run();
      assert.equal(response.status, status, JSON.stringify(response.body));
      return response;
    },
    then: <TResult1 = request.Response, TResult2 = never>(
      onfulfilled?:
        ((value: request.Response) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => run().then(onfulfilled, onrejected),
  };
}
