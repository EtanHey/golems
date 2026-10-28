/** Every test-created Bun process must opt into the test boundary explicitly. */
export const testBun = [
  process.execPath,
  "--no-env-file",
  "--preload",
  new URL("./test-preload.ts", import.meta.url).pathname,
];
