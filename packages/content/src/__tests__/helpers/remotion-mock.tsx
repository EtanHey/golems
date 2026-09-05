import { mock } from "bun:test";
import type { CSSProperties, ReactNode } from "react";

type RemotionTestState = typeof globalThis & {
  __contentRemotionDurationInFrames?: number;
  __contentRemotionFrame?: number;
  __contentRemotionVolume?: number;
};

export const remotionTestState = globalThis as RemotionTestState;

mock.module("remotion", () => ({
  AbsoluteFill: ({ children, style }: { children?: ReactNode; style?: CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  Audio: ({ volume }: { volume: number }) => {
    remotionTestState.__contentRemotionVolume = volume;
    return <audio data-volume={volume} />;
  },
  Img: ({ src, style }: { src: string; style?: CSSProperties }) => (
    <img src={src} style={style} />
  ),
  OffthreadVideo: ({ src, style }: { src: string; style?: CSSProperties }) => (
    <video src={src} style={style} />
  ),
  Sequence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  staticFile: (src: string) => src,
  useCurrentFrame: () => remotionTestState.__contentRemotionFrame ?? 0,
  useVideoConfig: () => ({
    durationInFrames: remotionTestState.__contentRemotionDurationInFrames ?? 120,
    fps: 30,
    height: 1080,
    width: 1920,
  }),
  interpolate: (
    input: number,
    inputRange: readonly number[],
    outputRange: readonly number[],
    options?: { extrapolateLeft?: string; extrapolateRight?: string },
  ) => {
    const [inputStart = 0, inputEnd = 1] = inputRange;
    const [outputStart = 0, outputEnd = 1] = outputRange;

    if (inputEnd <= inputStart) {
      throw new Error("inputRange must be strictly monotonically increasing");
    }
    if (input <= inputStart && options?.extrapolateLeft === "clamp") {
      return outputStart;
    }
    if (input >= inputEnd && options?.extrapolateRight === "clamp") {
      return outputEnd;
    }

    const progress = (input - inputStart) / (inputEnd - inputStart);
    return outputStart + progress * (outputEnd - outputStart);
  },
  spring: () => 1,
}));
