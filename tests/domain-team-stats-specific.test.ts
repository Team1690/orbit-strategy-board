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
  const shown = statsView({ lastFetch: { kind: "ok", answer: fixture }, packet, chosenStage: null, teamColors: {}, autoLighten: false, ...input });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

function stage(shown: ReturnType<typeof tables>, label: string) {
  const found = shown.stages.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no ${label} Stage`);
  return found;
}

describe("Specific Stage", () => {
  it("draws one card per Station team in Station order, Red row then Blue row, each headed like the team's column", () => {
    const shown = tables(quals5());
    const specific = stage(shown, "Specific");

    expect(specific.cardRows.map((row) => [row.alliance, row.cards.map((card) => card.column.team)])).toEqual([
      ["red", ["254", "4590", "2230"]],
      ["blue", ["1690", "1657", "3339"]],
    ]);
    expect(specific.cardRows.flatMap((row) => row.cards.map((card) => card.column))).toEqual(shown.columns);
    expect(specific.rows).toEqual([]);
  });
});
