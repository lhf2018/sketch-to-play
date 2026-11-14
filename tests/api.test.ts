import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { example } from "../packages/core/src/index";
let app: (typeof import("../apps/api/src/app"))["app"];
let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "sketch-tests-"));
  process.env.MODEL_API_KEY = "test-key";
  process.env.MODEL_NAME = "test-model";
  process.env.BUDGET_LEDGER_PATH = join(folder, "budget.json");
  process.env.AI_DAILY_BUDGET = "1";
  app = (await import("../apps/api/src/app")).app;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});
function input() {
  const scene = example().scene;
  return {
    requestId: crypto.randomUUID(),
    sceneId: scene.sceneId,
    baseRevision: scene.revision,
    sessionEpoch: 0,
    instruction: "把小球变大",
    targetIds: [scene.objects[0].id],
    scene,
  };
}
function request(body: unknown) {
  return app.request("/api/ai/edit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify(body),
  });
}
describe("model proxy", () => {
  it("validates results and deduplicates paid requests", async () => {
    const body = input(),
      fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      operations: [
                        {
                          type: "updateObject",
                          objectId: body.targetIds[0],
                          changes: { shape: { type: "circle", radius: 0.25 } },
                        },
                      ],
                      explanation: "半径变大",
                    }),
                  },
                },
              ],
            }),
          ),
        );
    vi.stubGlobal("fetch", fetch);
    const result = await request(body);
    expect(result.status).toBe(200);
    expect((await result.json()).status).toBe("ok");
    expect((await request(body)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unauthorized model changes", async () => {
    const body = input();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      operations: [
                        {
                          type: "removeObject",
                          objectId: body.scene.objects[1].id,
                        },
                      ],
                      explanation: "越权",
                    }),
                  },
                },
              ],
            }),
          ),
        ),
    );
    expect((await request(body)).status).toBe(502);
  });
  it("rejects foreign origins before calling models", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await app.request("/api/ai/edit", {
      method: "POST",
      headers: {
        origin: "https://other.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input()),
    });
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
