import type { MatchPacket, TeamStatsFetch } from "$lib/native/types";

import { packetLineup } from "./reassign";
import { OUR_TEAM, STATION_NAMES, STATIONS, stationAlliance, teamNumberKey, type AllianceColor, type StationKey } from "./stations";
import { resolveTeamColor, type TeamColorOverrides } from "./team-colors";

export interface StatsViewInput {
  // null until the first fetch answers
  fetch: TeamStatsFetch | null;
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
}

export type StatsView = { kind: "stats"; columns: StatsColumn[] };

export function statsView({ packet, teamColors, autoLighten }: StatsViewInput): StatsView {
  const lineup = packetLineup(packet);
  const columns = STATIONS.map((station) => {
    const team = lineup[station].trim();
    return {
      station, stationName: STATION_NAMES[station], alliance: stationAlliance(station),
      team, color: resolveTeamColor(team, teamColors, autoLighten), ourTeam: teamNumberKey(team) === OUR_TEAM,
    };
  });
  return { kind: "stats", columns };
}
