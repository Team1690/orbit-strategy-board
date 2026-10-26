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
  activeFaults: number;
  robotTags: StatsTag[];
}

export interface StatsTag {
  name: string;
  color: string;
}

export interface StatsFault {
  match: string;
  status: string;
  message: string;
  resolution: string | null;
  // "2/3 scouters" - only for a fault off a double-scouted match
  scouters: string | null;
}

export interface StatsTeamFaults {
  column: StatsColumn;
  faults: StatsFault[];
}

export interface StatsCell {
  text: string;
}

export interface StatsRow {
  label: string;
  explanation: string | null;
  // one per column - null where the team has no Team Stats
  cells: Array<StatsCell | null>;
}

export interface StatsStage {
  label: string;
  chosen: boolean;
  rows: StatsRow[];
  // listed below the table - only Pit has any
  faults: StatsTeamFaults[];
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

// Team Stats published before faults and tags have no such key - the same as none
function publishedList(payload: JsonValue | undefined, key: string): unknown[] {
  const list = isObject(payload) ? payload[key] : undefined;
  return Array.isArray(list) ? list : [];
}

function publishedTags(payload: JsonValue | undefined): StatsTag[] {
  return publishedList(payload, "robot_tags").flatMap((tag) => isObject(tag) && typeof tag.name === "string" && typeof tag.color === "string" ? [{ name: tag.name, color: tag.color }] : []);
}

function publishedFaults(payload: JsonValue | undefined): StatsFault[] {
  return publishedList(payload, "active_faults").flatMap((fault) => isObject(fault) && typeof fault.message === "string"
    ? [{
      match: typeof fault.match === "string" ? fault.match : "",
      status: typeof fault.status === "string" ? fault.status : "",
      message: fault.message,
      resolution: typeof fault.resolution === "string" ? fault.resolution : null,
      scouters: typeof fault.reported_by === "number" && typeof fault.scouters === "number" ? `${fault.reported_by}/${fault.scouters} scouters` : null,
    }]
    : []);
}

function tooNew(payload: JsonValue | undefined): boolean {
  return isObject(payload) && typeof payload.version === "number" && payload.version > TEAM_STATS_FORMAT_VERSION;
}

// a new kind of value doesn't bump the format version - so one this board can't draw shows as a dash
function cellText(value: JsonValue): string {
  return isObject(value) && value.kind === "text" && typeof value.text === "string" ? value.text : "-";
}

function unique(labels: string[]): string[] {
  return [...new Set(labels)];
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
  const faultsByTeam = teams.map(({ payload }) => publishedFaults(payload));
  const columns = teams.map(({ station, team, payload }, index) => ({
    station, stationName: STATION_NAMES[station], alliance: stationAlliance(station),
    team, color: resolveTeamColor(team, teamColors, autoLighten), ourTeam: teamNumberKey(team) === OUR_TEAM, noData: !isObject(payload),
    activeFaults: faultsByTeam[index].length, robotTags: publishedTags(payload),
  }));
  const faults = columns.flatMap((column, index) => faultsByTeam[index].length ? [{ column, faults: faultsByTeam[index] }] : []);
  const stagesByTeam = teams.map(({ payload }) => publishedStages(payload));
  const labels = unique(stagesByTeam.flatMap((stages) => stages.map((stage) => stage.label)));
  const chosen = chosenStage !== null && labels.includes(chosenStage) ? chosenStage : labels[0];
  const stages = labels.map((label) => {
    const teamStages = stagesByTeam.map((stages) => stages.find((stage) => stage.label === label));
    const rows = unique(teamStages.flatMap((stage) => stage?.rows.map((row) => row.label) ?? [])).map((rowLabel) => {
      const teamRows = teamStages.map((stage) => stage?.rows.find((row) => row.label === rowLabel));
      return {
        label: rowLabel,
        explanation: teamRows.find((row) => row?.explanation)?.explanation ?? null,
        cells: teamRows.map((row, index) => columns[index].noData ? null : { text: row ? cellText(row.value) : "-" }),
      };
    });
    // the first Stage is Pit - the board never goes by a Stage's label
    return { label, chosen: label === chosen, rows, faults: label === labels[0] ? faults : [] };
  });
  return { kind: "stats", columns, stages };
}
