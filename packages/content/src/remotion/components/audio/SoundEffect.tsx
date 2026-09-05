/**
 * SoundEffect — plays a one-shot sound effect at a specific frame.
 *
 * Wraps Remotion's <Sequence> + <Audio> for precise timing.
 */

import * as React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import type { SoundEffectProps } from "../../lib/audio";

export const SoundEffect: React.FC<SoundEffectProps> = ({
  src,
  atFrame,
  volume = 0.8,
}) => {
  return (
    <Sequence from={atFrame} layout="none">
      <Audio src={staticFile(src)} volume={volume} />
    </Sequence>
  );
};
