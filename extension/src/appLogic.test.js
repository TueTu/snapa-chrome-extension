import test from "node:test";
import assert from "node:assert/strict";
import {
  isFreeOpenRouterModel,
  isTextOpenRouterModel,
  parseSseEventJson,
  scoreOpenRouterModel,
} from "./appLogic.js";

test("parseSseEventJson parses valid SSE data", () => {
  assert.deepEqual(parseSseEventJson('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'), {
    json: { choices: [{ delta: { content: "Hi" } }] },
  });
});

test("parseSseEventJson reports done and malformed events separately", () => {
  assert.deepEqual(parseSseEventJson("data: [DONE]\n\n"), { done: true });
  assert.deepEqual(parseSseEventJson("data: nope\n\n"), { malformed: true });
});

test("isFreeOpenRouterModel does not treat missing pricing as free", () => {
  assert.equal(isFreeOpenRouterModel({ id: "provider/model" }), false);
  assert.equal(isFreeOpenRouterModel({ id: "provider/model:free" }), true);
  assert.equal(
    isFreeOpenRouterModel({
      id: "provider/free-by-price",
      pricing: { prompt: "0", completion: "0" },
    }),
    true,
  );
});

test("isTextOpenRouterModel rejects non-text model ids", () => {
  assert.equal(isTextOpenRouterModel({ id: "provider/text-instruct:free" }), true);
  assert.equal(isTextOpenRouterModel({ id: "provider/image-generator:free" }), false);
  assert.equal(isTextOpenRouterModel({ id: "provider/audio-transcribe:free" }), false);
});

test("scoreOpenRouterModel prefers fast chat-style model names", () => {
  const patterns = ["flash", "qwen", "mini"];
  assert.ok(
    scoreOpenRouterModel({ id: "google/gemini-flash-lite:free" }, patterns) >
      scoreOpenRouterModel({ id: "deepseek/deepseek-r1:free" }, patterns),
  );
});
