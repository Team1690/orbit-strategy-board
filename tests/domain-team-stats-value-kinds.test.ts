import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView, type StatsGrid, type StatsTeamGrid, type StatsViewInput } from "$lib/domain";
import type { Alliance, JsonObject, MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's next match
function quals5(red: Alliance = ["254", "4590", "2230"], blue: Alliance = ["1690", "1657", "3339"]): MatchPacket {
  return newMatchPacket({ matchName: "Quals 5", redTeams: red, blueTeams: blue, tbaEventKey: "2026isde3" }, "quals-5");
}

function stageOf(answer: TeamStatsAnswer, label: string, packet = quals5()) {
  const shown = statsView({ lastFetch: { kind: "ok", answer }, packet, chosenStage: null, teamColors: {}, autoLighten: false } satisfies StatsViewInput);
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  const found = shown.stages.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no ${label} Stage`);
  return found;
}

function edited(edit: (answer: TeamStatsAnswer) => void): TeamStatsAnswer {
  const copy = structuredClone(fixture);
  edit(copy);
  return copy;
}

function publishedRow(answer: TeamStatsAnswer, team: number, stageLabel: string, rowLabel: string): JsonObject {
  const stages = answer.team_stats.find((candidate) => candidate.team_number === team)?.payload as { stages: Array<{ label: string; rows: JsonObject[] }> };
  const row = stages.stages.find((candidate) => candidate.label === stageLabel)?.rows.find((candidate) => candidate.label === rowLabel);
  if (!row) throw new Error(`no ${stageLabel} ${rowLabel} row for ${team} in the fixture`);
  return row;
}

function climbLadder(answer: TeamStatsAnswer = fixture, packet = quals5()): StatsGrid {
  const grid = stageOf(answer, "Endgame", packet).grids.find((candidate) => candidate.label === "Climb Ladder");
  if (!grid) throw new Error("no Climb Ladder grid on Endgame");
  return grid;
}

// a team's grid the way it reads - the column labels, then each row label with its cells
function read(grid: StatsTeamGrid | null): string[] | null {
  return grid && [grid.columns.join(" "), ...grid.rows.map((label, index) => [label, ...grid.cells[index].map((cell) => cell.text)].join(" "))];
}

describe("Stats tab yes or no rows", () => {
  function cells(answer: TeamStatsAnswer, label: string) {
    return stageOf(answer, "Pit").rows.find((row) => row.label === label)?.cells;
  }

  it("marks each team's yes, no or unknown the way the coach does", () => {
    const yes = { text: "Yes", mark: "green check" };
    const no = { text: "No", mark: "red cross" };
    const unknown = { text: "Unknown", mark: "grey cross" };

    expect(cells(fixture, "Pass Trench")).toEqual([yes, unknown, no, yes, no, yes]);
    expect(cells(fixture, "Pass Bump")).toEqual([yes, unknown, no, no, yes, yes]);
  });

  it("shows a dash for an answer that isn't yes, no or unknown", () => {
    const answer = edited((copy) => {
      publishedRow(copy, 1690, "Pit", "Pass Trench").value = { kind: "yes_no", answer: "sometimes" };
    });

    expect(cells(answer, "Pass Trench")?.[3]).toEqual({ text: "-" });
  });
});

describe("Stats tab small grids", () => {
  it("draws a row whose value is a small grid below the Stage's table instead of in it", () => {
    const endgame = stageOf(fixture, "Endgame");

    expect(endgame.rows.map((row) => row.label)).toEqual(["Climb Level", "Time Avg", "Climb (S/A/P)"]);
    expect(endgame.grids.map((grid) => grid.label)).toEqual(["Climb Ladder"]);
    expect(stageOf(fixture, "Pit").grids).toEqual([]);
  });

  it("draws one grid per team in Station order", () => {
    expect(climbLadder().teams.map(read)).toEqual([
      ["Left Middle Right", "L3 2/2 1/1 0/0", "L2 0/0 0/0 0/0", "L1 0/0 0/0 0/0"],
      ["Left Middle Right", "L3 0/0 0/0 0/0", "L2 0/0 0/0 0/0", "L1 0/0 0/0 0/0"],
      ["Left Middle Right", "L3 0/0 0/0 0/0", "L2 0/0 0/0 0/0", "L1 0/0 1/2 0/0"],
      ["Left Middle Right", "L3 0/0 2/2 0/0", "L2 0/1 0/0 0/0", "L1 0/0 0/0 0/0"],
      ["Left Middle Right", "L3 0/0 0/0 0/0", "L2 0/0 0/0 2/3", "L1 0/0 0/0 0/0"],
      ["Left Middle Right", "L3 0/0 0/0 0/0", "L2 2/2 0/0 0/0", "L1 0/0 0/0 0/0"],
    ]);
  });

  it("draws a cell that reads nought faint, so the cells with something in them stand out", () => {
    const ours = climbLadder().teams[3];

    expect(ours?.cells.map((row) => row.map((cell) => cell.zero))).toEqual([[true, false, true], [false, true, true], [true, true, true]]);
  });

  it("has no grid for a team without Team Stats", () => {
    expect(climbLadder(fixture, quals5(["254", "4590", "5987"])).teams.map((grid) => grid !== null)).toEqual([true, true, false, true, true, true]);
  });

  it("has no grid for a team that didn't send one, or sent one that doesn't hold together", () => {
    const answer = edited((copy) => {
      const stages = copy.team_stats.find((candidate) => candidate.team_number === 1657)?.payload as { stages: Array<{ label: string; rows: JsonObject[] }> };
      const endgame = stages.stages.find((candidate) => candidate.label === "Endgame");
      if (endgame) endgame.rows = endgame.rows.filter((row) => row.label !== "Climb Ladder");
      publishedRow(copy, 3339, "Endgame", "Climb Ladder").value = { kind: "grid", rows: ["L3", "L2", "L1"], columns: ["Left", "Middle", "Right"], cells: [["0/0", "0/0", "0/0"]] };
    });

    expect(climbLadder(answer).teams.map((grid) => grid !== null)).toEqual([true, true, true, true, false, false]);
    expect(stageOf(answer, "Endgame").rows.map((row) => row.label)).toEqual(["Climb Level", "Time Avg", "Climb (S/A/P)"]);
  });

  it("keeps a grid row's explanation on its grid", () => {
    const answer = edited((copy) => {
      publishedRow(copy, 1690, "Endgame", "Climb Ladder").explanation = "Successes out of attempts on each slot.";
    });

    expect(climbLadder(answer).explanation).toBe("Successes out of attempts on each slot.");
    expect(climbLadder().explanation).toBeNull();
  });
});
