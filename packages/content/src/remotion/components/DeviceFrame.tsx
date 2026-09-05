import type { CSSProperties, ReactNode } from "react";
import { SPACING } from "../lib/design-tokens";

export type DeviceFrameVariant =
  | "none"
  | "browser"
  | "iphone"
  | "ipad"
  | "macbook"
  | "android";

export type DeviceFrameProps = {
  variant: DeviceFrameVariant;
  children: ReactNode;
};

const shellColor = "#111827";
const shellBorder = "1px solid #374151";
const shellShadow = "0 24px 64px rgba(15, 23, 42, 0.35)";

const viewportStyle: CSSProperties = {
  width: "100%",
  overflow: "hidden",
  backgroundColor: "#000000",
};

const trafficLights = ["#EF4444", "#F59E0B", "#22C55E"] as const;

export const DeviceFrame = ({ variant, children }: DeviceFrameProps) => {
  if (variant === "none") {
    return <>{children}</>;
  }

  if (variant === "browser") {
    return (
      <div
        data-device-frame="browser"
        style={{
          width: "100%",
          overflow: "hidden",
          border: "1px solid #CBD5E1",
          borderRadius: 16,
          backgroundColor: "#FFFFFF",
          boxShadow: shellShadow,
          boxSizing: "border-box",
        }}
      >
        <div
          data-device-chrome="browser-toolbar"
          style={{
            height: 40,
            display: "flex",
            alignItems: "center",
            gap: SPACING.sm,
            padding: `0 ${SPACING.sm}px`,
            backgroundColor: "#E5E7EB",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {trafficLights.map((color) => (
              <span
                key={color}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: color,
                }}
              />
            ))}
          </div>
          <div
            style={{
              height: 22,
              flex: 1,
              borderRadius: 11,
              backgroundColor: "#FFFFFF",
              boxShadow: "inset 0 0 0 1px rgba(148, 163, 184, 0.45)",
            }}
          />
        </div>
        <div style={viewportStyle}>{children}</div>
      </div>
    );
  }

  if (variant === "iphone") {
    return (
      <div
        data-device-frame="iphone"
        style={{
          width: "100%",
          position: "relative",
          padding: 10,
          border: shellBorder,
          borderRadius: 42,
          backgroundColor: shellColor,
          boxShadow: shellShadow,
          boxSizing: "border-box",
        }}
      >
        <div
          data-device-chrome="iphone-notch"
          style={{
            position: "absolute",
            zIndex: 1,
            top: 10,
            left: "50%",
            width: "34%",
            minWidth: 64,
            maxWidth: 180,
            height: 22,
            borderRadius: "0 0 14px 14px",
            backgroundColor: shellColor,
            transform: "translateX(-50%)",
          }}
        />
        <div style={{ ...viewportStyle, borderRadius: 32 }}>{children}</div>
      </div>
    );
  }

  if (variant === "ipad") {
    return (
      <div
        data-device-frame="ipad"
        data-device-chrome="ipad-bezel"
        style={{
          width: "100%",
          padding: SPACING.xs,
          border: shellBorder,
          borderRadius: 22,
          backgroundColor: shellColor,
          boxShadow: shellShadow,
          boxSizing: "border-box",
        }}
      >
        <div style={{ ...viewportStyle, borderRadius: 14 }}>{children}</div>
      </div>
    );
  }

  if (variant === "macbook") {
    return (
      <div
        data-device-frame="macbook"
        style={{
          width: "100%",
          position: "relative",
          paddingBottom: 14,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            padding: SPACING.xs,
            border: shellBorder,
            borderRadius: "14px 14px 6px 6px",
            backgroundColor: shellColor,
            boxShadow: shellShadow,
          }}
        >
          <div style={{ ...viewportStyle, borderRadius: 5 }}>{children}</div>
        </div>
        <div
          data-device-chrome="macbook-base"
          style={{
            position: "absolute",
            bottom: 0,
            left: "-4%",
            width: "108%",
            height: 14,
            borderRadius: "2px 2px 12px 12px",
            background: "linear-gradient(180deg, #E2E8F0 0%, #94A3B8 100%)",
            boxShadow: "0 8px 18px rgba(15, 23, 42, 0.25)",
          }}
        >
          <div
            style={{
              width: "18%",
              height: 4,
              margin: "0 auto",
              borderRadius: "0 0 4px 4px",
              backgroundColor: "#64748B",
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-device-frame="android"
      style={{
        width: "100%",
        position: "relative",
        padding: 10,
        border: shellBorder,
        borderRadius: 34,
        backgroundColor: shellColor,
        boxShadow: shellShadow,
        boxSizing: "border-box",
      }}
    >
      <div
        data-device-chrome="android-camera"
        style={{
          position: "absolute",
          zIndex: 1,
          top: 15,
          left: "50%",
          width: 12,
          height: 12,
          borderRadius: "50%",
          backgroundColor: "#020617",
          boxShadow: "inset 0 0 0 2px #334155",
          transform: "translateX(-50%)",
        }}
      />
      <div style={{ ...viewportStyle, borderRadius: 25 }}>{children}</div>
    </div>
  );
};
