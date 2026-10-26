import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView, type StatsViewInput } from "$lib/domain";
import type { Alliance, MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's next match
function quals5(red: Alliance = ["254", "4590", "2230"], blue: Alliance = ["1690", "1657", "3339"]): MatchPacket {
  return newMatchPacket({ matchName: "Quals 5", redTeams: red, blueTeams: blue, tbaEventKey: "2026isde3" }, "quals-5");
}

function tables(packet: MatchPacket, input: Partial<StatsViewInput> = {}) {
  const shown = statsView({ fetch: { kind: "ok", answer: fixture }, packet, chosenStage: null, teamColors: {}, autoLighten: false, ...input });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

describe("Stats tab", () => {
  it("shows the Match's teams in Station order", () => {
    expect(tables(quals5()).columns.map(({ stationName, team }) => [stationName, team])).toEqual([
      ["Red 1", "254"], ["Red 2", "4590"], ["Red 3", "2230"], ["Blue 1", "1690"], ["Blue 2", "1657"], ["Blue 3", "3339"],
    ]);
  });

  it("heads each column with its team number in its Team Color", () => {
    const columns = tables(quals5(), { teamColors: { "254": "#ff8800" }, autoLighten: true }).columns;

    expect(columns.find((column) => column.team === "254")?.color).toBe("#ff8800");
    expect(columns.find((column) => column.team === "1690")?.color).toBe("#3b3bff");
  });
});
