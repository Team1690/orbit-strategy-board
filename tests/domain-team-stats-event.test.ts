import { describe, expect, it } from "vitest";

import { parseNexusEvent, planSync, statsView } from "$lib/domain";
import type { MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import isde1 from "./fixtures/nexus-2026isde1.json";
import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

function synced(nexus: unknown, matchName: string): MatchPacket {
  const schedule = parseNexusEvent(nexus);
  if (!schedule) throw new Error("expected a schedule");
  const match = planSync({ packets: [], schedule, newId: () => "synced" }).add.find((packet) => packet[0] === matchName);
  if (!match) throw new Error(`no ${matchName} in the schedule`);
  return match;
}

function banner(packet: MatchPacket, answer: TeamStatsAnswer = fixture) {
  const shown = statsView({ lastFetch: { kind: "ok", answer }, packet, chosenStage: null, teamColors: {}, autoLighten: false });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown.eventBanner;
}

describe("Stats tab banner for a Match from another event", () => {
  it("names the event the Team Stats are from on a Synced Match from another event", () => {
    expect(banner(synced(isde1, "Quals 2"))).toEqual({ title: "Team Stats from 2026isde3", detail: "This Match is from 2026isde1." });
  });
});
