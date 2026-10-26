import { describe, expect, it } from "vitest";

import { parseNexusEvent, planSync, statsView, type AllianceColor } from "$lib/domain";
import type { MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

interface Listed { label: string; redTeams: string[]; blueTeams: string[] }

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

// the teams drawn brighter on each alliance
function best(shown: ReturnType<typeof tables>, stageLabel: string, rowLabel: string) {
  const row = shown.stages.find((stage) => stage.label === stageLabel)?.rows.find((candidate) => candidate.label === rowLabel);
  if (!row) throw new Error(`no ${stageLabel} ${rowLabel} row`);
  const teams = (alliance: AllianceColor) => shown.columns.flatMap((column, index) => column.alliance === alliance && row.cells[index]?.best ? [column.team] : []);
  return { red: teams("red"), blue: teams("blue") };
}

describe("Bench Teams on the Stats tab", () => {
  it("shows each alliance's Bench Team as a dimmed column right after its alliance's Stations", () => {
    expect(tables(synced(playoff1)).columns.map(({ stationName, team, bench }) => [stationName, team, bench])).toEqual([
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
    expect(best(shown, "Pit", "Max Balls").blue).toEqual(["1690", "3339"]);
    expect(best(shown, "Pit", "EPA").blue).toEqual([]);
  });
});
