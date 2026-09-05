/**
 * Narration — plays pre-generated narration audio.
 *
 * In production, use pre-generated audio files (src prop).
 * The segments/ttsConfig props are metadata for the TTS generation pipeline
 * (not used at render time — generation happens as a separate build step).
 */

import * as React from "react";
import { Audio, staticFile } from "remotion";
import type { NarrationProps } from "../../lib/audio";

export const Narration: React.FC<NarrationProps> = ({
  src,
  volume = 1.0,
}) => {
  if (!src) return null;

  return <Audio src={staticFile(src)} volume={volume} />;
};
