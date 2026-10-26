/** JSON values accepted by the native command boundary. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type Alliance = readonly [string, string, string];
export type BoardMode = "auto" | "teleop" | "transition" | "endgame" | "notes" | "stats";
export type BoardTool = "marker" | "eraser";

export interface BoardState {
  mode: BoardMode;
  tool: BoardTool;
  color: number;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * The persisted and shared match format. It intentionally stays positional so
 * existing local data, QR codes, and Match Files remain compatible.
 */
export type MatchPacket = [
  matchName: string,
  redOne: string,
  redTwo: string,
  redThree: string,
  blueOne: string,
  blueTwo: string,
  blueThree: string,
  id: string,
  body: JsonValue[],
  tbaEventKey?: string | null,
  tbaMatchKey?: string | null,
  tbaYear?: number | null,
  fieldMetadata?: JsonObject | null,
];

/** A convenient read-only projection of a persisted packet for Svelte UI. */
export interface StrategyMatch {
  id: string;
  matchName: string;
  redOne: string;
  redTwo: string;
  redThree: string;
  blueOne: string;
  blueTwo: string;
  blueThree: string;
  tbaMatchKey: string | null;
  red: Alliance;
  blue: Alliance;
  packet: MatchPacket;
  tbaEventKey?: string;
  tbaYear?: number;
  fieldMetadata?: JsonObject;
}

export interface CreateMatchInput {
  matchName: string;
  redTeams: Alliance;
  blueTeams: Alliance;
  tbaEventKey?: string;
  tbaMatchKey?: string;
  tbaYear?: number;
}

export interface TbaEvent {
  key: string;
  name: string;
  event_code: string;
  event_type: number;
  start_date: string;
  end_date: string;
  year: number;
  city: string | null;
  state_prov: string | null;
  country: string | null;
}

// failures are results too so sync can say exactly what went wrong
export type SourceResponse =
  | { kind: "ok"; data: JsonValue; etag: string | null }
  | { kind: "not-modified"; etag: string | null }
  | { kind: "not-found" }
  | { kind: "missing-key" }
  | { kind: "rejected-key" }
  | { kind: "offline" }
  | { kind: "unreachable"; detail: string };

// the payload stays raw json - only the stats view reads it and it has to cope with formats newer than this board
export interface TeamStats {
  team_number: number;
  event: string;
  build_stamp: number;
  payload: JsonValue;
}

// confirmed_at is the server's time - the age the stats tab shows is worked out from it
export interface TeamStatsConfirmed {
  event: string;
  build_stamp: number;
  confirmed_at: string;
}

// the scouting app's golden fixture has this shape too, less the server's confirmed_at
export interface TeamStatsAnswer {
  team_stats: TeamStats[];
  // the one Confirmed row - empty until a publisher stamps it
  team_stats_confirmed: TeamStatsConfirmed[];
}

export type TeamStatsFetch =
  | { kind: "ok"; answer: TeamStatsAnswer }
  | { kind: "not-set-up" }
  | { kind: "unreachable"; detail: string };

export interface QrReceivingProgress {
  status: "receiving";
  received: number;
  total: number;
  duplicate: boolean;
}
export interface QrCompleteProgress { status: "complete"; payload: string; }
export type QrProgress = QrReceivingProgress | QrCompleteProgress;

export interface FuzzyMatchResult { score: number; matchedIndices: number[]; }
/** Native batch-search schema. Pre-normalizing once keeps large match lists fast. */
export interface FuzzyBatchItem {
  name: string;
  nameLower: string;
  details: string;
  detailsLower: string;
  key: string;
  keyLower: string;
}
export interface FuzzyBatchMatch { index: number; score: number; matchedIndices: number[]; }

export interface FieldPoint { x: number; y: number; }
export interface FieldRobotPositions {
  red: { one: FieldPoint; two: FieldPoint; three: FieldPoint };
  blue: { one: FieldPoint; two: FieldPoint; three: FieldPoint };
}

export interface PdfTextPlan {
  value: string;
  xMm: number;
  yMm: number;
  fontSizePt: number;
  bold: boolean;
}
export interface PdfQrPlan {
  payload: string;
  ordinal: number;
  total: number;
  xMm: number;
  yMm: number;
  sizeMm: number;
  label: PdfTextPlan | null;
}
export interface PdfPagePlan { pageIndex: number; texts: PdfTextPlan[]; qrCodes: PdfQrPlan[]; }
export interface PdfDocumentPlan { widthMm: number; heightMm: number; pages: PdfPagePlan[]; }

export interface NativeConfig {
  fieldPngPixelWidth: number;
  fieldPngPixelHeight: number;
  fieldRealWidthInches: number;
  fieldRealHeightInches: number;
  redOneStationX: number;
  redOneStationY: number;
  redTwoStationX: number;
  redTwoStationY: number;
  redThreeStationX: number;
  redThreeStationY: number;
  blueOneStationX: number;
  blueOneStationY: number;
  blueTwoStationX: number;
  blueTwoStationY: number;
  blueThreeStationX: number;
  blueThreeStationY: number;
  /** Never render this value or expose it beyond the native call boundary. */
  sharedTbaApiKey: string | null;
}
