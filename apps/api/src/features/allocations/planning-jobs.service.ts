import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, Worker, WaitingError, type Job } from 'bullmq';
import {
  type AllocationPlanningResult,
  type AllocationPlanningJob,
  type OptimizeAllocation,
} from '@roller-bay/shared/allocations';
import type { Environment } from '../../config/environment.js';
import {
  AllocationPlanningService,
  type PlanningSnapshot,
} from './allocation-planning.service.js';

type SearchJob = { fingerprint: string } & (
  | { snapshot: PlanningSnapshot; plan?: never }
  | { snapshot?: never; plan: AllocationPlanningResult }
);
// The queue stores the original availability snapshot. A stalled worker can
// start the same finite search again without silently substituting new stock.
@Injectable()
export class PlanningJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlanningJobsService.name);
  private readonly queue: Queue<SearchJob, void>;
  private readonly worker: Worker<SearchJob, void>;
  private readonly events: QueueEvents;
  private stopping = false;

  constructor(
    config: ConfigService<Environment, true>,
    private readonly planning: AllocationPlanningService,
  ) {
    const connection = { url: config.getOrThrow('REDIS_URL', { infer: true }) };
    const name = config.getOrThrow('CUTTING_QUEUE_NAME', { infer: true });
    const retention = {
      age: config.getOrThrow('CUTTING_RESULT_TTL_SECONDS', { infer: true }),
    };
    this.queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        removeOnComplete: retention,
        removeOnFail: retention,
      },
    });
    this.events = new QueueEvents(name, { connection });
    this.events.on('error', (error) =>
      this.logger.error('Cutting queue events error', error.stack),
    );
    this.worker = new Worker(
      name,
      (job, token, signal) => this.run(job, token!, signal!),
      {
        connection,
        autorun: false,
        concurrency: config.getOrThrow('CUTTING_JOB_CONCURRENCY', {
          infer: true,
        }),
      },
    );
    this.events.on('progress', ({ jobId, data }) => {
      if (data === 'cancelled') this.worker.cancelJob(jobId);
    });
    this.worker.on('error', (error) =>
      this.logger.error('Cutting job worker error', error.stack),
    );
    this.queue.on('error', (error) =>
      this.logger.error('Cutting queue error', error.stack),
    );
    this.worker.on('failed', (_job, error) =>
      this.logger.error('Cutting job failed', error.stack),
    );
  }

  async onModuleInit() {
    await this.events.waitUntilReady();
    void this.worker
      .run()
      .catch((error: Error) =>
        this.logger.error('Cutting job worker stopped', error.stack),
      );
  }

  private id(owner: string, id: string) {
    return `${owner}-${id}`;
  }
  private async run(
    job: Job<SearchJob, void>,
    token: string,
    signal: AbortSignal,
  ): Promise<void> {
    // The durable flag covers cancellation before pickup. The event stream
    // covers requests on other API replicas after this worker takes the lock.
    if ((await this.queue.getJob(job.id!))?.progress === 'cancelled') return;
    // If a worker died during refinement, its validated plan is already ready.
    if (job.data.plan) return;
    const { snapshot, fingerprint } = job.data;
    const publish = (plan: AllocationPlanningResult) =>
      job.updateData({ fingerprint, plan });
    try {
      const result = await this.planning.solve(snapshot, signal, publish);
      // Redis retains only the best plan once a result exists. Large snapshots
      // and full cut sheets never enter the queue's shared event stream.
      await publish(result);
    } catch (error) {
      if (this.stopping) {
        await job.moveToWait(token);
        throw new WaitingError();
      }
      if (signal.aborted) return;
      throw error;
    }
  }

  async start(
    owner: string,
    id: string,
    input: OptimizeAllocation,
  ): Promise<AllocationPlanningJob> {
    const jobId = this.id(owner, id);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    let job = await this.queue.getJob(jobId);
    if (!job) {
      const snapshot = await this.planning.prepare(input);
      await this.queue.add('plan', { snapshot, fingerprint }, { jobId });
      // Concurrent retries can race at add. Read the job that actually won.
      job = await this.queue.getJob(jobId);
    }
    if (!job)
      throw new ServiceUnavailableException(
        'Could not start the cutting search.',
      );
    if (job.data.fingerprint !== fingerprint)
      throw new ConflictException(
        'This planning request was already used for different blinds.',
      );
    return this.present(job);
  }
  private present(job: Job<SearchJob, void>): AllocationPlanningJob {
    if (job.progress === 'cancelled') return { status: 'cancelled' };
    const result = job.data.plan;
    if (result) {
      if (job.finishedOn || result.status !== 'feasible')
        return { status: 'finished', result };
      return { status: 'refining', result };
    }
    if (job.finishedOn) return { status: 'failed' };
    return { status: 'searching' };
  }
  private async get(owner: string, id: string) {
    const job = await this.queue.getJob(this.id(owner, id));
    if (!job) throw new NotFoundException('Cutting search not found.');
    return job;
  }
  async status(owner: string, id: string) {
    return this.present(await this.get(owner, id));
  }
  async cancel(owner: string, id: string) {
    const job = await this.get(owner, id);
    if (job.finishedOn || job.progress === 'cancelled') return;
    await job.updateProgress('cancelled');
    this.worker.cancelJob(job.id!);
  }

  // Original synchronous clients share the same queue and admission capacity.
  async waitForPlan(
    owner: string,
    input: OptimizeAllocation,
    signal: AbortSignal,
  ) {
    const id = randomUUID();
    let state = await this.start(owner, id, input);
    try {
      while (!signal.aborted) {
        if (state.status === 'finished') return state.result;
        if (state.status === 'failed')
          throw new ServiceUnavailableException(
            'The cutting search was interrupted. Start a new search.',
          );
        if (state.status === 'cancelled') break;
        await delay(250, undefined, { signal });
        state = await this.status(owner, id);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      if (signal.aborted) await this.cancel(owner, id);
    }
    throw new ConflictException('Optimization cancelled.');
  }
  async onModuleDestroy() {
    if (this.stopping) return;
    this.stopping = true;
    await this.worker.pause(true);
    this.worker.cancelAllJobs('Worker shutting down');
    await this.worker.close();
    await this.events.close();
    await this.queue.close();
  }
}
