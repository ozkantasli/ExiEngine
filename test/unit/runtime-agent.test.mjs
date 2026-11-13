// ExiEngine unit test — RuntimeAgent polling lifecycle
import { test } from "node:test";
import assert from "node:assert/strict";
import { RuntimeAgent } from "../../src/ai/runtime-agent.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

class TestProbe { destroy() { this.destroyCalls = (this.destroyCalls || 0) + 1; } }

test("runtime-agent: stop aborts the in-flight poll request", async () => {
  let commandSignal = null;
  let resultSignal = null;
  let pollRequests = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/__exi/runtime-command")) {
      pollRequests += 1;
      commandSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    resultSignal = options.signal;
    return { ok: true, json: async () => ({}) };
  };
  const agent = new RuntimeAgent({ api: {}, token: "token", baseUrl: "http://127.0.0.1:1", pollMs: 25, fetchImpl });
  agent.start();
  for (let index = 0; index < 20 && pollRequests === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(pollRequests, 1);
  assert.ok(commandSignal);
  assert.equal(agent.polling, true);
  agent.stop();
  assert.equal(agent.running, false);
  assert.equal(agent.polling, false);
  assert.equal(commandSignal.aborted, true);
  assert.equal(resultSignal, null);
  await flush();
  assert.equal(agent.polling, false);
  assert.equal(agent.controller, null);
});

test("runtime-agent: concurrent poll calls are deduplicated", async () => {
  let requests = 0;
  const agent = new RuntimeAgent({
    api: {},
    token: "token",
    baseUrl: "http://127.0.0.1:1",
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ commands: [] }) };
    },
  });
  agent.running = true;
  await Promise.all([agent.poll(), agent.poll(), agent.poll()]);
  assert.equal(requests, 1);
  agent.stop();
});

test("runtime-agent: a hanging execute command falls to EXI_RUNTIME_COMMAND_TIMEOUT", async () => {
  const posted = [];
  const agent = new RuntimeAgent({
    api: { hang: () => new Promise(() => {}) },
    token: "token",
    baseUrl: "http://127.0.0.1:1",
    pollMs: 25,
    executeTimeoutMs: 250,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/__exi/runtime-command")) return { ok: true, json: async () => ({ commands: [{ id: "cmd-1", operation: "function", name: "hang" }] }) };
      if (url.endsWith("/__exi/runtime-result")) {
        posted.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  agent.start();
  for (let index = 0; index < 100 && posted.length === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].ok, false);
  assert.equal(posted[0].error.code, "EXI_RUNTIME_COMMAND_TIMEOUT");
  agent.stop();
  await flush();
  assert.equal(agent.polling, false);
  assert.equal(agent.controller, null);
});

test("runtime-agent: stop+start never yields more than one active poll", async () => {
  const gotPromises = [];
  const agent = new RuntimeAgent({
    api: {},
    token: "token",
    baseUrl: "http://127.0.0.1:1",
    pollMs: 25,
    fetchImpl: async (url, options = {}) => {
      if (!url.endsWith("/__exi/runtime-command")) return { ok: true, json: async () => ({}) };
      const harness = { signal: options.signal, settled: false };
      gotPromises.push(harness);
      return new Promise((resolvePromise) => {
        harness.resolve = (value) => { harness.settled = true; resolvePromise(value); };
      });
    },
  });
  agent.start();
  for (let index = 0; index < 200 && gotPromises.length === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gotPromises.length, 1);
  agent.stop();
  assert.equal(agent.running, false);
  assert.equal(agent.polling, false);
  assert.equal(agent.controller, null);
  agent.start();
  for (let index = 0; index < 200 && gotPromises.length < 2; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gotPromises.length, 2);
  assert.equal(agent.polling, true);
  assert.notEqual(agent.controller, null);
  gotPromises[1].resolve({ ok: true, json: async () => ({ commands: [] }) });
  await flush();
  assert.equal(gotPromises[1].settled, true);
  assert.equal(agent.polling, false);
  assert.equal(agent.controller, null);
  agent.stop();
  assert.equal(gotPromises[0].settled, false);
});

test("runtime-agent: release evicts the snapshot hash; stop clears everything", async () => {
  const agent = new RuntimeAgent({
    api: {},
    token: "",
    baseUrl: "http://127.0.0.1:1",
    pollMs: 25,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  const sharedHandle = new TestProbe();
  const evictedHandle = new TestProbe();
  agent.registerHandle(sharedHandle, "h7");
  agent.registerHandle(evictedHandle, "h9");
  agent.snapshotHashes.set("h7:0:8", "old");
  agent.snapshotHashes.set("h7:1:8", "old2");
  agent.snapshotHashes.set("h9:0:8", "keep");
  const released = await agent.execute({ operation: "release", handle: "h7" });
  assert.equal(released.released, "h7");
  assert.equal(agent.snapshotHashes.size, 1);
  assert.equal(agent.snapshotHashes.get("h9:0:8"), "keep");
  agent.start();
  agent.snapshotHashes.set("h7:0:8", "back");
  assert.equal(agent.snapshotHashes.size, 2);
  agent.stop();
  assert.equal(agent.snapshotHashes.size, 0);
});
