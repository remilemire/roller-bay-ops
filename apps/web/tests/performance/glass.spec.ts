import { writeFile } from 'node:fs/promises';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { mockApi } from '../e2e/fixtures';
import { stock } from '../fixtures';

async function metrics(cdp: CDPSession) {
  const result = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(
    result.metrics.map(({ name, value }: { name: string; value: number }) => [
      name,
      value,
    ]),
  ) as Record<string, number>;
}

async function sample(
  page: Page,
  cdp: CDPSession,
  browserCdp: CDPSession,
  scroll: boolean,
) {
  const processesBefore = await browserCdp.send('SystemInfo.getProcessInfo');
  const before = await metrics(cdp);
  const frames = await page.evaluate(async (scrolling) => {
    const intervals: number[] = [];
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask' });
    const started = performance.now();
    let previous = started;
    await new Promise<void>((resolve) => {
      function frame(now: number) {
        intervals.push(now - previous);
        previous = now;
        if (scrolling) {
          const distance = document.documentElement.scrollHeight - innerHeight;
          window.scrollTo(
            0,
            distance * (0.5 - Math.cos((now - started) / 350) / 2),
          );
        }
        if (now - started < 2000) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    observer.disconnect();
    // The first callback measures scheduling from setup, not a complete frame.
    intervals.shift();
    intervals.sort((a, b) => a - b);
    return {
      elapsedMs: performance.now() - started,
      frames: intervals.length,
      p95FrameMs: intervals[Math.floor(intervals.length * 0.95)],
      framesOver25ms: intervals.filter((value) => value > 25).length,
      framesOver33ms: intervals.filter((value) => value > 33.34).length,
      longTasks: longTasks.length,
    };
  }, scroll);
  const after = await metrics(cdp);
  const processesAfter = await browserCdp.send('SystemInfo.getProcessInfo');
  const processTimes = new Map<number, number>(
    processesBefore.processInfo.map(
      (process: { id: number; cpuTime: number }) => [
        process.id,
        process.cpuTime,
      ],
    ),
  );
  let browserCpuMs = 0;
  let gpuProcessCpuMs = 0;
  for (const process of processesAfter.processInfo) {
    const elapsed =
      Math.max(
        0,
        process.cpuTime - (processTimes.get(process.id) ?? process.cpuTime),
      ) * 1000;
    browserCpuMs += elapsed;
    if (process.type.toLowerCase() === 'gpu') gpuProcessCpuMs += elapsed;
  }
  return {
    activity: scroll ? 'scroll' : 'idle',
    ...frames,
    mainThreadMs: (after.TaskDuration! - before.TaskDuration!) * 1000,
    layoutMs: (after.LayoutDuration! - before.LayoutDuration!) * 1000,
    styleMs: (after.RecalcStyleDuration! - before.RecalcStyleDuration!) * 1000,
    jsHeapMiB: after.JSHeapUsedSize! / 1024 / 1024,
    browserCpuMs,
    gpuProcessCpuMs,
  };
}

test('glass resource measurements on a full stock page', async ({
  page,
  context,
  browser,
}, info) => {
  const baseline = process.env.GLASS_BENCHMARK_LABEL === 'baseline';
  const browserCdp = await browser.newBrowserCDPSession();
  const system = await browserCdp.send('SystemInfo.getInfo');
  // A single init script avoids relying on the execution order of several
  // scripts installed for successive mode/preference combinations.
  await page.addInitScript(() => {
    const params = new URLSearchParams(location.search);
    localStorage.setItem(
      'roller-bay-theme',
      params.get('benchmarkMode') ?? 'light',
    );
    localStorage.setItem(
      'roller-bay-reduce-transparency',
      params.get('benchmarkReduced') ?? 'false',
    );
  });
  await mockApi(page);
  await page.route('**/api/stock-items?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: {
        items: Array.from({ length: 25 }, (_, index) => ({
          ...stock,
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        })),
        total: 25,
        page: 1,
        pageSize: Number(url.searchParams.get('pageSize') ?? 25),
      },
    });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const results = [];
  for (const mode of ['light', 'dark']) {
    for (const reduced of baseline ? [false] : [false, true]) {
      await page.goto(
        `/stock-items?benchmarkMode=${mode}&benchmarkReduced=${reduced}`,
      );
      await expect(page.locator('tbody tr')).toHaveCount(25);
      await expect(page.locator('html')).toHaveClass(mode);
      if (!baseline) {
        await expect(page.locator('html')).toHaveAttribute(
          'data-reduce-transparency',
          String(reduced),
        );
      }
      // Let the short theme transition and initial rasterization finish.
      await page.waitForTimeout(600);
      await cdp.send('HeapProfiler.collectGarbage');
      const surfaces = await page.evaluate(() => {
        const blurred = Array.from(
          document.querySelectorAll<HTMLElement>('body *'),
        ).filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.backdropFilter !== 'none';
        });
        return {
          blurred: blurred.map((element) => element.className),
          nestedBlur: blurred.some((element) =>
            blurred.some(
              (other) => other !== element && other.contains(element),
            ),
          ),
        };
      });
      for (let run = 1; run <= 3; run++) {
        for (const scroll of [false, true]) {
          results.push({
            mode,
            reduced,
            run,
            ...surfaces,
            ...(await sample(page, cdp, browserCdp, scroll)),
          });
        }
      }
    }
  }
  const report = {
    label: process.env.GLASS_BENCHMARK_LABEL ?? 'current',
    project: info.project.name,
    browser: browser.version(),
    viewport: page.viewportSize(),
    rendering: {
      renderer: system.gpu.auxAttributes?.glRenderer,
      features: system.gpu.featureStatus,
    },
    note: 'Production build, intercepted API, Chromium on this Mac. Tablet is viewport emulation. Frame sampling adds requestAnimationFrame callbacks. Browser CPU includes all reported browser processes, including the GPU process (software rasterization in this run). GPU-process CPU is not physical GPU utilization. JS heap is not total browser memory. GPU memory, energy use, and real tablet hardware are not measured.',
    results,
  };
  await writeFile(
    info.outputPath('metrics.json'),
    JSON.stringify(report, null, 2),
  );
  await info.attach('metrics', {
    body: JSON.stringify(report),
    contentType: 'application/json',
  });
  await cdp.detach();
  await browserCdp.detach();
});
