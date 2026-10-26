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
