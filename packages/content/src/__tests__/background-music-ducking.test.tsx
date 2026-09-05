import { describe, expect, it } from "bun:test";
import type { ReactNode } from "react";
import { remotionTestState } from "./helpers/remotion-mock";

const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (node: ReactNode) => string;
};

const { BackgroundMusic } = await import(
  "../remotion/components/audio/BackgroundMusic"
);

type RenderOptions = {
  frame: number;
  startFrom?: number;
  volume?: number;
  duckToVolume?: number;
  duckWindows?: Array<{ fromFrame: number; toFrame: number }>;
};

const renderVolume = ({
  frame,
  startFrom = 0,
  volume = 0.5,
  duckToVolume,
  duckWindows,
}: RenderOptions): number => {
  remotionTestState.__contentRemotionDurationInFrames = 300;
  remotionTestState.__contentRemotionFrame = frame;
  remotionTestState.__contentRemotionVolume = undefined;

  renderToStaticMarkup(
    <BackgroundMusic
      src="music.mp3"
      startFrom={startFrom}
      volume={volume}
      fadeInFrames={10}
      fadeOutFrames={10}
      duckToVolume={duckToVolume}
      duckWindows={duckWindows}
    />,
  );

  if (remotionTestState.__contentRemotionVolume === undefined) {
    throw new Error("BackgroundMusic did not render an Audio volume");
  }

  return remotionTestState.__contentRemotionVolume;
};

describe("BackgroundMusic narration ducking", () => {
  it("keeps the base volume outside narration windows", () => {
    expect(renderVolume({
      frame: 50,
      duckToVolume: 0.2,
      duckWindows: [{ fromFrame: 100, toFrame: 160 }],
    })).toBeCloseTo(0.5);
  });

  it("ducks to the requested volume inside a narration window", () => {
    expect(renderVolume({
      frame: 120,
      duckToVolume: 0.2,
      duckWindows: [{ fromFrame: 100, toFrame: 160 }],
    })).toBeCloseTo(0.1);
  });

  it("ramps monotonically from full volume to ducked volume at a window edge", () => {
    const before = renderVolume({
      frame: 92,
      duckToVolume: 0.2,
      duckWindows: [{ fromFrame: 100, toFrame: 160 }],
    });
    const during = renderVolume({
      frame: 96,
      duckToVolume: 0.2,
      duckWindows: [{ fromFrame: 100, toFrame: 160 }],
    });
    const after = renderVolume({
      frame: 100,
      duckToVolume: 0.2,
      duckWindows: [{ fromFrame: 100, toFrame: 160 }],
    });

    expect(before).toBeCloseTo(0.5);
    expect(during).toBeLessThan(before);
    expect(during).toBeGreaterThan(after);
    expect(after).toBeCloseTo(0.1);
  });

  it("converts the Sequence-local frame to a composition frame", () => {
    expect(renderVolume({
      frame: 68,
      startFrom: 40,
      duckToVolume: 0.2,
      duckWindows: [{ fromFrame: 100, toFrame: 160 }],
    })).toBeCloseTo(0.1);
  });

  it("does not duck when duckToVolume is undefined", () => {
    expect(renderVolume({
      frame: 120,
      duckWindows: [{ fromFrame: 100, toFrame: 160 }],
    })).toBeCloseTo(0.5);
  });

  it("ignores narration windows that do not have a positive duration", () => {
    expect(renderVolume({
      frame: 100,
      duckToVolume: 0.2,
      duckWindows: [{ fromFrame: 100, toFrame: 100 }],
    })).toBeCloseTo(0.5);
  });

  it("clamps the final composed volume to the supported range", () => {
    expect(renderVolume({ frame: 50, volume: 2 })).toBe(1);
  });
});
