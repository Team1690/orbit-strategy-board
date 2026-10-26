import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView, type AllianceColor } from "$lib/domain";
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

// the teams drawn brighter on each alliance
function best(shown: ReturnType<typeof tables>, stageLabel: string, rowLabel: string) {
  const row = shown.stages.find((stage) => stage.label === stageLabel)?.rows.find((candidate) => candidate.label === rowLabel);
  if (!row) throw new Error(`no ${stageLabel} ${rowLabel} row`);
  const teams = (alliance: AllianceColor) => shown.columns.flatMap((column, index) => column.alliance === alliance && row.cells[index]?.best ? [column.team] : []);
  return { red: teams("red"), blue: teams("blue") };
}

describe("Estimated score", () => {
  it("adds up each alliance's estimated points", () => {
    expect(tables().estimatedScores).toEqual({ red: "119", blue: "129" });
  });

  it("shows a dash for an alliance where no team has estimated points", () => {
    expect(tables(["4590", "5987", ""]).estimatedScores).toEqual({ red: "-", blue: "129" });
  });
});

describe("Stage totals", () => {
  it("adds up each alliance's total on the Stages the Scouting App totals", () => {
    expect(tables().stages.map((stage) => [stage.label, stage.totals])).toEqual([
      ["Pit", null],
      ["Auto", { red: "24", blue: "20" }],
      ["Tele", { red: "61", blue: "55" }],
      ["Endgame", null],
    ]);
  });

  it("shows a dash for an alliance where no team has a total", () => {
    expect(tables(["4590", "5987", ""]).stages.flatMap((stage) => stage.totals ? [[stage.label, stage.totals]] : [])).toEqual([
      ["Auto", { red: "-", blue: "20" }],
      ["Tele", { red: "-", blue: "55" }],
    ]);
  });
});

describe("Best on each alliance", () => {
  it("draws the highest number brighter where higher is better", () => {
    expect(best(tables(), "Pit", "OPR")).toEqual({ red: ["254"], blue: ["1690"] });
  });

  it("draws the lowest number brighter where lower is better", () => {
    expect(best(tables(["2230", "3075", "5654"]), "Pit", "Stopped").red).toEqual(["3075"]);
  });

  it("draws tied numbers brighter together", () => {
    expect(best(tables(), "Pit", "Max Balls")).toEqual({ red: ["254"], blue: ["1690", "3339"] });
  });

  it("draws nothing brighter on an alliance until two of its teams have a number", () => {
    const shown = tables();

    expect(best(shown, "Pit", "EPA")).toEqual({ red: [], blue: [] });
    expect(best(shown, "Pit", "BPS")).toEqual({ red: ["254"], blue: ["1690"] });
  });

  it("leaves a row plain where neither way is better", () => {
    expect(best(tables(), "Pit", "Weight")).toEqual({ red: [], blue: [] });
  });
});
