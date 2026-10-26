import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView, type StatsViewInput } from "$lib/domain";
import type { TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's next match - 254 4590 2230 against 1690 1657 3339
const quals5 = newMatchPacket({ matchName: "Quals 5", redTeams: ["254", "4590", "2230"], blueTeams: ["1690", "1657", "3339"], tbaEventKey: "2026isde3" }, "quals-5");

function tables(input: Partial<StatsViewInput> = {}) {
  const shown = statsView({ lastFetch: { kind: "ok", answer: fixture }, packet: quals5, chosenStage: null, teamColors: {}, autoLighten: false, ...input });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

describe("Active Faults and Robot Tags", () => {
  it("marks each team with Active Faults on its column header, which every Stage shows", () => {
    expect(tables().columns.map(({ team, activeFaults }) => [team, activeFaults])).toEqual([
      ["254", 0], ["4590", 0], ["2230", 1], ["1690", 2], ["1657", 0], ["3339", 0],
    ]);
  });

  it("shows each team's Robot Tags in their colors on its column header", () => {
    const defender = { name: "Defender", color: "#e91e63" };
    const fastClimber = { name: "Fast climber", color: "#4caf50" };

    expect(tables().columns.map(({ team, robotTags }) => [team, robotTags])).toEqual([
      ["254", [defender, fastClimber]], ["4590", []], ["2230", [defender]], ["1690", [fastClimber]], ["1657", []], ["3339", []],
    ]);
  });

  it("lists every Active Fault of the Match's teams below Pit's table, grouped by team in Station order", () => {
    const listed = tables().stages.map(({ label, faults }) => [label, faults.map(({ column, faults }) => [column.team, faults])]);

    expect(listed).toEqual([
      ["Pit", [
        ["2230", [{ match: "Q2", status: "No progress", message: "Robot dead on field", resolution: null, scouters: null }]],
        ["1690", [
          { match: "Q1", status: "Unknown", message: "Lost comms", resolution: null, scouters: "2/2 scouters" },
          { match: "Q2", status: "In progress", message: "Intake jams on the bump", resolution: "New roller tonight", scouters: null },
        ]],
      ]],
      ["Auto", []], ["Tele", []], ["Endgame", []],
    ]);
  });
});
