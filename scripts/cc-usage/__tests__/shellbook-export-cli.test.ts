import { describe, expect, test } from "bun:test";
import { parseShellbookExportArgs } from "../shellbook-export-cli";

describe("Shellbook export CLI args", () => {
  test("defaults to all time", () => {
    expect(parseShellbookExportArgs([])).toEqual({});
  });

  test("supports days with equals or separate value", () => {
    expect(parseShellbookExportArgs(["--days=30"])).toEqual({
      fromDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(parseShellbookExportArgs(["--days", "30"])).toEqual({
      fromDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  test("supports explicit from date", () => {
    expect(parseShellbookExportArgs(["--from=2026-01-08"])).toEqual({
      fromDate: "2026-01-08",
    });
  });

  test("rejects invalid days and dates", () => {
    expect(() => parseShellbookExportArgs(["--days=0"])).toThrow(
      "--days must be a positive integer",
    );
    expect(() => parseShellbookExportArgs(["--from=bad"])).toThrow(
      "--from must be YYYY-MM-DD",
    );
  });
});
