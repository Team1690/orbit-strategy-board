import { describe, expect, it } from "vitest";

import { parseNexusEvent, planSync, statsView, swapBenchTeam } from "$lib/domain";
import type { MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";
import { drawnBrighter } from "./team-stats-helpers";

const fixture = golden as unknown as TeamStatsAnswer;

interface Listed { label: string; redTeams: string[]; blueTeams: string[] }

const quals5: Listed = { label: "Qualification 5", redTeams: ["254", "4590", "2230"], blueTeams: ["1690", "1657", "3339"] };
// each playoff alliance lists its Bench Team fourth
const playoff1: Listed = { label: "Playoff 1", redTeams: ["254", "4590", "2230", "5654"], blueTeams: ["1690", "1657", "3339", "3075"] };

function schedule(match: Listed) {
  const parsed = parseNexusEvent({ eventKey: "2026isde3", matches: [match] });
  if (!parsed) throw new Error("expected a schedule");
  return parsed;
}

function synced(match: Listed): MatchPacket {
  const [packet] = planSync({ packets: [], schedule: schedule(match), newId: () => "synced" }).add;
  if (!packet) throw new Error(`${match.label} wasn't synced`);
  return packet;
}

function tables(packet: MatchPacket) {
  const shown = statsView({ lastFetch: { kind: "ok", answer: fixture }, packet, chosenStage: null, teamColors: {}, autoLighten: false, now: 0 });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

describe("Bench Teams on the Stats tab", () => {
  it("shows each alliance's Bench Team as a dimmed column right after its alliance's Stations", () => {
    expect(tables(synced(playoff1)).columns.map(({ placeName, team, bench }) => [placeName, team, bench])).toEqual([
      ["Red 1", "254", false], ["Red 2", "4590", false], ["Red 3", "2230", false], ["Red Bench", "5654", true],
      ["Blue 1", "1690", false], ["Blue 2", "1657", false], ["Blue 3", "3339", false], ["Blue Bench", "3075", true],
    ]);
  });

  it("leaves Bench Teams out of the estimated score", () => {
    // the Station teams alone, as in Quals 5 - 5654 and 3075 would make it 128 vs 184
    expect(tables(synced(playoff1)).estimatedScores).toEqual({ red: "119", blue: "129" });
  });

  it("leaves Bench Teams out of the Stage totals", () => {
    expect(tables(synced(playoff1)).stages.flatMap((stage) => stage.totals ? [[stage.label, stage.totals]] : [])).toEqual([
      ["Auto", { red: "24", blue: "20" }],
      ["Tele", { red: "61", blue: "55" }],
    ]);
  });

  it("never draws a Bench Team brighter, nor counts its number toward its alliance's best", () => {
    const shown = tables(synced(playoff1));

    // 3075 has the most balls on blue and would be EPA's second number
    expect(drawnBrighter(shown, "Pit", "Max Balls").blue).toEqual(["1690", "3339"]);
    expect(drawnBrighter(shown, "Pit", "EPA").blue).toEqual([]);
  });

  it("marks a Bench Team's header with its Active Faults and Robot Tags like any other team's", () => {
    expect(tables(synced(playoff1)).columns.filter((column) => column.bench).map(({ team, activeFaults, robotTags }) => [team, activeFaults, robotTags])).toEqual([
      ["5654", 1, [{ name: "Watch intake", color: "#ffc107" }]],
      ["3075", 0, []],
    ]);
  });

  it("lists a Bench Team's Active Faults on Pit after its alliance's Station teams", () => {
    const [pit] = tables(synced(playoff1)).stages;

    expect(pit.faults.map(({ column, faults }) => [column.placeName, column.team, faults.map((fault) => fault.message)])).toEqual([
      ["Red 3", "2230", ["Robot dead on field"]],
      ["Red Bench", "5654", ["Shooter wheel loose"]],
      ["Blue 1", "1690", ["Lost comms", "Intake jams on the bump"]],
    ]);
  });

  it("puts each Bench Team's dimmed card at the end of its alliance's row on Specific", () => {
    const specific = tables(synced(playoff1)).stages.find((stage) => stage.label === "Specific");

    expect(specific?.cardRows.map(({ alliance, cards }) => [alliance, cards.map(({ column }) => [column.team, column.bench])])).toEqual([
      ["red", [["254", false], ["4590", false], ["2230", false], ["5654", true]]],
      ["blue", [["1690", false], ["1657", false], ["3339", false], ["3075", true]]],
    ]);
  });

  it("follows a swap - the Bench Team swapped in counts and the team it displaced is dimmed on the bench", () => {
    const shown = tables(swapBenchTeam(synced(playoff1), "blueTwo"));

    expect(shown.columns.filter((column) => column.alliance === "blue").map(({ placeName, team, bench }) => [placeName, team, bench])).toEqual([
      ["Blue 1", "1690", false], ["Blue 2", "3075", false], ["Blue 3", "3339", false], ["Blue Bench", "1657", true],
    ]);
    expect(shown.estimatedScores.blue).toBe("171");
  });

  it("follows a Lineup change the schedule reports", () => {
    const [changed] = planSync({ packets: [synced(playoff1)], schedule: schedule({ ...playoff1, redTeams: ["5654", "254", "2230", "4590"] }), newId: () => "unused" }).update;

    expect(tables(changed).columns.filter((column) => column.alliance === "red").map(({ placeName, team, bench }) => [placeName, team, bench])).toEqual([
      ["Red 1", "5654", false], ["Red 2", "254", false], ["Red 3", "2230", false], ["Red Bench", "4590", true],
    ]);
  });

  it("shows no Bench Team in a qualification Match", () => {
    expect(tables(synced(quals5)).columns.map(({ placeName, team, bench }) => [placeName, team, bench])).toEqual([
      ["Red 1", "254", false], ["Red 2", "4590", false], ["Red 3", "2230", false], ["Blue 1", "1690", false], ["Blue 2", "1657", false], ["Blue 3", "3339", false],
    ]);
  });
});

describe("Best on an alliance that ties throughout", () => {
  it("draws nobody brighter on an alliance where every team with a number shares the best", () => {
    const shown = tables(synced(quals5));

    // blue's three teams all have 100% and red's two numbers are both 0.0
    expect(drawnBrighter(shown, "Pit", "Drive Uptime")).toEqual({ red: ["254"], blue: [] });
    expect(drawnBrighter(shown, "Tele", "Avg Full Court")).toEqual({ red: [], blue: ["1690"] });
  });
});
