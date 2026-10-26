import { indexedDB } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { browserInvoke } from "../src/lib/native/web";
import type { TeamStatsFetch } from "../src/lib/native/types";

const LINK = "https://scouting.example/v1/graphql";

beforeAll(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function buildWith(token: string): void {
  vi.stubGlobal("__HASURA_HTTP_LINK__", LINK);
  vi.stubGlobal("__HASURA_BOARD_TOKEN__", token);
}

function databaseAnswers(body: unknown) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const fetchTeamStats = () => browserInvoke<TeamStatsFetch>("team_stats_fetch");

describe("Team Stats fetch", () => {
  it("sends the board token to the database", async () => {
    buildWith("board-token");
    const fetch = databaseAnswers({ data: { team_stats: [] } });

    await fetchTeamStats();

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(LINK);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer board-token");
  });
});
