import { readFileSync, writeFileSync } from "node:fs";

export function readFixture(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function materializeOversizeTranscript(path, fixture) {
  const paddingLine = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "x".repeat(4096) }],
    },
  });
  const lines = [];
  let bytes = 0;
  while (bytes < fixture.paddingBytes) {
    lines.push(paddingLine);
    bytes += Buffer.byteLength(paddingLine) + 1;
  }
  for (const event of fixture.tailEvents) lines.push(JSON.stringify(event));
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return Buffer.byteLength(readFileSync(path));
}
