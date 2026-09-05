import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MockMcpServer, installMatchers } from "../index";
import { registerGithubMocks } from "../mocks/mock-github";
import { registerBrainlayerMocks } from "../mocks/mock-brainlayer";
import { registerVoicelayerMocks } from "../mocks/mock-voicelayer";

installMatchers();

describe("mock-github", () => {
  let server: MockMcpServer;

  beforeEach(() => {
    server = new MockMcpServer("mock-github");
    registerGithubMocks(server);
  });

  afterEach(async () => {
    await server.close();
  });

  test("gh_pr_create returns PR data", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "gh_pr_create",
      arguments: { title: "feat: add mock MCP" },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.number).toBe(100);
    expect(parsed.title).toBe("feat: add mock MCP");
    expect(parsed.state).toBe("open");
  });

  test("gh_pr_view returns PR details", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "gh_pr_view",
      arguments: { number: 42 },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.number).toBe(42);
    expect(parsed.state).toBe("open");
  });

  test("gh_pr_merge returns merge confirmation", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "gh_pr_merge",
      arguments: { number: 50, method: "squash" },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.merged).toBe(true);
    expect(parsed.method).toBe("squash");
  });

  test("gh_pr_checks returns check status", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "gh_pr_checks",
      arguments: { number: 100 },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.overall).toBe("success");
  });

  test("all 4 GitHub tools are tracked", async () => {
    const client = await server.connect();
    await client.callTool({ name: "gh_pr_create", arguments: { title: "x" } });
    await client.callTool({ name: "gh_pr_view", arguments: { number: 1 } });
    await client.callTool({ name: "gh_pr_checks", arguments: { number: 1 } });
    await client.callTool({ name: "gh_pr_merge", arguments: { number: 1 } });
    expect(server.getCallCount("gh_pr_create")).toBe(1);
    expect(server.getCallCount("gh_pr_view")).toBe(1);
    expect(server.getCallCount("gh_pr_checks")).toBe(1);
    expect(server.getCallCount("gh_pr_merge")).toBe(1);
  });
});

describe("mock-brainlayer", () => {
  let server: MockMcpServer;

  beforeEach(() => {
    server = new MockMcpServer("mock-brainlayer");
    registerBrainlayerMocks(server);
  });

  afterEach(async () => {
    await server.close();
  });

  test("brain_recall returns search results", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "brain_recall",
      arguments: { query: "test query" },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].content).toContain("test query");
  });

  test("brain_store returns chunk ID", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "brain_store",
      arguments: {
        content: "important knowledge",
        tags: ["test"],
        importance: 8,
      },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.stored).toBe(true);
    expect(parsed.id).toBeDefined();
  });

  test("brain_digest returns extraction info", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "brain_digest",
      arguments: { content: "long document content", source: "test-doc" },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.digested).toBe(true);
    expect(parsed.source).toBe("test-doc");
  });

  test("all 3 BrainLayer tools tracked", async () => {
    const client = await server.connect();
    await client.callTool({
      name: "brain_recall",
      arguments: { query: "test" },
    });
    await client.callTool({
      name: "brain_store",
      arguments: { content: "data" },
    });
    await client.callTool({
      name: "brain_digest",
      arguments: { content: "data" },
    });
    expect(server.getCallCount("brain_recall")).toBe(1);
    expect(server.getCallCount("brain_store")).toBe(1);
    expect(server.getCallCount("brain_digest")).toBe(1);
  });
});

describe("mock-voicelayer", () => {
  let server: MockMcpServer;

  beforeEach(() => {
    server = new MockMcpServer("mock-voicelayer");
    registerVoicelayerMocks(server);
  });

  afterEach(async () => {
    await server.close();
  });

  test("voice_speak returns speech confirmation", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "voice_speak",
      arguments: { text: "Hello world" },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.spoken).toBe(true);
    expect(parsed.text).toBe("Hello world");
  });

  test("voice_ask returns transcript", async () => {
    const client = await server.connect();
    const result = await client.callTool({
      name: "voice_ask",
      arguments: { prompt: "What is your name?", language: "en" },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.heard).toBe(true);
    expect(parsed.transcript).toContain("What is your name?");
    expect(parsed.language).toBe("en");
  });

  test("both VoiceLayer tools tracked", async () => {
    const client = await server.connect();
    await client.callTool({
      name: "voice_speak",
      arguments: { text: "hi" },
    });
    await client.callTool({
      name: "voice_ask",
      arguments: { prompt: "question" },
    });
    expect(server.getCallCount("voice_speak")).toBe(1);
    expect(server.getCallCount("voice_ask")).toBe(1);
  });
});
