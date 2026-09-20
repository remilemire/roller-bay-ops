import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// apps/solver, the same depth from src/ and .test-dist/.
const solverDirectory = fileURLToPath(
  new URL('../../../solver', import.meta.url),
);

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  server.close();
  await once(server, 'close');
  return port;
}

/**
 * Starts the standalone solver for one test file and stops it afterwards. All
 * four variables the service reads are set here, and its dotenv never
 * overrides a set variable, so nothing depends on apps/solver/.env or on a
 * solver someone started by hand. Needs only the solver's virtualenv.
 */
export async function startSolver(t: TestContext) {
  const apiKey = randomBytes(32).toString('hex');
  const port = await freePort();
  const solver = spawn('.venv/bin/python', ['-m', 'service.main'], {
    cwd: solverDirectory,
    env: {
      PATH: process.env.PATH,
      SOLVER_API_KEY: apiKey,
      SOLVER_HOST: '127.0.0.1',
      SOLVER_PORT: String(port),
      SOLVER_PROVIDER: 'or-tools',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  solver.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()));
  const exited = once(solver, 'exit');
  t.after(async () => {
    solver.kill();
    await exited;
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (solver.exitCode !== null) break;
    const ready = await fetch(`${baseUrl}/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return { baseUrl, apiKey };
    await delay(100);
  }
  throw new Error(`The solver did not start.\n${log}`);
}
