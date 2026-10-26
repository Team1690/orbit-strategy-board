import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView } from "$lib/domain";
import type { Alliance, JsonObject, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";
import { drawnBrighter } from "./team-stats-helpers";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's Quals 5 unless a test lines up other teams
function tables({ red = ["254", "4590", "2230"], blue = ["1690", "1657", "3339"], answer = fixture }: { red?: Alliance; blue?: Alliance; answer?: TeamStatsAnswer } = {}) {
  const packet = newMatchPacket({ matchName: "Quals 5", redTeams: red, blueTeams: blue, tbaEventKey: "2026isde3" }, "quals-5");
  const shown = statsView({ lastFetch: { kind: "ok", answer }, packet, chosenStage: null, teamColors: {}, autoLighten: false, now: 0 });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

function withValue(team: number, stageLabel: string, rowLabel: string, value: JsonObject): TeamStatsAnswer {
  const answer = structuredClone(fixture);
  const payload = answer.team_stats.find((candidate) => candidate.team_number === team)?.payload as { stages: Array<{ label: string; rows: JsonObject[] }> } | undefined;
  const row = payload?.stages.find((stage) => stage.label === stageLabel)?.rows.find((candidate) => candidate.label === rowLabel);
  if (!row) throw new Error(`no ${stageLabel} ${rowLabel} row for ${team} in the fixture`);
  row.value = value;
  return answer;
}

describe("Estimated score", () => {
  it("adds up each alliance's estimated points", () => {
    expect(tables().estimatedScores).toEqual({ red: "119", blue: "129" });
  });

  it("shows a dash for an alliance where no team has estimated points", () => {
    expect(tables({ red: ["4590", "5987", ""] }).estimatedScores).toEqual({ red: "-", blue: "129" });
  });
});

describe("Stage totals", () => {
  it("adds up each alliance's total on the Stages the Scouting App totals", () => {
    expect(tables().stages.map((stage) => [stage.label, stage.totals])).toEqual([
      ["Pit", null],
      ["Auto", { red: "24", blue: "20" }],
      ["Tele", { red: "61", blue: "55" }],
      ["Endgame", null],
      ["Specific", null],
    ]);
  });

  it("shows a dash for an alliance where no team has a total", () => {
    expect(tables({ red: ["4590", "5987", ""] }).stages.flatMap((stage) => stage.totals ? [[stage.label, stage.totals]] : [])).toEqual([
      ["Auto", { red: "-", blue: "20" }],
      ["Tele", { red: "-", blue: "55" }],
    ]);
  });
});

describe("Best on each alliance", () => {
  it("draws the highest number brighter where higher is better", () => {
    expect(drawnBrighter(tables(), "Pit", "OPR")).toEqual({ red: ["254"], blue: ["1690"] });
  });

  it("draws the lowest number brighter where lower is better", () => {
    expect(drawnBrighter(tables({ red: ["2230", "3075", "5654"] }), "Pit", "Stopped").red).toEqual(["3075"]);
  });

  it("draws tied numbers brighter together", () => {
    expect(drawnBrighter(tables(), "Pit", "Max Balls")).toEqual({ red: ["254"], blue: ["1690", "3339"] });
  });

  it("draws nothing brighter on an alliance until two of its teams have a number", () => {
    const shown = tables();

    expect(drawnBrighter(shown, "Pit", "EPA")).toEqual({ red: [], blue: [] });
    expect(drawnBrighter(shown, "Pit", "BPS")).toEqual({ red: ["254"], blue: ["1690"] });
  });

  it("leaves a row plain where neither way is better", () => {
    expect(drawnBrighter(tables(), "Pit", "Weight")).toEqual({ red: [], blue: [] });
  });

  it("never draws a value of a kind the board can't draw brighter", () => {
    const answer = withValue(1690, "Pit", "OPR", { kind: "sparkline", text: "42.5", raw: 42.5, points: [38.1, 42.5] });

    expect(drawnBrighter(tables({ answer }), "Pit", "OPR").blue).toEqual(["3339"]);
  });

  it("never draws a value it shows as a dash brighter, even one with a number behind it", () => {
    const shown = tables({ answer: withValue(1690, "Pit", "OPR", { kind: "text", raw: 99 }) });

    expect(shown.stages[0].rows.find((row) => row.label === "OPR")?.cells[3]).toEqual({ text: "-" });
    expect(drawnBrighter(shown, "Pit", "OPR").blue).toEqual(["3339"]);
  });
});
