import { invoke, isTauri, type InvokeArgs } from "@tauri-apps/api/core";

import { browserInvoke } from "./web";

import type {
  BoardMode, BoardState, BoardTool, CreateMatchInput, FieldRobotPositions,
  FuzzyBatchItem, FuzzyBatchMatch, FuzzyMatchResult, JsonValue, MatchPacket, NativeConfig,
  PdfDocumentPlan, QrProgress, SourceResponse, TbaEvent,
} from "./types";

export class NativeCommandError extends Error {
  readonly command: string;

  constructor(command: string, cause: unknown) {
    super(typeof cause === "string" ? cause : `Native command \"${command}\" failed`);
    this.name = "NativeCommandError";
    this.command = command;
    this.cause = cause;
  }
}

/** One typed boundary for all Tauri calls. Do not use it from pointer-move paths. */
async function call<TResult>(command: string, args?: InvokeArgs): Promise<TResult> {
  try {
    // The same Svelte build is deployed as a static website and embedded by
    // Tauri. Calling `invoke` in a normal browser fails because there is no
    // Tauri IPC bridge, so route web requests to the browser implementation.
    if (typeof window !== "undefined" && !isTauri()) {
      return await browserInvoke<TResult>(command, (args ?? {}) as Record<string, unknown>);
    }
    return await invoke<TResult>(command, args);
  } catch (error) {
    throw new NativeCommandError(command, error);
  }
}

// schedule reads always go through the browser implementation - tauri has no commands for them
// both sources allow cross-origin requests and their keys are compiled into the bundle anyway
async function sourceCall(command: string, args: Record<string, unknown>): Promise<SourceResponse> {
  try {
    return await browserInvoke<SourceResponse>(command, args);
  } catch (error) {
    throw new NativeCommandError(command, error);
  }
}

/**
 * Native service surface. Commands that move packets use one coarse payload
 * rather than a sequence of per-field IPC calls.
 */
export const native = {
  storage: {
    get: (key: string) => call<JsonValue | null>("storage_get", { key }),
    getMany: (keys: string[]) => call<Array<JsonValue | null>>("storage_get_many", { keys }),
    set: (key: string, value: JsonValue) => call<void>("storage_set", { key, value }),
    delete: (key: string) => call<void>("storage_delete", { key }),
    clear: () => call<void>("storage_clear"),
    entries: () => call<Array<[string, JsonValue]>>("storage_entries"),
  },
  model: {
    loadPackets: () => call<MatchPacket[]>("model_load_packets"),
    addPacket: (packet: MatchPacket) => call<string>("model_add_packet", { packet }),
    /** Atomic import path for Schedule Sync, QR, and file packets. */
    addPackets: (packets: MatchPacket[]) => call<string[]>("model_add_packets", { packets }),
    /** Atomic normalized replacement for a completed form or canvas commit. */
    replacePacket: (packet: MatchPacket) => call<string>("model_replace_packet", { packet }),
    deleteMatch: (id: string) => call<void>("model_delete_match", { id }),
    clearMatches: () => call<void>("model_clear_matches"),
  },
  matches: {
    createPacket: (input: CreateMatchInput) => call<MatchPacket>("match_create_packet", { ...input }),
    normalizePacket: (packet: MatchPacket) => call<MatchPacket>("match_normalize_packet", { packet }),
  },
  board: {
    state: () => call<BoardState>("board_state"),
    setMode: (mode: BoardMode) => call<BoardState>("board_set_mode", { mode }),
    setTool: (tool: BoardTool) => call<BoardState>("board_set_tool", { tool }),
    setColor: (color: number) => call<BoardState>("board_set_color", { color }),
    /** Call only for completed undoable edits, never while a stroke is moving. */
    recordAction: (action: string) => call<BoardState>("board_record_action", { action }),
    undo: () => call<string | null>("board_undo"),
    redo: () => call<string | null>("board_redo"),
  },
  tba: {
    setApiKey: (apiKey: string) => call<void>("tba_set_api_key", { apiKey }),
    hasApiKey: () => call<boolean>("tba_has_api_key"),
    teamMatchesStatus: (teamKey: string, eventKey: string, etag?: string | null) => sourceCall("tba_team_matches_status", { teamKey, eventKey, etag: etag ?? null }),
    teamEvents: (teamKey: string, year: number) => call<TbaEvent[]>("tba_team_events", { teamKey, year }),
  },
  nexus: {
    events: (etag?: string | null) => sourceCall("nexus_events", { etag: etag ?? null }),
    eventStatus: (eventKey: string, etag?: string | null) => sourceCall("nexus_event_status", { eventKey, etag: etag ?? null }),
  },
  qr: {
    encode: (payload: string) => call<string[]>("qr_encode", { payload }),
    reset: () => call<void>("qr_reset"),
    receive: (frame: string) => call<QrProgress>("qr_receive", { frame }),
    restorePacket: (payload: string) => call<MatchPacket>("qr_restore_packet", { payload }),
  },
  search: {
    match: (searchTerm: string, target: string, originalTarget?: string) =>
      call<FuzzyMatchResult | null>("fuzzy_match", { searchTerm, target, originalTarget }),
    batch: (items: FuzzyBatchItem[], searchLower: string, minScore?: number) =>
      call<FuzzyBatchMatch[]>("fuzzy_search_batch", { items, searchLower, minScore }),
  },
  pdf: {
    standardPlan: (frames: string[], matchName: string) => call<PdfDocumentPlan>("pdf_standard_plan", { frames, matchName }),
    largePlan: (frames: string[], matchName: string) => call<PdfDocumentPlan>("pdf_large_plan", { frames, matchName }),
  },
  field: {
    years: () => call<number[]>("field_years"),
    image: (year?: number) => call<string>("field_image", { year }),
    robotPositions: (year?: number) => call<FieldRobotPositions>("field_robot_positions", { year }),
  },
  platform: {
    validateUrl: (url: string) => call<string>("platform_validate_url", { url }),
    openUrl: (url: string) => call<void>("platform_open_url", { url }),
  },
  config: {
    current: () => call<NativeConfig>("config_current"),
  },
} as const;
