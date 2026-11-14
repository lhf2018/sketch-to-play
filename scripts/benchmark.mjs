import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
await page.goto("http://127.0.0.1:5173");
await page.getByText("已保存在本机", { exact: false }).waitFor();
await page.bringToFront();
const result = await page.evaluate(async () => {
  const { emptyProject, makeObject, store, play, resetSimulation, runtime } =
    window.__SKETCH_DEV__;
  const project = emptyProject();
  for (let i = 0; i < 30; i++)
    project.scene.objects.push(
      makeObject("ball", [1 + (i % 6) * 1.7, 2 + Math.floor(i / 6) * 1.1]),
    );
  for (let i = 0; i < 50; i++) {
    const o = makeObject("track", [
      0.3 + (i % 10),
      0.4 + Math.floor(i / 10) * 0.12,
    ]);
    o.shape.points = Array.from({ length: i < 10 ? 5 : 4 }, (_, j) => [
      j * 0.18,
      0,
    ]);
    project.scene.objects.push(o);
  }
  store.replace(project);
  const start = performance.now();
  await play();
  const startup = performance.now() - start,
    sim = runtime.current;
  const originalStep = sim.step.bind(sim),
    stepTimes = [];
  sim.step = (scene) => {
    const t = performance.now();
    originalStep(scene);
    stepTimes.push(performance.now() - t);
  };
  const intervals = [];
  let previous = performance.now();
  const beginning = previous;
  await new Promise((resolve) => {
    function frame(now) {
      const elapsed = now - previous;
      previous = now;
      if (elapsed > 0) intervals.push(elapsed);
      if (now - beginning < 60000) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
  const steps = stepTimes.length,
    mode = store.get().mode;
  resetSimulation();
  if (steps < 7000 || mode !== "running")
    throw Error(`Invalid sample: mode=${mode}, steps=${steps}`);
  const p95 = (list) =>
    [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)];
  return {
    browser: navigator.userAgent,
    objects: 80,
    balls: 30,
    segments: 160,
    duration: 60000,
    frames: intervals.length,
    physicsSteps: steps,
    meanFps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
    frameP95: p95(intervals),
    physicsStepP95: p95(stepTimes),
    coldPhysicsInitMs: startup,
    scope:
      "Development build, headless Chromium, full Canvas rendering and simulation. Not the PRD reference hardware or production-load test.",
  };
});
const report = {
  date: new Date().toISOString(),
  host: {
    platform: os.platform(),
    cpu: os.cpus()[0].model,
    logicalCores: os.cpus().length,
    memoryGiB: os.totalmem() / 2 ** 30,
  },
  ...result,
};
await mkdir("docs/benchmarks", { recursive: true });
await writeFile("docs/benchmarks/local.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
