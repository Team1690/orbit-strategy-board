import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView, type StatsViewInput } from "$lib/domain";
import type { Alliance, JsonObject, MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's next match
function quals5(red: Alliance = ["254", "4590", "2230"], blue: Alliance = ["1690", "1657", "3339"]): MatchPacket {
  return newMatchPacket({ matchName: "Quals 5", redTeams: red, blueTeams: blue, tbaEventKey: "2026isde3" }, "quals-5");
}

function tables(packet: MatchPacket, input: Partial<StatsViewInput> = {}) {
  const shown = statsView({ lastFetch: { kind: "ok", answer: fixture }, packet, chosenStage: null, teamColors: {}, autoLighten: false, ...input });
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

function stage(shown: ReturnType<typeof tables>, label: string) {
  const found = shown.stages.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no ${label} Stage`);
  return found;
}

function edited(edit: (answer: TeamStatsAnswer) => void): TeamStatsAnswer {
  const copy = structuredClone(fixture);
  edit(copy);
  return copy;
}

function notesOf(answer: TeamStatsAnswer, team: number): JsonObject {
  const payload = answer.team_stats.find((candidate) => candidate.team_number === team)?.payload as { stages: JsonObject[] } | undefined;
  const notes = payload?.stages.find((candidate) => candidate.label === "Specific")?.notes;
  if (!notes) throw new Error(`no Specific notes for ${team} in the fixture`);
  return notes as JsonObject;
}

function cardOf(shown: ReturnType<typeof tables>, team: string) {
  const found = stage(shown, "Specific").cardRows.flatMap((row) => row.cards).find((card) => card.column.team === team);
  if (!found) throw new Error(`no Specific card for ${team}`);
  return found;
}

describe("Specific Stage", () => {
  it("draws one card per Station team in Station order, Red row then Blue row, each headed like the team's column", () => {
    const shown = tables(quals5());
    const specific = stage(shown, "Specific");

    expect(specific.cardRows.map((row) => [row.alliance, row.cards.map((card) => card.column.team)])).toEqual([
      ["red", ["254", "4590", "2230"]],
      ["blue", ["1690", "1657", "3339"]],
    ]);
    expect(specific.cardRows.flatMap((row) => row.cards.map((card) => card.column))).toEqual(shown.columns);
    expect(specific.rows).toEqual([]);
  });

  it("lists only the categories someone wrote about, each with its stars, avg when more than one rating went in and the latest note in full", () => {
    // two scouters rated 1690's General - nobody wrote about its Scoring, Delivery, Intake, Defense or Stealing
    expect(cardOf(tables(quals5()), "1690").notes?.categories).toMatchObject([
      { label: "General", stars: 4, average: true, latest: "Very consistent cycles" },
      { label: "Driving", stars: 5, average: false, latest: "נהג מהיר ומדויק" },
      { label: "Climbing", stars: 5, average: false, latest: "Climbs L3 every match" },
    ]);
  });

  it("says how many older notes a category has", () => {
    const answer = edited((copy) => {
      (notesOf(copy, 1690).categories as JsonObject[])[0].older = 3;
    });

    expect(cardOf(tables(quals5()), "1690").notes.categories.map((category) => category.more)).toEqual(["+1 more note", null, null]);
    expect(cardOf(tables(quals5(), { lastFetch: { kind: "ok", answer } }), "1690").notes.categories[0].more).toBe("+3 more notes");
  });

  it("says how many scouters wrote about the team once more than one did", () => {
    const shown = tables(quals5());

    // two scouters wrote about 1690, one about 2230, and 3339's only scouter gave stars without writing
    expect(["1690", "2230", "3339", "4590"].map((team) => cardOf(shown, team).notes.scouters)).toEqual(["2 scouters", null, null, null]);
  });
});
