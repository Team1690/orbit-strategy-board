import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView } from "$lib/domain";
import type { Alliance, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";
import { drawnBrighter } from "./team-stats-helpers";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's Quals 5 unless a test lines up other teams - nobody has watched 4590
function tables(red: Alliance = ["254", "4590", "2230"], blue: Alliance = ["1690", "1657", "3339"]) {
  const packet = newMatchPacket({ matchName: "Quals 5", redTeams: red, blueTeams: blue, tbaEventKey: "2026isde3" }, "quals-5");
  const shown = statsView({ lastFetch: { kind: "ok", answer: fixture }, packet, chosenStage: null, teamColors: {}, autoLighten: false, now: 0 });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

function row(shown: ReturnType<typeof tables>, stageLabel: string, rowLabel: string) {
  const found = shown.stages.find((stage) => stage.label === stageLabel)?.rows.find((candidate) => candidate.label === rowLabel);
  if (!found) throw new Error(`no ${stageLabel} ${rowLabel} row`);
  return found;
}

describe("A team nobody has watched", () => {
  it("shows the coach's noughts but is never drawn brighter", () => {
    const shown = tables();
    const column = shown.columns.findIndex((candidate) => candidate.team === "4590");

    expect([["Pit", "Stopped"], ["Auto", "Auto Climb (S/A/P)"], ["Endgame", "Climb Level"], ["Endgame", "Climb (S/A/P)"]].map(([stage, label]) => row(shown, stage, label).cells[column])).toEqual([
      { text: "0" }, { text: "0/0/0" }, { text: "None" }, { text: "0/0/0" },
    ]);
    expect(shown.stages.flatMap((stage) => stage.rows.flatMap((candidate) => candidate.cells[column]?.best ? [`${stage.label} ${candidate.label}`] : []))).toEqual([]);
  });

  it("doesn't count toward the two numbers an alliance needs before anyone is drawn brighter", () => {
    // 5987 has no Team Stats - so 4590's noughts would be red's second number
    const shown = tables(["4590", "2230", "5987"]);

    expect(drawnBrighter(shown, "Pit", "Stopped").red).toEqual([]);
    expect(drawnBrighter(shown, "Endgame", "Climb Level").red).toEqual([]);
  });
});
