/**
 * Shared SVG utilities for infographic templates.
 */

/** Strip outer <svg> tag and scale inner content to fit target dimensions. */
export function stripSvgWrapper(svg: string, targetW: number, targetH: number): string {
  // Extract viewBox dimensions with indexOf (no regex backtracking)
  const vbMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!vbMatch) {
    // Fallback: strip opening and closing svg tags using indexOf
    return stripSvgTags(svg);
  }

  const origW = parseInt(vbMatch[1]);
  const origH = parseInt(vbMatch[2]);
  const scale = Math.min(targetW / origW, targetH / origH);

  const inner = stripSvgTags(svg)
    // Remove background rect (template provides its own)
    .replace(/<rect width="\d+" height="\d+" fill="[^"]*" rx="\d+"\/?>/, "");

  return `<g transform="scale(${scale.toFixed(3)})">${inner}</g>`;
}

/** Remove opening and closing <svg ...> tags using indexOf (no backtracking regex). */
function stripSvgTags(svg: string): string {
  let result = svg;

  // Remove opening <svg ...> tag
  const openStart = result.indexOf("<svg");
  if (openStart !== -1) {
    const openEnd = result.indexOf(">", openStart);
    if (openEnd !== -1) {
      result = result.slice(0, openStart) + result.slice(openEnd + 1);
    }
  }

  // Remove closing </svg> tag
  const closeIdx = result.lastIndexOf("</svg>");
  if (closeIdx !== -1) {
    result = result.slice(0, closeIdx) + result.slice(closeIdx + 6);
  }

  return result;
}

/** Escape text for safe XML embedding. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
