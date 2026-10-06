import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelRegistry } from "./model.registry.js";

function fakeFetch(models: { name: string; size?: number }[], loaded: string[]) {
  return (async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes("/api/tags") ? { models } : { models: loaded.map((name) => ({ name })) }
  })) as unknown as typeof fetch;
}

test("模型注册表：已安装模型 available=true，未安装 false，常驻 loaded 正确", async () => {
  const reg = new ModelRegistry();
  await reg.probe(
    fakeFetch(
      [
        { name: "qwen2.5:3b", size: 1900000000 },
        { name: "qwen2.5:7b", size: 4700000000 }
      ],
      ["qwen2.5:7b"]
    )
  );
  const statuses = reg.getStatuses();
  const byTag = new Map(statuses.map((s) => [s.tag, s]));
  assert.equal(byTag.get("qwen2.5:3b")!.available, true);
  assert.equal(byTag.get("qwen2.5:3b")!.loaded, false);
  assert.equal(byTag.get("qwen2.5:7b")!.available, true);
  assert.equal(byTag.get("qwen2.5:7b")!.loaded, true);
  assert.equal(byTag.get("qwen2.5:14b")!.available, false);
  assert.equal(byTag.get("qwen2.5vl:7b")!.available, false);
});

test("模型注册表：Ollama 不可达时全部 available=false（不伪装）", async () => {
  const reg = new ModelRegistry();
  await reg.probe((async () => {
    throw new Error("connect refused");
  }) as unknown as typeof fetch);
  assert.ok(reg.getStatuses().every((s) => s.available === false));
  assert.ok(reg.getLastProbeInfo().error);
});

test("模型注册表：兼容同 base 名的变体标签", async () => {
  const reg = new ModelRegistry();
  await reg.probe(fakeFetch([{ name: "qwen2.5:7b-instruct-q4_K_M" }], []));
  const v = reg.getStatuses().find((s) => s.tag === "qwen2.5:7b")!;
  assert.equal(v.available, true);
});
