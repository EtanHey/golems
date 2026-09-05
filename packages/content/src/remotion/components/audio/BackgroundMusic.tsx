/**
 * BackgroundMusic — plays background audio with fade in/out and volume ducking.
 *
 * Uses Sequence for timeline positioning (startFrom = composition frame).
 * Volume automatically fades in/out and ducks across composition-absolute narration windows.
 */

import * as React from "react";
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clampedInterpolate } from "../../lib/motion";
import type { BackgroundMusicProps } from "../../lib/audio";

const DUCK_FADE_FRAMES = 8;

const BackgroundMusicInner: React.FC<
  Omit<BackgroundMusicProps, "startFrom"> & {
    compositionStartFrame: number;
    parentDurationInFrames: number;
  }
> = ({
  src,
  volume = 0.3,
  fadeInFrames = 30,
  fadeOutFrames = 30,
  duckToVolume,
  duckWindows,
  loop = true,
  compositionStartFrame,
  parentDurationInFrames,
}) => {
  const frame = useCurrentFrame();
  const compositionFrame = frame + compositionStartFrame;

  // Fade in from start of this Sequence
  const fadeIn = clampedInterpolate(frame, [0, fadeInFrames], [0, 1]);

  // Fade out at end of parent composition
  const fadeOut = clampedInterpolate(
    frame,
    [parentDurationInFrames - fadeOutFrames, parentDurationInFrames],
    [1, 0],
  );

  const duckMultiplier = duckToVolume === undefined
    ? 1
    : (duckWindows ?? []).reduce((currentMultiplier, window) => {
      const fadeIntoDuckStart = window.fromFrame - DUCK_FADE_FRAMES;
      const fadeOutOfDuckEnd = window.toFrame + DUCK_FADE_FRAMES;

      if (
        window.toFrame <= window.fromFrame ||
        compositionFrame < fadeIntoDuckStart ||
        compositionFrame > fadeOutOfDuckEnd
      ) {
        return currentMultiplier;
      }

      let windowMultiplier = duckToVolume;
      if (compositionFrame < window.fromFrame) {
        windowMultiplier = clampedInterpolate(
          compositionFrame,
          [fadeIntoDuckStart, window.fromFrame],
          [1, duckToVolume],
        );
      } else if (compositionFrame > window.toFrame) {
        windowMultiplier = clampedInterpolate(
          compositionFrame,
          [window.toFrame, fadeOutOfDuckEnd],
          [duckToVolume, 1],
        );
      }

      return Math.min(currentMultiplier, windowMultiplier);
    }, 1);
  const currentVolume = Math.min(
    1,
    Math.max(0, volume * fadeIn * fadeOut * duckMultiplier),
  );

  return (
    <Audio
      src={staticFile(src)}
      volume={currentVolume}
      loop={loop}
    />
  );
};

export const BackgroundMusic: React.FC<BackgroundMusicProps> = ({
  startFrom = 0,
  ...rest
}) => {
  const { durationInFrames } = useVideoConfig();

  return (
    <Sequence from={startFrom} layout="none">
      <BackgroundMusicInner
        {...rest}
        compositionStartFrame={startFrom}
        parentDurationInFrames={durationInFrames - startFrom}
      />
    </Sequence>
  );
};
