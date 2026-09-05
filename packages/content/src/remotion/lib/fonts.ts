/**
 * Font loading — must be called once before render.
 *
 * Remotion requires explicit font loading via @remotion/google-fonts.
 * Import this file in your Root.tsx or composition entry.
 */

import { loadFont as loadHeebo } from "@remotion/google-fonts/Heebo";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: heeboFamily } = loadHeebo();
const { fontFamily: interFamily } = loadInter();

export const LOADED_FONTS = {
  hebrew: heeboFamily,
  english: interFamily,
} as const;
