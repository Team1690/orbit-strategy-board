import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView } from "$lib/domain";
import type { MatchPacket, TeamStatsAnswer, TeamStatsFetch } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

const CONFIRMED_AT = "2026-10-26T14:05:00.123456+00:00";
const confirmedAt = Date.parse(CONFIRMED_AT);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// the fixture event's next match
const quals5: MatchPacket = newMatchPacket({ matchName: "Quals 5", redTeams: ["254", "4590", "2230"], blueTeams: ["1690", "1657", "3339"], tbaEventKey: "2026isde3" }, "quals-5");

// the fixture as the database answers it - its Confirmed row with the time the server stamped, or none
function answer(confirmed: string | null = CONFIRMED_AT): TeamStatsAnswer {
  const copy = structuredClone(fixture);
  copy.team_stats_confirmed = confirmed === null ? [] : copy.team_stats_confirmed.map((row) => ({ ...row, confirmed_at: confirmed }));
  return copy;
}

function view(lastFetch: TeamStatsFetch, now: number, packet = quals5) {
  return statsView({ lastFetch, packet, chosenStage: null, teamColors: {}, autoLighten: false, now });
}

function tables(lastFetch: TeamStatsFetch, now: number, packet = quals5) {
  const shown = view(lastFetch, now, packet);
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

describe("Stats tab freshness", () => {
  it("says how long ago the numbers were Confirmed, on the tablet's clock", () => {
    expect(tables({ kind: "ok", answer: answer() }, confirmedAt + 3 * MINUTE + 20_000).freshness).toEqual({ confirmed: "Confirmed 3 minutes ago", unreachable: null });
  });

  it("counts whole minutes, then whole hours", () => {
    const ago = (elapsed: number) => tables({ kind: "ok", answer: answer() }, confirmedAt + elapsed).freshness.confirmed;

    expect(ago(0)).toBe("Confirmed less than a minute ago");
    expect(ago(MINUTE - 1)).toBe("Confirmed less than a minute ago");
    expect(ago(MINUTE)).toBe("Confirmed 1 minute ago");
    expect(ago(HOUR - 1)).toBe("Confirmed 59 minutes ago");
    expect(ago(HOUR)).toBe("Confirmed 1 hour ago");
    expect(ago(26 * HOUR + 59 * MINUTE)).toBe("Confirmed 26 hours ago");
  });

  it("reads a Confirmed time ahead of the tablet's clock as less than a minute ago", () => {
    expect(tables({ kind: "ok", answer: answer() }, confirmedAt - 5 * MINUTE).freshness.confirmed).toBe("Confirmed less than a minute ago");
  });

  it("says the Team Stats haven't been Confirmed yet when there's no Confirmed row", () => {
    expect(tables({ kind: "ok", answer: answer(null) }, confirmedAt).freshness.confirmed).toBe("Not Confirmed yet");
  });
});

describe("Stats tab when the database can't be reached", () => {
  it("keeps the numbers the tablet kept on screen and says it can't reach the database", () => {
    const now = confirmedAt + 2 * HOUR;
    const online = tables({ kind: "ok", answer: answer() }, now);
    const offline = tables({ kind: "unreachable", detail: "fetch failed", cached: { answer: answer(), fetchedAt: confirmedAt + MINUTE } }, now);

    expect(offline.freshness).toEqual({ confirmed: "Confirmed 2 hours ago", unreachable: { title: "Can't reach the database", detail: "fetch failed" } });
    expect({ ...offline, freshness: online.freshness }).toEqual(online);
  });

  it("still names the event the numbers it kept are from", () => {
    const fromIsde1 = newMatchPacket({ matchName: "Quals 2", redTeams: ["254", "4590", "2230"], blueTeams: ["1690", "1657", "3339"], tbaEventKey: "2026isde1" }, "isde1-quals-2");

    expect(tables({ kind: "unreachable", detail: "fetch failed", cached: { answer: answer(), fetchedAt: confirmedAt } }, confirmedAt, fromIsde1).eventBanner)
      .toEqual({ title: "Team Stats from 2026isde3", detail: "This Match is from 2026isde1." });
  });

  it("says it can't reach the database when the tablet kept no Team Stats", () => {
    const nothing = { team_stats: [], team_stats_confirmed: [] };

    expect(view({ kind: "unreachable", detail: "signal timed out", cached: { answer: nothing, fetchedAt: confirmedAt } }, confirmedAt)).toEqual({
      kind: "notice",
      title: "Can't reach the database",
      detail: "signal timed out",
    });
  });
});

describe("Stats tab before anything is published", () => {
  it("says no Team Stats have been published yet when the database has none", () => {
    expect(view({ kind: "ok", answer: { team_stats: [], team_stats_confirmed: [] } }, confirmedAt)).toEqual({
      kind: "notice",
      title: "No Team Stats have been published yet",
      detail: "They show up here once a Synced Scouting App device at Strategy role or above publishes them.",
    });
  });
});
