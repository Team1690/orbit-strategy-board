import { indexedDB } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { browserInvoke } from "../src/lib/native/web";
import type { TeamStats, TeamStatsFetch } from "../src/lib/native/types";

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

function teamStats(team: number): TeamStats {
  return { team_number: team, event: "2026isde3", build_stamp: 1761490800, payload: { version: 1, name: `Team ${team}`, estimated_points: null, stages: [] } };
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

  it("brings every team's Team Stats in one request", async () => {
    buildWith("board-token");
    const fetch = databaseAnswers({ data: { team_stats: [teamStats(254), teamStats(1690), teamStats(5987)] } });

    const result = await fetchTeamStats();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "ok", answer: { team_stats: [teamStats(254), teamStats(1690), teamStats(5987)] } });
  });

  it("reports Team Stats not set up in a build without the token", async () => {
    buildWith("");
    const fetch = databaseAnswers({ data: { team_stats: [teamStats(1690)] } });

    expect(await fetchTeamStats()).toEqual({ kind: "not-set-up" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
