/**
 * ProductHero — scene sequencer composition.
 *
 * Assembles TitleCard, Screenshot, Metrics, and ScreenRecording scenes
 * into a complete product showcase video with transitions and audio.
 * Fully data-driven via JSON props — an AI agent can generate the
 * entire video from a project description.
 */

import * as React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  DURATIONS,
  clampedInterpolate,
  type Scene,
  type BrandColors,
  TitleCardScene,
  ScreenshotScene,
  MetricsScene,
  ScreenRecordingScene,
} from "../../lib";

// --- Transition Components ---

type TransitionType = "crossfade" | "slide-left" | "slide-up" | "none";

const TRANSITION_FRAMES = DURATIONS.TRANSITION; // 15 frames overlap

const CrossfadeIn: React.FC<{
  frame: number;
  children: React.ReactNode;
}> = ({ frame, children }) => {
  const opacity = clampedInterpolate(frame, [0, TRANSITION_FRAMES], [0, 1]);
  return <div style={{ opacity }}>{children}</div>;
};

const CrossfadeOut: React.FC<{
  frame: number;
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ frame, durationInFrames, children }) => {
  const opacity = clampedInterpolate(
    frame,
    [durationInFrames - TRANSITION_FRAMES, durationInFrames],
    [1, 0],
  );
  return <div style={{ opacity }}>{children}</div>;
};

// --- Scene Renderer ---

const SceneRenderer: React.FC<{
  scene: Scene;
  brand: BrandColors;
}> = ({ scene, brand }) => {
  const sceneBrand = scene.brand ?? brand;

  switch (scene.type) {
    case "title-card":
      return <TitleCardScene {...scene} brand={sceneBrand} />;
    case "screenshot":
      return <ScreenshotScene {...scene} brand={sceneBrand} />;
    case "metrics":
      return <MetricsScene {...scene} brand={sceneBrand} />;
    case "screen-recording":
      return <ScreenRecordingScene {...scene} brand={sceneBrand} />;
    default:
      return null;
  }
};

// --- Progress Bar ---

const ProgressBar: React.FC<{
  brand: BrandColors;
}> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / durationInFrames;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: `${brand.textMuted}33`,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress * 100}%`,
          backgroundColor: brand.accent,
          borderRadius: "0 2px 2px 0",
        }}
      />
    </div>
  );
};

// --- Main Composition ---

export type ProductHeroCompositionProps = {
  /** Scenes in order */
  scenes: Scene[];
  /** Brand colors (applied to all scenes unless overridden) */
  brand: BrandColors;
  /** Transition type between scenes */
  transition?: TransitionType;
  /** Show progress bar at bottom */
  showProgressBar?: boolean;
};

/**
 * Calculate total duration from scenes.
 * Used by calculateMetadata for dynamic duration.
 */
export function calculateTotalFrames(scenes: Scene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
}

export const ProductHero: React.FC<ProductHeroCompositionProps> = ({
  scenes,
  brand,
  transition = "crossfade",
  showProgressBar = false,
}) => {
  const frame = useCurrentFrame();

  // Calculate frame offsets for each scene
  let runningOffset = 0;
  const sceneOffsets = scenes.map((scene) => {
    const offset = runningOffset;
    runningOffset += scene.durationInFrames;
    return offset;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: brand.background }}>
      {scenes.map((scene, i) => {
        const offset = sceneOffsets[i];
        const isActive =
          frame >= offset && frame < offset + scene.durationInFrames;
        const isTransitioning =
          i > 0 &&
          frame >= offset &&
          frame < offset + TRANSITION_FRAMES &&
          transition !== "none";

        if (!isActive && !isTransitioning) return null;

        return (
          <Sequence
            key={i}
            from={offset}
            durationInFrames={scene.durationInFrames}
          >
            <AbsoluteFill>
              <SceneRenderer scene={scene} brand={brand} />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {showProgressBar && <ProgressBar brand={brand} />}
    </AbsoluteFill>
  );
};
