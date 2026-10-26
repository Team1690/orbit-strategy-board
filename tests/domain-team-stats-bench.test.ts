import { describe, expect, it } from "vitest";

import { parseNexusEvent, planSync, statsView } from "$lib/domain";
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

describe("Bench Teams on the Stats tab", () => {
  it("shows each alliance's Bench Team as a dimmed column right after its alliance's Stations", () => {
    expect(tables(synced(playoff1)).columns.map(({ stationName, team, bench }) => [stationName, team, bench])).toEqual([
      ["Red 1", "254", false], ["Red 2", "4590", false], ["Red 3", "2230", false], ["Red Bench", "5654", true],
      ["Blue 1", "1690", false], ["Blue 2", "1657", false], ["Blue 3", "3339", false], ["Blue Bench", "3075", true],
    ]);
  });
});
