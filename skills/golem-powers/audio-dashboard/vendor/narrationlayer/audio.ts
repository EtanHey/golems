// Type-only portability adaptation; upstream ffmpeg runtime is intentionally omitted.
export interface AudioAssemblyChunk {
  audioPath: string;
  pauseAfterSeconds: number;
}
