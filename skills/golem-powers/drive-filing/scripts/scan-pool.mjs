import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { SCAN_TIMEOUT_MS } from './scan-content.mjs';

export const defaultWorkers = () => Math.max(1, Math.min(16, availableParallelism() - 1));
export class ScanPool {
  constructor(count, deadline) { this.count = count; this.deadline = deadline; this.queue = []; this.slots = new Set(); }
  run(task) {
    return new Promise(resolve => { this.queue.push({task, resolve}); this.pump(); });
  }
  pump() {
    while (this.queue.length && this.slots.size < this.count) this.start();
    for (const slot of this.slots) if (!slot.busy && this.queue.length) this.assign(slot);
  }
  start() {
    const slot = {worker: new Worker(new URL('./scan-worker.mjs', import.meta.url)), busy: false};
    this.slots.add(slot);
    slot.worker.on('message', result => this.finish(slot, result));
    slot.worker.on('error', () => this.finish(slot, {shapes:['scan-worker-error']}, true));
    slot.worker.on('exit', () => {
      if (this.slots.has(slot)) this.finish(slot, {shapes:['scan-worker-error']}, true);
    });
    this.assign(slot);
  }
  assign(slot) {
    const job = this.queue.shift(); if (!job) return;
    const left = this.deadline - Date.now();
    if (left <= 0) { job.resolve({shapes:['scan-run-time-limit']}); queueMicrotask(() => this.pump()); return; }
    slot.busy = job;
    slot.timer = setTimeout(() => this.finish(slot, {shapes:[left < SCAN_TIMEOUT_MS ? 'scan-run-time-limit' : 'scan-time-limit']}, true), Math.min(left, SCAN_TIMEOUT_MS));
    slot.worker.postMessage(job.task);
  }
  finish(slot, result, retire = false) {
    clearTimeout(slot.timer);
    const job = slot.busy; slot.busy = false;
    if (retire) { this.slots.delete(slot); slot.worker.terminate(); }
    job?.resolve(result);
    this.pump();
  }
  async close() { await Promise.all([...this.slots].map(s => { this.slots.delete(s); return s.worker.terminate(); })); }
}
