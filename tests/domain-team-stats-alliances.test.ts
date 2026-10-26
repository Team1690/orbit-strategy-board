import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView } from "$lib/domain";
import type { Alliance, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's Quals 5 unless a test lines up other teams
function tables(red: Alliance = ["254", "4590", "2230"], blue: Alliance = ["1690", "1657", "3339"]) {
  const packet = newMatchPacket({ matchName: "Quals 5", redTeams: red, blueTeams: blue, tbaEventKey: "2026isde3" }, "quals-5");
  const shown = statsView({ lastFetch: { kind: "ok", answer: fixture }, packet, chosenStage: null, teamColors: {}, autoLighten: false });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

describe("Estimated score", () => {
  it("adds up each alliance's estimated points", () => {
    expect(tables().estimatedScores).toEqual({ red: "119", blue: "129" });
  });
});
