import { describe, expect, it } from "vitest";

import { dismissMatches, packetLineup, parseNexusEvent, parseTbaMatches, planSync, readExtras, reassignStations, type DismissedMatches, type EventSchedule } from "$lib/domain";
import type { MatchPacket } from "$lib/native/types";

import isde1Nexus from "./fixtures/nexus-2026isde1.json";
import isde1Tba from "./fixtures/tba-1690-2026isde1-matches.json";

let ids = 0;
const newId = () => `synced-${++ids}`;
const fromNexus = () => parseNexusEvent(isde1Nexus)!;
const fromTba = (matches: unknown = isde1Tba) => parseTbaMatches(matches, "2026isde1")!;
const sync = (schedule: EventSchedule, packets: readonly MatchPacket[] = [], dismissed: DismissedMatches = {}) => planSync({ packets, schedule, dismissed, newId });
const names = (packets: readonly MatchPacket[]) => packets.map((packet) => packet[0]);
// every recorded match is unplayed and the event also has a match without 1690 that comes first
const allMatchesWithUs = [
  { ...structuredClone(isde1Tba[0]), key: "2026isde1_qm1", comp_level: "qm", set_number: 1, match_number: 1, alliances: { red: { team_keys: ["frc9739", "frc10935", "frc6738"], score: -1 }, blue: { team_keys: ["frc5135", "frc3065", "frc3083"], score: -1 } } },
  ...structuredClone(isde1Tba).map((match) => ({ ...match, alliances: { red: { ...match.alliances.red, score: -1 }, blue: { ...match.alliances.blue, score: -1 } } })),
];

describe("Schedule Sync from TBA", () => {
  it("gives Synced Matches the same names and keys as Nexus does, without practice matches", () => {
    const board = sync(fromTba()).add;

    expect(names(board)).toEqual([
      "Quals 2", "Quals 9", "Quals 13", "Quals 16", "Quals 19", "Quals 27", "Quals 32", "Quals 36", "Quals 41", "Quals 45", "Quals 50", "Quals 53",
      "Playoff 1", "Playoff 7", "Playoff 11", "Final 1", "Final 2",
    ]);
    expect(board.map((packet) => packet[10])).toEqual(sync(fromNexus()).add.filter((packet) => !packet[0].startsWith("Practice") && packet[0] !== "Final 3").map((packet) => packet[10]));
  });

  it("switches from Nexus without duplicates and without reordering a Lineup when only the team order differs", () => {
    const board = sync(fromNexus()).add;
    const playoff1 = board.find((packet) => packet[0] === "Playoff 1")!;
    const handSet = reassignStations(playoff1, { ...packetLineup(playoff1), redOne: "2231", redTwo: "1690" });

    const plan = sync(fromTba(), board.map((packet) => (packet === playoff1 ? handSet : packet)));

    expect(plan.add).toEqual([]);
    expect(plan.update.every((packet) => packet.slice(1, 7).join() === board.find((before) => before[7] === packet[7])!.slice(1, 7).join() || packet[7] === handSet[7])).toBe(true);
    const refreshed = plan.update.find((packet) => packet[7] === handSet[7])!;
    expect(refreshed.slice(1, 7)).toEqual(handSet.slice(1, 7));
    expect(readExtras(refreshed).sync).toMatchObject({ red: ["11480", "2231", "1690"], blue: ["3211", "7067", "1580"] });
  });

  it("still applies a real team change reported by the other source", () => {
    const board = sync(fromNexus()).add;
    const replaced = structuredClone(isde1Tba);
    replaced.find((match) => match.key === "2026isde1_qm2")!.alliances.blue.team_keys = ["frc1690", "frc7039", "frc254"];

    const quals2 = sync(fromTba(replaced), board).update.find((packet) => packet[0] === "Quals 2")!;

    expect(quals2.slice(4, 7)).toEqual(["1690", "7039", "254"]);
  });

  it("only makes one of Our Team's matches the Next Match, even when the board still has a match we were moved out of", () => {
    const usInQuals1 = structuredClone(allMatchesWithUs);
    usInQuals1[0].alliances.red.team_keys = ["frc1690", "frc10935", "frc6738"];
    const board = sync(fromTba(usInQuals1)).add;

    const plan = sync(fromTba(allMatchesWithUs), board);

    expect(plan.nextMatch).toBe("2026isde1:qual:2");
  });

  it("switches back to Nexus adding only what TBA doesn't list", () => {
    const board = sync(fromTba()).add;

    expect(names(sync(fromNexus(), board).add)).toEqual(["Practice 3", "Practice 9", "Final 3"]);
  });

  it("counts a match as played once TBA has its result, and maps a replayed playoff key onto the original", () => {
    const pending = structuredClone(isde1Tba);
    const final2 = pending.find((match) => match.key === "2026isde1_f1m2")!;
    final2.alliances.red.score = -1;
    final2.alliances.blue.score = -1;
    pending.push({ ...structuredClone(pending.find((match) => match.key === "2026isde1_sf7m1")!), key: "2026isde1_sf7m2", match_number: 2 });

    const plan = sync(fromTba(pending));

    expect(plan.schedule["2026isde1:final:1"].played).toBe(true);
    expect(plan.schedule["2026isde1:final:2"].played).toBe(false);
    expect(plan.nextMatch).toBe("2026isde1:final:2");
    expect(names(plan.add).filter((name) => name === "Playoff 7")).toHaveLength(1);
    expect(plan.schedule["2026isde1:playoff:7"].status).toBeNull();
  });

  it("never shifts teams when TBA lists fewer than three", () => {
    const board = sync(fromNexus()).add;
    const shortened = structuredClone(isde1Tba);
    shortened.find((match) => match.key === "2026isde1_qm13")!.alliances.blue.team_keys = ["frc1574", "frc1690"];

    const quals13 = sync(fromTba(shortened), board).update.find((packet) => packet[0] === "Quals 13")!;

    expect(quals13.slice(4, 7)).toEqual(["1574", "", "1690"]);
  });
});

describe("What a sync found for Our Team", () => {
  it("counts Our Team's matches on the schedule", () => {
    expect(sync(fromTba()).ours).toBe(17);
    expect(sync(fromNexus()).ours).toBe(20);
  });

  it("reads an empty TBA answer as a schedule with none of Our Team's matches", () => {
    const plan = sync(fromTba([]));

    expect(plan.add).toEqual([]);
    expect(plan.ours).toBe(0);
    expect(parseTbaMatches({ Error: "not a list" }, "2026isde1")).toBeNull();
  });

  it("counts the deleted matches it left off the board", () => {
    const board = sync(fromTba()).add;
    const deleted = board.filter((packet) => packet[0] === "Quals 2" || packet[0] === "Final 1");

    const plan = sync(fromTba(), [], dismissMatches({}, deleted));

    expect(plan.add).toHaveLength(15);
    expect(plan.skipped).toBe(2);
  });
});
