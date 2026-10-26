import { indexedDB } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { browserInvoke } from "../src/lib/native/web";
import type { TeamStats, TeamStatsConfirmed, TeamStatsFetch } from "../src/lib/native/types";

const LINK = "https://scouting.example/v1/graphql";

beforeAll(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await browserInvoke("storage_clear");
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

const confirmed: TeamStatsConfirmed = { event: "2026isde3", build_stamp: 1761490800, confirmed_at: "2026-10-26T14:05:00.123456+00:00" };

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

  it("reports the database unreachable when it answers with an error", async () => {
    buildWith("voided-token");
    databaseAnswers({ errors: [{ message: "Could not verify JWT: JWSError JWSInvalidSignature", extensions: { path: "$", code: "invalid-jwt" } }] });

    expect(await fetchTeamStats()).toEqual({ kind: "unreachable", detail: "Could not verify JWT: JWSError JWSInvalidSignature" });
  });

  it("reports the database unreachable when the request fails", async () => {
    buildWith("board-token");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));

    expect(await fetchTeamStats()).toEqual({ kind: "unreachable", detail: "fetch failed" });
  });
});

describe("Team Stats fetch and Confirmed", () => {
  it("asks for the Confirmed row in the same request and brings it along", async () => {
    buildWith("board-token");
    const fetch = databaseAnswers({ data: { team_stats: [teamStats(1690)], team_stats_confirmed: [confirmed] } });

    const result = await fetchTeamStats();

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body)).query).toContain("team_stats_confirmed { event build_stamp confirmed_at }");
    expect(result).toMatchObject({ kind: "ok", answer: { team_stats: [teamStats(1690)], team_stats_confirmed: [confirmed] } });
  });
});
