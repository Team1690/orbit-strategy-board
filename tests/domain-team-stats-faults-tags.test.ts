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
});
