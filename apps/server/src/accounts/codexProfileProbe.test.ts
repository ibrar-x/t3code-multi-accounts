import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCodexAccountProfile } from "./codexProfileProbe.ts";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

const spawnMock = vi.mocked(spawn);
const tempDirs: string[] = [];

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeIdToken(payload: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${header}.${body}.`;
}

async function makeProfileDir(authPayload: Record<string, unknown>): Promise<string> {
  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-codex-profile-probe-"));
  tempDirs.push(profilePath);
  await fs.writeFile(path.join(profilePath, "auth.json"), JSON.stringify(authPayload), "utf8");
  return profilePath;
}

function createMockAppServer(
  onRequest?: (request: Record<string, unknown>, input: { stdout: PassThrough }) => void,
) {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  let stdinBuffer = "";

  stdin.on("data", (chunk: Buffer | string) => {
    stdinBuffer += String(chunk);
    const lines = stdinBuffer.split("\n");
    stdinBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        onRequest?.(parsed, { stdout });
      } catch {
        // ignore malformed writes in tests
      }
    }
  });

  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;
  child.kill = vi.fn(() => true) as unknown as ChildProcessWithoutNullStreams["kill"];

  return { child, stdout, stderr };
}

afterEach(async () => {
  spawnMock.mockReset();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("readCodexAccountProfile", () => {
  it("falls back to auth.json token metadata when app-server exits early", async () => {
    const profilePath = await makeProfileDir({
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeIdToken({
          email: "dev@example.com",
          "https://api.openai.com/auth": {
            chatgpt_plan_type: "plus",
          },
        }),
        access_token: "access",
        refresh_token: "refresh",
        account_id: "acct_1",
      },
    });

    const { child } = createMockAppServer();
    spawnMock.mockReturnValue(child);
    queueMicrotask(() => {
      child.emit("close", 1);
    });

    const profile = await readCodexAccountProfile(profilePath, 50);
    expect(profile).toMatchObject({
      type: "chatgpt",
      email: "dev@example.com",
      planType: "plus",
    });
    expect(profile?.syncedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("sends initialized notification and merges auth metadata with app-server rate limits", async () => {
    const profilePath = await makeProfileDir({
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeIdToken({
          email: "work@example.com",
          "https://api.openai.com/auth": {
            chatgpt_plan_type: "team",
          },
        }),
        access_token: "access",
        refresh_token: "refresh",
        account_id: "acct_2",
      },
    });

    const writes: string[] = [];
    const { child, stdout } = createMockAppServer((request, input) => {
      writes.push(request.method as string);
      if (request.method === "initialize") {
        input.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\n");
        return;
      }
      if (request.method === "account/read") {
        input.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              account: {
                type: "unknown",
              },
            },
          }) + "\n",
        );
        return;
      }
      if (request.method === "account/rateLimits/read") {
        input.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              rateLimits: {
                primary: {
                  used_percent: 35,
                  resets_at: 1_750_000_000,
                },
              },
            },
          }) + "\n",
        );
      }
    });
    spawnMock.mockReturnValue(child);

    const profile = await readCodexAccountProfile(profilePath, 500);
    expect(profile).toMatchObject({
      type: "chatgpt",
      email: "work@example.com",
      planType: "team",
      rateLimits: {
        primary: {
          usedPercent: 35,
          remainingPercent: 65,
          resetsAt: 1_750_000_000,
        },
      },
    });
    expect(writes).toContain("initialized");
    expect(writes).not.toContain("notifications/initialized");

    stdout.end();
    child.emit("close", 0);
  });
});
