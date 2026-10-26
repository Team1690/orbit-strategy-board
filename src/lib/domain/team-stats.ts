import type { JsonValue, MatchPacket, TeamStatsFetch } from "$lib/native/types";

import { isObject } from "./json";
import { packetLineup } from "./reassign";
import { OUR_TEAM, STATION_NAMES, STATIONS, stationAlliance, teamNumberKey, type AllianceColor, type StationKey } from "./stations";
import { resolveTeamColor, type TeamColorOverrides } from "./team-colors";

export const TEAM_STATS_FORMAT_VERSION = 1;

export interface StatsViewInput {
  // null until the first fetch answers
  lastFetch: TeamStatsFetch | null;
  packet: MatchPacket;
  chosenStage: string | null;
  teamColors: TeamColorOverrides;
  autoLighten: boolean;
}

export interface StatsColumn {
  station: StationKey;
  stationName: string;
  alliance: AllianceColor;
  team: string;
  color: string;
  ourTeam: boolean;
  noData: boolean;
}

// how the coach marks a yes, a no and an unknown
export type StatsMark = "green check" | "red cross" | "grey cross";

export interface StatsCell {
  text: string;
  // a yes or no is drawn as its mark, with text as its words
  mark?: StatsMark;
}

export interface StatsRow {
  label: string;
  explanation: string | null;
  // one per column - null where the team has no Team Stats
  cells: Array<StatsCell | null>;
}

export interface StatsGridCell {
  text: string;
  // reads nought - drawn faint so the cells with something in them stand out
  zero: boolean;
}

export interface StatsTeamGrid {
  rows: string[];
  columns: string[];
  // one list per row label, each as long as columns
  cells: StatsGridCell[][];
}

export interface StatsGrid {
  label: string;
  explanation: string | null;
  // one per column - null where the team has no grid to draw
  teams: Array<StatsTeamGrid | null>;
}

export interface StatsStage {
  label: string;
  chosen: boolean;
  rows: StatsRow[];
  // drawn below the Stage's table
  grids: StatsGrid[];
}

export type StatsView =
  | { kind: "loading" }
  | { kind: "notice"; title: string; detail: string | null }
  | { kind: "stats"; columns: StatsColumn[]; stages: StatsStage[] };

interface PublishedRow {
  label: string;
  explanation: string | null;
  value: JsonValue;
}

interface PublishedStage {
  label: string;
  rows: PublishedRow[];
}

function publishedRows(rows: JsonValue | undefined): PublishedRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => isObject(row) && typeof row.label === "string"
    ? [{ label: row.label, explanation: typeof row.explanation === "string" ? row.explanation : null, value: row.value ?? null }]
    : []);
}

function publishedStages(payload: JsonValue | undefined): PublishedStage[] {
  if (!isObject(payload) || !Array.isArray(payload.stages)) return [];
  return payload.stages.flatMap((stage) => isObject(stage) && typeof stage.label === "string" ? [{ label: stage.label, rows: publishedRows(stage.rows) }] : []);
}

function tooNew(payload: JsonValue | undefined): boolean {
  return isObject(payload) && typeof payload.version === "number" && payload.version > TEAM_STATS_FORMAT_VERSION;
}

function yesNoCell(answer: unknown): StatsCell | null {
  switch (answer) {
    case "yes": return { text: "Yes", mark: "green check" };
    case "no": return { text: "No", mark: "red cross" };
    case "unknown": return { text: "Unknown", mark: "grey cross" };
    default: return null;
  }
}

// a new kind of value doesn't bump the format version - so one this board can't draw shows as a dash
function cell(value: JsonValue): StatsCell {
  if (isObject(value) && value.kind === "text" && typeof value.text === "string") return { text: value.text };
  if (isObject(value) && value.kind === "yes_no") return yesNoCell(value.answer) ?? { text: "-" };
  return { text: "-" };
}

function unique(labels: string[]): string[] {
  return [...new Set(labels)];
}

const NOUGHT = /^0+(\/0+)*$/;

function isTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// a grid whose cells don't line up with its labels has nothing sure to draw
function teamGrid(value: JsonValue): StatsTeamGrid | null {
  if (!isObject(value) || value.kind !== "grid") return null;
  const { rows, columns, cells } = value;
  if (!isTexts(rows) || !isTexts(columns) || !Array.isArray(cells)) return null;
  const lines = cells.filter((line): line is string[] => isTexts(line) && line.length === columns.length);
  if (lines.length !== cells.length || cells.length !== rows.length) return null;
  return { rows, columns, cells: lines.map((line) => line.map((text) => ({ text, zero: NOUGHT.test(text) }))) };
}

// a row is a grid when any team sends it as one, so it never also shows in the table as dashes
function stageGrids(teamStages: Array<PublishedStage | undefined>, columns: StatsColumn[]): StatsGrid[] {
  const labels = unique(teamStages.flatMap((stage) => stage?.rows.filter((row) => isObject(row.value) && row.value.kind === "grid").map((row) => row.label) ?? []));
  return labels.map((label) => {
    const teamRows = teamStages.map((stage) => stage?.rows.find((row) => row.label === label));
    return {
      label,
      explanation: teamRows.find((row) => row?.explanation)?.explanation ?? null,
      teams: teamRows.map((row, index) => (row && !columns[index].noData ? teamGrid(row.value) : null)),
    };
  });
}

export function statsView({ lastFetch, packet, chosenStage, teamColors, autoLighten }: StatsViewInput): StatsView {
  if (!lastFetch) return { kind: "loading" };
  if (lastFetch.kind === "not-set-up") {
    return { kind: "notice", title: "Team Stats aren't set up in this build", detail: "Add HASURA_HTTP_LINK and HASURA_BOARD_TOKEN to orbit-strategy-board.env and rebuild." };
  }
  if (lastFetch.kind === "unreachable") return { kind: "notice", title: "Can't reach the database", detail: lastFetch.detail };
  const lineup = packetLineup(packet);
  const published = new Map(lastFetch.answer.team_stats.map((team) => [String(team.team_number), team.payload]));
  const teams = STATIONS.flatMap((station) => {
    const team = lineup[station].trim();
    return team ? [{ station, team, payload: published.get(teamNumberKey(team) ?? "") }] : [];
  });
  if (teams.some(({ payload }) => tooNew(payload))) {
    return { kind: "notice", title: "This board needs an update", detail: "The Scouting App publishes Team Stats in a newer format than this board can read." };
  }
  const columns = teams.map(({ station, team, payload }) => ({
    station, stationName: STATION_NAMES[station], alliance: stationAlliance(station),
    team, color: resolveTeamColor(team, teamColors, autoLighten), ourTeam: teamNumberKey(team) === OUR_TEAM, noData: !isObject(payload),
  }));
  const stagesByTeam = teams.map(({ payload }) => publishedStages(payload));
  const labels = unique(stagesByTeam.flatMap((stages) => stages.map((stage) => stage.label)));
  const chosen = chosenStage !== null && labels.includes(chosenStage) ? chosenStage : labels[0];
  const stages = labels.map((label) => {
    const teamStages = stagesByTeam.map((stages) => stages.find((stage) => stage.label === label));
    const grids = stageGrids(teamStages, columns);
    const rowLabels = unique(teamStages.flatMap((stage) => stage?.rows.map((row) => row.label) ?? [])).filter((rowLabel) => !grids.some((grid) => grid.label === rowLabel));
    const rows = rowLabels.map((rowLabel) => {
      const teamRows = teamStages.map((stage) => stage?.rows.find((row) => row.label === rowLabel));
      return {
        label: rowLabel,
        explanation: teamRows.find((row) => row?.explanation)?.explanation ?? null,
        cells: teamRows.map((row, index) => columns[index].noData ? null : row ? cell(row.value) : { text: "-" }),
      };
    });
    return { label, chosen: label === chosen, rows, grids };
  });
  return { kind: "stats", columns, stages };
}
