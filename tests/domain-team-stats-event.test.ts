import { describe, expect, it } from "vitest";

import { newMatchPacket, parseNexusEvent, planSync, statsView, toWhatIfMatch } from "$lib/domain";
import type { MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import isde1 from "./fixtures/nexus-2026isde1.json";
import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's next match as nexus lists it
const isde3 = {
  eventKey: "2026isde3",
  matches: [{ label: "Qualification 5", status: "Queuing soon", redTeams: ["254", "4590", "2230"], blueTeams: ["1690", "1657", "3339"], times: {} }],
};

function synced(nexus: unknown, matchName: string): MatchPacket {
  const schedule = parseNexusEvent(nexus);
  if (!schedule) throw new Error("expected a schedule");
  const match = planSync({ packets: [], schedule, newId: () => "synced" }).add.find((packet) => packet[0] === matchName);
  if (!match) throw new Error(`no ${matchName} in the schedule`);
  return match;
}

function edited(edit: (answer: TeamStatsAnswer) => void): TeamStatsAnswer {
  const copy = structuredClone(fixture);
  edit(copy);
  return copy;
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

  it("shows no banner on a Synced Match at the event the Team Stats are from", () => {
    expect(banner(synced(isde3, "Quals 5"))).toBeNull();
  });

  it("keeps the banner on a What-if copy of a Match from another event, since the copy keeps its event key", () => {
    expect(banner(toWhatIfMatch(synced(isde1, "Quals 2")))).toEqual({ title: "Team Stats from 2026isde3", detail: "This Match is from 2026isde1." });
  });

  it("counts a What-if Match made with New as the Scouting App's event", () => {
    expect(banner(newMatchPacket({ matchName: "Sketch", redTeams: ["9740", "9738", "1574"], blueTeams: ["1690", "7039", "2231"] }, "sketch"))).toBeNull();
  });

  it("shows no banner when the Team Stats have no event", () => {
    const answer = edited((copy) => {
      for (const row of copy.team_stats) row.event = "";
    });

    expect(banner(synced(isde1, "Quals 2"), answer)).toBeNull();
  });
});
