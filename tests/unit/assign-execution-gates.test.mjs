import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reviewers = ["Tech Lead", "QA Engineer", "UI/UX Designer", "Product Owner"].map((name) => ({
  id: name,
  name,
}));

const formerName = { id: "former", name: "OpenCode Agent", role: "engineer", status: "idle" };
const retiredCeo = { id: "retired", name: "Retired CEO", role: "ceo", status: "terminated" };
const currentCeo = { id: "current", name: "Codex Agent", role: "ceo", status: "idle" };
const issue = { id: "issue", identifier: "TEST-1", status: "todo", title: "Sync UI", description: "" };

function mockApi(agents) {
  const requests = vi.fn(async (url, options) => {
    const pathname = new globalThis.URL(url).pathname;
    if (pathname.endsWith("/agents")) return globalThis.Response.json([...reviewers, ...agents]);
    if (pathname.endsWith("/labels")) return globalThis.Response.json([]);
    if (pathname.endsWith("/issues")) return globalThis.Response.json([issue]);
    if (pathname.endsWith("/issues/issue") && options.method === "GET") return globalThis.Response.json(issue);
    if (pathname.endsWith("/issues/issue") && options.method === "PATCH") return globalThis.Response.json({});
    throw new Error(`Unexpected request ${options.method} ${pathname}`);
  });
  vi.stubGlobal("fetch", requests);
  return requests;
}

describe("execution gate assigner CEO lookup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("PAPERCLIP_API_URL", "http://paperclip.test");
    vi.stubEnv("PAPERCLIP_API_KEY", "fixture-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the current CEO's agent ID for high-complexity approval", async () => {
    const requests = mockApi([formerName, retiredCeo, currentCeo]);

    await import("../../scripts/paperclip/assign-execution-gates.mjs");

    const writes = requests.mock.calls.filter(([, options]) => options.method === "PATCH");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body).executionPolicy.stages[1]).toEqual({
      type: "approval",
      approvalsNeeded: 1,
      participants: [{ type: "agent", agentId: currentCeo.id }],
    });
  });

  it.each([
    ["missing", [formerName, retiredCeo]],
    ["ambiguous", [formerName, currentCeo, { ...currentCeo, id: "second" }]],
  ])("stops before policy writes when the CEO is %s", async (condition, agents) => {
    const requests = mockApi(agents);

    await expect(import("../../scripts/paperclip/assign-execution-gates.mjs")).rejects.toThrow(
      condition === "missing" ? /no current CEO/ : /multiple current CEOs/,
    );
    expect(requests).toHaveBeenCalledTimes(1);
  });
});
