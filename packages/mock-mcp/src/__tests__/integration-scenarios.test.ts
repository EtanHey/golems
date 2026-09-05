import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { MockMcpServer, installMatchers } from "../index";
import { registerGithubMocks } from "../mocks/mock-github";
import { registerBrainlayerMocks } from "../mocks/mock-brainlayer";

installMatchers();

describe("integration scenario: pr-loop", () => {
  let server: MockMcpServer;

  beforeEach(() => {
    server = new MockMcpServer("pr-loop-test");
    registerGithubMocks(server);
  });

  afterEach(async () => {
    await server.close();
  });

  test("gh_pr_create must be called BEFORE gh_pr_merge", async () => {
    const client = await server.connect();

    await client.callTool({
      name: "gh_pr_create",
      arguments: { title: "feat: new feature" },
    });
    await client.callTool({
      name: "gh_pr_checks",
      arguments: { number: 100 },
    });
    await client.callTool({
      name: "gh_pr_merge",
      arguments: { number: 100, method: "squash" },
    });

    expect(server).toHaveCalledBefore("gh_pr_create", "gh_pr_merge");
  });

  test("full PR lifecycle follows correct order", async () => {
    const client = await server.connect();

    await client.callTool({
      name: "gh_pr_create",
      arguments: { title: "feat: thing" },
    });
    await client.callTool({
      name: "gh_pr_view",
      arguments: { number: 100 },
    });
    await client.callTool({
      name: "gh_pr_checks",
      arguments: { number: 100 },
    });
    await client.callTool({
      name: "gh_pr_merge",
      arguments: { number: 100 },
    });

    expect(server).toHaveCalledInOrder([
      "gh_pr_create",
      "gh_pr_view",
      "gh_pr_checks",
      "gh_pr_merge",
    ]);
  });

  test("each tool called exactly once in PR loop", async () => {
    const client = await server.connect();
    await client.callTool({
      name: "gh_pr_create",
      arguments: { title: "x" },
    });
    await client.callTool({
      name: "gh_pr_checks",
      arguments: { number: 100 },
    });
    await client.callTool({
      name: "gh_pr_merge",
      arguments: { number: 100 },
    });

    expect(server).toHaveCalledToolCount("gh_pr_create", 1);
    expect(server).toHaveCalledToolCount("gh_pr_checks", 1);
    expect(server).toHaveCalledToolCount("gh_pr_merge", 1);
  });

  test("PR created with correct title", async () => {
    const client = await server.connect();
    await client.callTool({
      name: "gh_pr_create",
      arguments: { title: "fix: resolve edge case" },
    });
    expect(server).toHaveCalledWithArgs("gh_pr_create", {
      title: "fix: resolve edge case",
    });
  });
});

describe("integration scenario: commit + brain_store", () => {
  let server: MockMcpServer;

  beforeEach(() => {
    server = new MockMcpServer("commit-brain-test");
    registerBrainlayerMocks(server);
    server.registerMockTool({
      name: "git_commit",
      description: "Create a git commit",
      inputSchema: { message: z.string() },
      handler: (args) => ({ committed: true, message: args.message }),
    });
  });

  afterEach(async () => {
    await server.close();
  });

  test("brain_store called after successful git_commit", async () => {
    const client = await server.connect();

    await client.callTool({
      name: "git_commit",
      arguments: { message: "feat: add mock MCP harness" },
    });
    await client.callTool({
      name: "brain_store",
      arguments: {
        content: "Committed mock MCP harness",
        tags: ["commit", "mock-mcp"],
        importance: 7,
      },
    });

    expect(server).toHaveCalledBefore("git_commit", "brain_store");
  });

  test("brain_store includes commit context in tags", async () => {
    const client = await server.connect();

    await client.callTool({
      name: "git_commit",
      arguments: { message: "fix: resolve import" },
    });
    await client.callTool({
      name: "brain_store",
      arguments: {
        content: "Fixed import issue",
        tags: ["commit", "bug-fix"],
      },
    });

    expect(server).toHaveCalledWithArgs("brain_store", {
      tags: ["commit", "bug-fix"],
    });
  });

  test("brain_recall searched before brain_store (BrainLayer protocol)", async () => {
    const client = await server.connect();

    await client.callTool({
      name: "brain_recall",
      arguments: { query: "mock MCP" },
    });
    await client.callTool({
      name: "git_commit",
      arguments: { message: "feat: mock MCP" },
    });
    await client.callTool({
      name: "brain_store",
      arguments: { content: "Shipped mock MCP" },
    });

    expect(server).toHaveCalledBefore("brain_recall", "brain_store");
    expect(server).toHaveCalledInOrder([
      "brain_recall",
      "git_commit",
      "brain_store",
    ]);
  });
});
