/**
 * SVG → PNG renderer using sharp.
 * Converts generated SVG strings to raster images.
 */

import sharp from "sharp";
import { mkdir } from "fs/promises";
import { dirname } from "path";

export interface RenderOptions {
  svg: string;
  outputPath: string;
  format?: "png" | "jpg" | "webp";
  quality?: number;
}

export async function renderSvgToPng(opts: RenderOptions): Promise<string> {
  const { svg, outputPath, format = "png", quality = 90 } = opts;

  await mkdir(dirname(outputPath), { recursive: true });

  const buffer = Buffer.from(svg);

  let pipeline = sharp(buffer);

  switch (format) {
    case "jpg":
      pipeline = pipeline.jpeg({ quality });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality });
      break;
    default:
      pipeline = pipeline.png();
  }

  await pipeline.toFile(outputPath);
  return outputPath;
}

export async function renderSvgToBuffer(svg: string, format: "png" | "jpg" | "webp" = "png"): Promise<Buffer> {
  const buffer = Buffer.from(svg);
  let pipeline = sharp(buffer);

  switch (format) {
    case "jpg":
      pipeline = pipeline.jpeg({ quality: 90 });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: 90 });
      break;
    default:
      pipeline = pipeline.png();
  }

  return pipeline.toBuffer();
}
