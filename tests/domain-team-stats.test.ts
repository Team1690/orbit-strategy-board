import { describe, expect, it } from "vitest";

import { newMatchPacket, statsView, type StatsViewInput } from "$lib/domain";
import type { Alliance, JsonObject, MatchPacket, TeamStatsAnswer } from "$lib/native/types";

import golden from "./fixtures/scouting-team-stats.json";

const fixture = golden as unknown as TeamStatsAnswer;

// the fixture event's next match
function quals5(red: Alliance = ["254", "4590", "2230"], blue: Alliance = ["1690", "1657", "3339"]): MatchPacket {
  return newMatchPacket({ matchName: "Quals 5", redTeams: red, blueTeams: blue, tbaEventKey: "2026isde3" }, "quals-5");
}

function view(packet: MatchPacket, input: Partial<StatsViewInput> = {}) {
  return statsView({ lastFetch: { kind: "ok", answer: fixture }, packet, chosenStage: null, teamColors: {}, autoLighten: false, now: 0, ...input });
}

function tables(packet: MatchPacket, input: Partial<StatsViewInput> = {}) {
  const shown = view(packet, input);
  if (shown.kind !== "stats") throw new Error(`expected the Stage tables but the tab shows ${shown.kind}`);
  return shown;
}

function edited(edit: (answer: TeamStatsAnswer) => void): TeamStatsAnswer {
  const copy = structuredClone(fixture);
  edit(copy);
  return copy;
}

function payloadOf(answer: TeamStatsAnswer, team: number): JsonObject {
  const found = answer.team_stats.find((candidate) => candidate.team_number === team);
  if (!found) throw new Error(`no Team Stats for ${team} in the fixture`);
  return found.payload as JsonObject;
}

function publishedRow(answer: TeamStatsAnswer, team: number, stageLabel: string, rowLabel: string): JsonObject {
  const stages = payloadOf(answer, team).stages as Array<{ label: string; rows: JsonObject[] }>;
  const row = stages.find((candidate) => candidate.label === stageLabel)?.rows.find((candidate) => candidate.label === rowLabel);
  if (!row) throw new Error(`no ${stageLabel} ${rowLabel} row for ${team} in the fixture`);
  return row;
}

function stage(shown: ReturnType<typeof tables>, label: string) {
  const found = shown.stages.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no ${label} Stage`);
  return found;
}

describe("Stats tab", () => {
  it("shows the Match's teams in Station order", () => {
    expect(tables(quals5()).columns.map(({ stationName, team }) => [stationName, team])).toEqual([
      ["Red 1", "254"], ["Red 2", "4590"], ["Red 3", "2230"], ["Blue 1", "1690"], ["Blue 2", "1657"], ["Blue 3", "3339"],
    ]);
  });

  it("leaves out a Station with no team", () => {
    expect(tables(quals5(["254", " ", "2230"], ["1690", "", "3339"])).columns.map((column) => column.stationName)).toEqual(["Red 1", "Red 3", "Blue 1", "Blue 3"]);
  });

  it("heads each column with its team number in its Team Color", () => {
    const columns = tables(quals5(), { teamColors: { "254": "#ff8800" }, autoLighten: true }).columns;

    expect(columns.find((column) => column.team === "254")?.color).toBe("#ff8800");
    expect(columns.find((column) => column.team === "1690")?.color).toBe("#3b3bff");
  });

  it("marks Our Team's column", () => {
    expect(tables(quals5()).columns.filter((column) => column.ourTeam).map((column) => column.team)).toEqual(["1690"]);
  });

  it("has one tab per Stage in the order the Scouting App sends them and opens on Pit", () => {
    const { stages } = tables(quals5());

    expect(stages.map((stage) => stage.label)).toEqual(["Pit", "Auto", "Tele", "Endgame", "Specific"]);
    expect(stages.filter((stage) => stage.chosen).map((stage) => stage.label)).toEqual(["Pit"]);
  });

  it("keeps the Stage picked on another Match, or opens on Pit when this Match has no such Stage", () => {
    const chosen = (chosenStage: string) => tables(quals5(), { chosenStage }).stages.filter((stage) => stage.chosen).map((stage) => stage.label);

    expect(chosen("Tele")).toEqual(["Tele"]);
    expect(chosen("Practice")).toEqual(["Pit"]);
  });

  it("labels each row once and shows each team's text in Station order", () => {
    const pit = stage(tables(quals5()), "Pit");

    expect(pit.rows.map((row) => row.label)).toEqual([
      "OPR", "EPA", "BPS", "Drive Uptime", "Overall Uptime", "Stopped", "Weight", "Height", "Width", "Max Balls", "Pass Trench", "Pass Bump",
    ]);
    expect(pit.rows[0].cells).toMatchObject([{ text: "55.1" }, { text: "-" }, { text: "12.0" }, { text: "42.5" }, { text: "18.2" }, { text: "25.6" }]);
  });

  it("keeps a row's explanation on the row", () => {
    const endgame = stage(tables(quals5()), "Endgame");

    expect(endgame.rows.map((row) => [row.label, row.explanation])).toEqual([
      ["Climb Level", null],
      ["Time Avg", "Estimated from the time of the last scouted action before the climb. This is not an accurate measurement of actual climb duration."],
      ["Climb (S/A/P)", null],
    ]);
  });

  it("shows No data for a team without Team Stats", () => {
    const shown = tables(quals5(["254", "4590", "5987"]));

    expect(shown.columns.map((column) => [column.team, column.noData])).toEqual([
      ["254", false], ["4590", false], ["5987", true], ["1690", false], ["1657", false], ["3339", false],
    ]);
    expect(shown.stages.flatMap((stage) => stage.rows.map((row) => row.cells[2]))).toEqual(Array(24).fill(null));
  });

  it("shows a dash for a value of a kind the board doesn't draw yet", () => {
    const answer = edited((copy) => {
      publishedRow(copy, 1690, "Pit", "OPR").value = { kind: "sparkline", text: "42.5", points: [38.1, 42.5] };
    });
    const pit = stage(tables(quals5(), { lastFetch: { kind: "ok", answer } }), "Pit");

    expect(pit.rows.find((row) => row.label === "OPR")?.cells[3]).toEqual({ text: "-" });
  });

  it("says the board needs updating when any team has Team Stats in a newer format, in the Match or not", () => {
    const answer = edited((copy) => {
      payloadOf(copy, 1657).version = 2;
    });
    const needsUpdate = {
      kind: "notice",
      title: "This board needs an update",
      detail: "The Scouting App publishes Team Stats in a newer format than this board can read.",
    };

    expect(view(quals5(), { lastFetch: { kind: "ok", answer } })).toEqual(needsUpdate);
    expect(view(quals5(["254", "4590", "2230"], ["1690", "3075", "3339"]), { lastFetch: { kind: "ok", answer } })).toEqual(needsUpdate);
  });

  it("says so while the Team Stats load", () => {
    expect(view(quals5(), { lastFetch: null })).toEqual({ kind: "loading" });
  });

  it("says Team Stats aren't set up in a build without the token", () => {
    expect(view(quals5(), { lastFetch: { kind: "not-set-up" } })).toEqual({
      kind: "notice",
      title: "Team Stats aren't set up in this build",
      detail: "Add HASURA_HTTP_LINK and HASURA_BOARD_TOKEN to orbit-strategy-board.env and rebuild.",
    });
  });

  it("says the database can't be reached when the fetch failed", () => {
    expect(view(quals5(), { lastFetch: { kind: "unreachable", detail: "fetch failed", cached: null } })).toEqual({
      kind: "notice",
      title: "Can't reach the database",
      detail: "fetch failed",
    });
  });
});
