import { beforeEach, describe, expect, it } from "bun:test";
import type { ReactNode } from "react";
import { remotionTestState } from "./helpers/remotion-mock";

const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (node: ReactNode) => string;
};

const { DeviceFrame } = await import("../remotion/components/DeviceFrame");

const { ScreenshotScene } = await import(
  "../remotion/components/scenes/ScreenshotScene"
);
const { ScreenRecordingScene } = await import(
  "../remotion/components/scenes/ScreenRecordingScene"
);

beforeEach(() => {
  remotionTestState.__contentRemotionDurationInFrames = 120;
  remotionTestState.__contentRemotionFrame = 0;
  remotionTestState.__contentRemotionVolume = undefined;
});

describe("DeviceFrame", () => {
  it("renders none as a child-only passthrough", () => {
    const markup = renderToStaticMarkup(
      <DeviceFrame variant="none">
        <span data-testid="frame-content">content</span>
      </DeviceFrame>,
    );

    expect(markup).toBe('<span data-testid="frame-content">content</span>');
    expect(markup).not.toContain("data-device-frame");
    expect(markup).not.toContain("data-device-chrome");
  });

  const framedVariants = [
    ["browser", "browser-toolbar"],
    ["iphone", "iphone-notch"],
    ["ipad", "ipad-bezel"],
    ["macbook", "macbook-base"],
    ["android", "android-camera"],
  ] as const;

  for (const [variant, chrome] of framedVariants) {
    it(`renders ${variant} with distinguishable chrome around its children`, () => {
      const markup = renderToStaticMarkup(
        <DeviceFrame variant={variant}>
          <span data-testid="frame-content">content</span>
        </DeviceFrame>,
      );

      expect(markup).toContain(`data-device-frame="${variant}"`);
      expect(markup).toContain(`data-device-chrome="${chrome}"`);
      expect(markup).toContain('data-testid="frame-content"');
      expect(markup).toContain("content");
    });
  }
});

describe("scene device-frame integration", () => {
  it("wraps screenshot content with the selected frame", () => {
    const markup = renderToStaticMarkup(
      <ScreenshotScene
        type="screenshot"
        src="screenshot.png"
        durationInFrames={120}
        deviceFrame="android"
      />,
    );

    expect(markup).toContain('data-device-frame="android"');
    expect(markup).toContain('data-device-chrome="android-camera"');
  });

  it("wraps screen recordings with the selected frame", () => {
    const markup = renderToStaticMarkup(
      <ScreenRecordingScene
        type="screen-recording"
        src="recording.mp4"
        durationInFrames={120}
        deviceFrame="macbook"
      />,
    );

    expect(markup).toContain('data-device-frame="macbook"');
    expect(markup).toContain('data-device-chrome="macbook-base"');
  });
});
