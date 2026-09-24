import { describe, expect, test } from "bun:test";
import { goozaliHtmlToText, isGoozaliJobLink } from "../scraper";

describe("goozaliHtmlToText", () => {
  test("turns breaks into newlines and strips tags", () => {
    expect(goozaliHtmlToText("<b>Senior</b> Dev<br/>Tel Aviv<br>Hybrid")).toBe(
      "Senior Dev\nTel Aviv\nHybrid",
    );
  });

  test("decodes each entity once, never twice", () => {
    expect(goozaliHtmlToText("R&amp;D &quot;core&quot; &#39;x&#39;&nbsp;y")).toBe(
      "R&D \"core\" 'x' y",
    );
    expect(goozaliHtmlToText("&amp;quot;")).toBe("&quot;");
  });

  test("leaves no tag behind when tags nest into new tags", () => {
    expect(goozaliHtmlToText("<scr<b>ipt>alert(1)</script>")).not.toContain("<");
  });
});

describe("isGoozaliJobLink", () => {
  test("accepts an external careers URL", () => {
    expect(isGoozaliJobLink("https://acme.com/careers/123")).toBe(true);
  });

  test("rejects Telegram and Goozali hosts", () => {
    expect(isGoozaliJobLink("https://t.me/goozali/55")).toBe(false);
    expect(isGoozaliJobLink("https://www.goozali.com/jobs")).toBe(false);
  });

  test("judges the host, not a substring anywhere in the URL", () => {
    expect(isGoozaliJobLink("https://acme.com/jobs?ref=goozali.com")).toBe(true);
    expect(isGoozaliJobLink("https://goozali.com.evil.example/jobs")).toBe(true);
    expect(isGoozaliJobLink("not a url")).toBe(false);
  });
});
