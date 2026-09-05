import { describe, it, expect } from "bun:test";
import {
  modelContextWindow,
  resolveContextWindow,
  computeContextPct,
  resolveContextWindowForStatus,
  computeContextPctForStatus,
} from "./lib/model-context-window.ts";

describe("model-context-window", () => {
  it("resolves 1M for current-gen Opus 4.8 (id and display forms)", () => {
    expect(modelContextWindow("claude-opus-4-8[1m]")).toBe(1_000_000);
    expect(modelContextWindow("Opus 4.6")).toBe(1_000_000);
    expect(modelContextWindow("Opus 4.8")).toBe(1_000_000);
    expect(modelContextWindow("claude-sonnet-4-6")).toBe(1_000_000);
    expect(modelContextWindow("Haiku 4.6")).toBe(1_000_000);
  });

  it("resolves 1M for a bare 'Opus'/'Sonnet' (narrow display, version dropped)", () => {
    expect(modelContextWindow("Opus")).toBe(1_000_000);
    expect(modelContextWindow("Sonnet")).toBe(1_000_000);
  });

  it("keeps 200K for older/Haiku Claude", () => {
    expect(modelContextWindow("claude-2.1")).toBe(200_000);
    expect(modelContextWindow("Claude 2.1")).toBe(200_000);
    expect(modelContextWindow("claude-instant-1.2")).toBe(200_000);
    expect(modelContextWindow("claude-v1.3")).toBe(200_000);
    expect(modelContextWindow("claude-3-haiku-20240307")).toBe(200_000);
    expect(modelContextWindow("claude-3-5-sonnet-20241022")).toBe(200_000);
    expect(modelContextWindow("Opus 4")).toBe(200_000);
    expect(modelContextWindow("Opus 4.0")).toBe(200_000);
    expect(modelContextWindow("claude-opus-4-0")).toBe(200_000);
    expect(modelContextWindow("claude-opus-4-20250514")).toBe(200_000);
    expect(modelContextWindow("Sonnet 4")).toBe(200_000);
    expect(modelContextWindow("Sonnet 4.0")).toBe(200_000);
    expect(modelContextWindow("claude-sonnet-4-0")).toBe(200_000);
    expect(modelContextWindow("claude-sonnet-4-20250514")).toBe(200_000);
    expect(modelContextWindow("Haiku 4")).toBe(200_000);
    expect(modelContextWindow("Haiku 4.0")).toBe(200_000);
    expect(modelContextWindow("claude-haiku-4-0")).toBe(200_000);
    expect(modelContextWindow("claude-sonnet-4-5")).toBe(200_000);
    expect(modelContextWindow("Haiku 4.5")).toBe(200_000);
    expect(modelContextWindow("Opus 4.5")).toBe(200_000);
  });

  it("does not mark pre-3 Claude models as inferred future models", () => {
    expect(
      resolveContextWindowForStatus({
        model: "claude-2.1",
        contextWindow: null,
      }),
    ).toEqual({
      window: 200_000,
      source: "model",
      inferredUnknownClaude: false,
    });
  });

  it("gives non-Claude models their real windows", () => {
    expect(modelContextWindow("gpt-5.4")).toBe(400_000);
    expect(modelContextWindow("gpt-4o")).toBe(128_000);
    expect(modelContextWindow("gemini-3-pro")).toBe(1_048_576);
  });

  it("defaults future Claude models to 1M instead of the legacy 200K fallback", () => {
    expect(modelContextWindow("claude-opus-5")).toBe(1_000_000);
    expect(modelContextWindow("claude-opus-6")).toBe(1_000_000);
    expect(modelContextWindow("claude-opus-4-9")).toBe(1_000_000);
    expect(modelContextWindow("claude-opus-4-10")).toBe(1_000_000);
    expect(modelContextWindow("claude-sonnet-5")).toBe(1_000_000);
    expect(modelContextWindow("claude-sonnet-4-7")).toBe(1_000_000);
    expect(modelContextWindow("claude-haiku-5")).toBe(1_000_000);
    expect(modelContextWindow("Haiku 5")).toBe(1_000_000);
    expect(resolveContextWindow("claude-new-family-9")).toBe(1_000_000);
  });

  it("falls back to the 200K default for unknown non-Claude / missing models", () => {
    expect(resolveContextWindow("some-unknown-model")).toBe(200_000);
    expect(resolveContextWindow(null)).toBe(200_000);
  });

  it("prefers the live statusline context window when Claude Code provides it", () => {
    expect(
      resolveContextWindowForStatus({
        model: "claude-sonnet-4-5",
        contextWindow: {
          context_window_size: 1_000_000,
          used_percentage: 19.6,
        },
      }),
    ).toEqual({
      window: 1_000_000,
      source: "live",
      inferredUnknownClaude: false,
    });
  });

  it("prefers exact token math over Claude Code's integer-rounded used_percentage", () => {
    // Claude Code rounds used_percentage to a whole number. When it also hands us the
    // token counts, the exact quotient is strictly more precise, so it wins.
    expect(
      computeContextPctForStatus({
        contextTokens: 196_000,
        model: "claude-haiku-4-5",
        contextWindow: {
          context_window_size: 1_000_000,
          used_percentage: 12.3,
        },
      }),
    ).toBeCloseTo(19.6, 1);

    // used_percentage is still the fallback when no token count is available.
    expect(
      computeContextPctForStatus({
        contextTokens: 0,
        model: "claude-haiku-4-5",
        contextWindow: {
          context_window_size: 1_000_000,
          used_percentage: 12.3,
        },
      }),
    ).toBe(12.3);

    expect(
      computeContextPctForStatus({
        contextTokens: 0,
        model: "claude-haiku-4-5",
        contextWindow: {
          context_window_size: 1_000_000,
          used_percentage: 150,
        },
      }),
    ).toBe(100);

    expect(
      computeContextPctForStatus({
        contextTokens: 196_000,
        model: "claude-haiku-4-5",
        contextWindow: {
          context_window_size: 1_000_000,
        },
      }),
    ).toBeCloseTo(19.6, 1);

    const fallbackResolution = resolveContextWindowForStatus({
      model: "claude-haiku-4-5",
      contextWindow: {
        context_window_size: 1_000_000,
      },
    });

    expect(fallbackResolution.window).toBe(1_000_000);
    expect((196_000 / fallbackResolution.window) * 100).toBeCloseTo(19.6, 1);
  });

  // REGRESSION (review of PR #730 by golemsClaude-db1ff995, merged before the fix landed):
  // `used_percentage`-first was a DELIBERATE guard, introduced in 630f8e99, for the case where
  // OUR denominator is a guess. An unmapped Claude model with no `context_window_size` gets the
  // 1M unknown-Claude default, which may be 5x too large — exact math against it UNDER-reports,
  // and under-reporting is the "lead runs to the wall" failure this file exists to prevent.
  // Exact math is only safe when Claude Code told us the window.
  it("defers to used_percentage when the window is INFERRED, not known", () => {
    expect(
      computeContextPctForStatus({
        contextTokens: 150_000,
        model: "claude-opus-9",
        contextWindow: { used_percentage: 75 },
      }),
    ).toBe(75);

    // Sanity: the wrong answer this guards against is the inferred-1M quotient.
    expect((150_000 / 1_000_000) * 100).toBe(15);
  });

  it("still uses exact math when Claude Code gives an authoritative window size", () => {
    expect(
      computeContextPctForStatus({
        contextTokens: 150_000,
        model: "claude-opus-9",
        contextWindow: { context_window_size: 1_000_000, used_percentage: 75 },
      }),
    ).toBe(15);
  });

  it("uses the inferred window only when there is no used_percentage at all", () => {
    expect(
      computeContextPctForStatus({
        contextTokens: 150_000,
        model: "claude-opus-9",
        contextWindow: {},
      }),
    ).toBe(15);
  });

  it("marks unknown Claude fallbacks as inferred so new small models are discoverable", () => {
    expect(
      resolveContextWindowForStatus({
        model: "claude-new-family-9",
        contextWindow: null,
      }),
    ).toEqual({
      window: 1_000_000,
      source: "model",
      inferredUnknownClaude: true,
    });
  });

  // The bug: cc-statusline hardcoded maxCtx = 200000, so an Opus-4.8 agent at 196K tokens
  // rendered 196000/200000 ≈ 98% instead of the real 196000/1000000 ≈ 20%.
  it("renders an Opus-4.8 agent at 196K tokens as ~20%, not ~98%", () => {
    const pct = computeContextPct(196_000, "claude-opus-4-8[1m]");
    expect(Math.round(pct)).toBe(20);
    expect(pct).toBeLessThan(30);
    // Sanity: the old hardcoded-200K denominator would have produced ~98%.
    expect((196_000 / 200_000) * 100).toBeCloseTo(98, 0);
  });

  it("narrow-pane bare 'Opus' at 196K also renders ~20%", () => {
    expect(Math.round(computeContextPct(196_000, "Opus"))).toBe(20);
  });

  it("renders an Opus-5 agent at 196K tokens as ~20%, not ~98%", () => {
    const pct = computeContextPct(196_000, "claude-opus-5");
    expect(Math.round(pct)).toBe(20);
    expect(pct).toBeLessThan(30);
    expect((196_000 / 200_000) * 100).toBeCloseTo(98, 0);
  });

  // Fable 5 (Mythos tier) also ships a 1M window. Etan saw a live 151% on a 1M Fable
  // seat — proof "Fable 5" fell through to the 200K default. Map it + guard the render.
  it("resolves 1M for Fable 5 (id and display forms)", () => {
    expect(modelContextWindow("claude-fable-5")).toBe(1_000_000);
    expect(modelContextWindow("Fable 5")).toBe(1_000_000);
    expect(modelContextWindow("fable")).toBe(1_000_000);
  });

  it("renders a Fable-5 agent at ~300K tokens as ~30%, not >100%", () => {
    const pct = computeContextPct(300_000, "Fable 5");
    expect(Math.round(pct)).toBe(30);
    expect(pct).toBeLessThanOrEqual(100);
  });

  // Defense-in-depth: even an unknown model (200K default) at a huge token count
  // must never render above 100% — the statusline is a gauge, not an overflow meter.
  it("clamps the percentage to 100 for an over-window / unknown model", () => {
    expect(computeContextPct(300_000, "some-unknown-model")).toBe(100);
    expect(computeContextPct(2_000_000, "claude-opus-4-8[1m]")).toBe(100);
  });
});

describe("cc-statusline live context payload", () => {
  it("does not query or render BrainLayer enrichment progress", async () => {
    const source = await Bun.file(
      `${import.meta.dir}/cc-statusline.ts`,
    ).text();

    expect(source).not.toContain("COUNT(*) FROM chunks");
    expect(source).not.toContain("enrichmentPct");
  });

  it("uses current_usage before total_input_tokens when both are present", async () => {
    const proc = Bun.spawn(["bun", "scripts/cc-statusline.ts"], {
      cwd: import.meta.dir.replace(/\/scripts$/, ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.stdin.write(
      JSON.stringify({
        model: { id: "claude-opus-5", display_name: "Opus 5" },
        cwd: import.meta.dir.replace(/\/scripts$/, ""),
        cost: { total_cost_usd: 0, total_duration_ms: 0 },
        context_window: {
          context_window_size: 1_000_000,
          total_input_tokens: 2_000_000,
          current_usage: {
            input_tokens: 100_000,
            cache_read_input_tokens: 50_000,
            cache_creation_input_tokens: 46_000,
          },
        },
      }),
    );
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(output).toContain("🧠 19.6%");
    expect(output).not.toContain("🧠 100.0%");
  });

  // Captured verbatim from a live Opus 5 (1M context) statusline render on 2026-08-19,
  // Claude Code 2.1.235: current_usage sums to 75,203 and Claude Code reported
  // used_percentage: 8 (its integer rounding of 7.52). The statusline prints one decimal,
  // so it must print the exact 7.5%, not a fake-precision 8.0%.
  it("prints the exact percentage from a real 1M-context Opus 5 payload", async () => {
    const proc = Bun.spawn(["bun", "scripts/cc-statusline.ts"], {
      cwd: import.meta.dir.replace(/\/scripts$/, ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.stdin.write(
      JSON.stringify({
        model: { id: "claude-opus-5[1m]", display_name: "Opus 5 (1M context)" },
        cwd: import.meta.dir.replace(/\/scripts$/, ""),
        cost: { total_cost_usd: 0.7671765, total_duration_ms: 57244 },
        context_window: {
          total_input_tokens: 75_203,
          total_output_tokens: 3,
          context_window_size: 1_000_000,
          current_usage: {
            input_tokens: 2,
            output_tokens: 3,
            cache_creation_input_tokens: 4_657,
            cache_read_input_tokens: 70_544,
          },
          used_percentage: 8,
          remaining_percentage: 92,
        },
      }),
    );
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(output).toContain("\u{1f9e0} 7.5%");
    expect(output).not.toContain("\u{1f9e0} 8.0%");
  });

  // The reviewer's exact demo payload: unmapped model, 150,000 tokens, used_percentage 75,
  // NO context_window_size. Before #730 this printed 75.0%; #730 made it 15.0%* — a 5x
  // UNDER-report wearing a green inferred-window asterisk that is easy to miss.
  it("renders the reviewer's inferred-window payload as 75.0%, not 15.0%", async () => {
    const proc = Bun.spawn(["bun", "scripts/cc-statusline.ts"], {
      cwd: import.meta.dir.replace(/\/scripts$/, ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.stdin.write(
      JSON.stringify({
        model: { id: "claude-opus-9", display_name: "Opus 9" },
        cwd: import.meta.dir.replace(/\/scripts$/, ""),
        cost: { total_cost_usd: 0, total_duration_ms: 0 },
        context_window: {
          current_usage: { input_tokens: 150_000 },
          used_percentage: 75,
        },
      }),
    );
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(output).toContain("\u{1f9e0} 75.0%");
    expect(output).not.toContain("15.0%");
    // We used the harness percentage, not our inferred window — so no `*` marker either,
    // which would have implied a guessed denominator we did not actually use.
    expect(output).not.toContain("75.0%*");
  });

  // LOW-2 from the second #730 review: the 200K case below supplies `context_window_size`, so
  // it exercises the live-window path and never consults the model table — it would still pass
  // if claude-haiku-4-5 were mapped to 1M. This one drops the size so the 200K must come from
  // MODEL_WINDOW_RULES, with no used_percentage available to fall back to.
  it("resolves 200K from the model table when no window size is sent", async () => {
    const proc = Bun.spawn(["bun", "scripts/cc-statusline.ts"], {
      cwd: import.meta.dir.replace(/\/scripts$/, ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.stdin.write(
      JSON.stringify({
        model: { id: "claude-haiku-4-5", display_name: "Haiku 4.5" },
        cwd: import.meta.dir.replace(/\/scripts$/, ""),
        cost: { total_cost_usd: 0, total_duration_ms: 0 },
        context_window: { current_usage: { input_tokens: 77_624 } },
      }),
    );
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(output).toContain("\u{1f9e0} 38.8%");
  });

  // Same arithmetic must still hold for a genuinely 200K model: 75,203 / 200,000 = 37.6%.
  it("still reports the small-window percentage for a non-1M model", async () => {
    const proc = Bun.spawn(["bun", "scripts/cc-statusline.ts"], {
      cwd: import.meta.dir.replace(/\/scripts$/, ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.stdin.write(
      JSON.stringify({
        model: { id: "claude-haiku-4-5", display_name: "Haiku 4.5" },
        cwd: import.meta.dir.replace(/\/scripts$/, ""),
        cost: { total_cost_usd: 0, total_duration_ms: 0 },
        context_window: {
          total_input_tokens: 75_203,
          context_window_size: 200_000,
          current_usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 4_657,
            cache_read_input_tokens: 70_544,
          },
          used_percentage: 38,
        },
      }),
    );
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(output).toContain("\u{1f9e0} 37.6%");
  });

  it("falls back to total_input_tokens when current_usage has no numeric token fields", async () => {
    const proc = Bun.spawn(["bun", "scripts/cc-statusline.ts"], {
      cwd: import.meta.dir.replace(/\/scripts$/, ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.stdin.write(
      JSON.stringify({
        model: { id: "claude-opus-5", display_name: "Opus 5" },
        cwd: import.meta.dir.replace(/\/scripts$/, ""),
        cost: { total_cost_usd: 0, total_duration_ms: 0 },
        context_window: {
          context_window_size: 1_000_000,
          total_input_tokens: 100_000,
          current_usage: {},
        },
      }),
    );
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(output).toContain("🧠 10.0%");
  });
});
