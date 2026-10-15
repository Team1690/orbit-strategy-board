import { dismissMatches, isEventKey, isObject, isStillRunning, OUR_TEAM, parseNexusEvent, parseTbaMatches, pickCurrentEvent, planSync, readDismissedMatches, restoreDismissed, runningNexusEvents, SCHEDULE_SOURCE_NAMES, type CurrentEvent, type DismissedMatches, type EventQueue, type EventSchedule, type ScheduleSource, type SyncPlan } from "$lib/domain";
import { newId } from "$lib/features/runtime";
import { native } from "$lib/native/api";
import type { JsonValue, MatchPacket, SourceResponse } from "$lib/native/types";

import { app } from "./app.svelte";

const MANUAL_EVENT_KEY = "manualEventKey";
const BOOKKEEPING_KEY = "syncBookkeeping";
const QUEUE_KEY = "queueStatus";
const DISMISSED_KEY = "dismissedMatches";
const NEXUS_INTERVAL_MS = 30_000;
// tba caches responses for 61 seconds - asking more often only repeats the same answer
const TBA_INTERVAL_MS = 60_000;
const DETECTION_RETRY_MS = 5 * 60_000;

export type SyncState = "idle" | "syncing" | "synced" | "waiting" | "offline" | "error";
export interface SyncStatus {
  state: SyncState;
  message: string;
  eventKey: string | null;
  source: ScheduleSource | null;
  // last successful schedule read
  at: number | null;
}
interface Bookkeeping {
  etags: Record<string, string>;
  // reads whose last full answer listed none of our matches - an unchanged answer still has none
  empty: string[];
  source: ScheduleSource | null;
  eventKey: string | null;
  at: number | null;
  // kept so a launch without network still knows the current event
  detected: CurrentEvent | null;
}

let manualEventKey = $state<string | null>(null);
let currentEvent = $state<CurrentEvent | null>(null);
let queue = $state.raw<EventQueue | null>(null);
let dismissed = $state.raw<DismissedMatches>({});
// the revision makes each change distinct so an open match reloads even when the same ids change again
let lastChange = $state.raw<{ revision: number; ids: readonly string[] }>({ revision: 0, ids: [] });
let detectedAt = 0;
let status = $state<SyncStatus>({ state: "idle", message: "", eventKey: null, source: null, at: null });
let bookkeeping: Bookkeeping = { etags: {}, empty: [], source: null, eventKey: null, at: null, detected: null };
let loading: Promise<void> | null = null;
let running: Promise<void> | null = null;
let polling = false;
let timer: number | null = null;

const API_KEY_NAMES: Record<ScheduleSource, string> = { nexus: "NEXUS_API_KEY", tba: "TBA_API_KEY" };

function failureMessage(response: SourceResponse, eventKey: string, source: ScheduleSource = "nexus"): string {
  const name = SCHEDULE_SOURCE_NAMES[source];
  const key = API_KEY_NAMES[source];
  switch (response.kind) {
    case "not-found": return `${name} has no event called ${eventKey}.`;
    case "missing-key": return `This build has no ${name} API key. Add ${key} to orbit-strategy-board.env and rebuild.`;
    case "rejected-key": return `${name} rejected this build's API key.`;
    case "offline": return "You're offline. Sync resumes when the connection returns.";
    case "unreachable": return `Couldn't reach ${name} (${response.detail}).`;
    default: return "Sync failed.";
  }
}

function report(state: SyncState, message: string, eventKey: string | null): void {
  status = { state, message, eventKey, source: bookkeeping.source, at: bookkeeping.at };
}

async function saveBookkeeping(): Promise<void> {
  await native.storage.set(BOOKKEEPING_KEY, bookkeeping as unknown as JsonValue).catch(() => undefined);
}

async function recordRead(source: ScheduleSource, eventKey: string, etagKey: string, etag: string | null, empty?: boolean): Promise<void> {
  const etags = { ...bookkeeping.etags };
  if (etag) etags[etagKey] = etag;
  else delete etags[etagKey];
  const others = bookkeeping.empty.filter((key) => key !== etagKey);
  bookkeeping = { ...bookkeeping, etags, empty: empty === undefined ? bookkeeping.empty : empty ? [...others, etagKey] : others, source, eventKey, at: Date.now() };
  await saveBookkeeping();
}

function readBookkeeping(value: unknown): Bookkeeping {
  const stored: Partial<Bookkeeping> = isObject(value) ? value : {};
  return {
    etags: isObject(stored.etags) ? stored.etags : {},
    empty: Array.isArray(stored.empty) ? stored.empty.filter((key) => typeof key === "string") : [],
    source: stored.source === "nexus" || stored.source === "tba" ? stored.source : null,
    eventKey: typeof stored.eventKey === "string" ? stored.eventKey : null,
    at: typeof stored.at === "number" ? stored.at : null,
    detected: typeof stored.detected === "object" && stored.detected !== null && typeof stored.detected.eventKey === "string" ? stored.detected : null,
  };
}

async function resolveCurrentEvent(): Promise<{ event: CurrentEvent | null; failure: SourceResponse | null }> {
  const now = Date.now();
  if (manualEventKey) return { event: pickCurrentEvent({ manualEventKey, nexusEvents: null, nexusSchedules: {}, tbaEvents: null, now }), failure: null };
  if (isStillRunning(currentEvent, now)) return { event: currentEvent, failure: null };
  if (now - detectedAt < DETECTION_RETRY_MS) return { event: null, failure: null };
  const list = await native.nexus.events();
  if (list.kind !== "ok" && list.kind !== "not-modified" && list.kind !== "not-found") return { event: null, failure: list };
  detectedAt = now;
  const nexusEvents = list.kind === "ok" ? list.data : null;
  const nexusSchedules: Record<string, unknown> = {};
  for (const candidate of runningNexusEvents(nexusEvents, now)) {
    const response = await native.nexus.eventStatus(candidate.eventKey);
    if (response.kind === "ok") nexusSchedules[candidate.eventKey] = response.data;
  }
  let event = pickCurrentEvent({ manualEventKey: null, nexusEvents, nexusSchedules, tbaEvents: null, now });
  if (!event) {
    const tbaEvents = await native.tba.teamEvents(OUR_TEAM, new Date(now).getUTCFullYear()).catch(() => null);
    event = pickCurrentEvent({ manualEventKey: null, nexusEvents, nexusSchedules, tbaEvents, now });
  }
  bookkeeping = { ...bookkeeping, detected: event };
  await saveBookkeeping();
  return { event, failure: null };
}

const noMatchesMessage = (eventKey: string) => `${OUR_TEAM} has no matches at ${eventKey}.`;
const matchCount = (count: number) => `${count} match${count === 1 ? "" : "es"}`;

function reportUnchanged(source: ScheduleSource, eventKey: string, etagKey: string): void {
  if (bookkeeping.empty.includes(etagKey)) report("waiting", noMatchesMessage(eventKey), eventKey);
  else report("synced", `Up to date with ${SCHEDULE_SOURCE_NAMES[source]}.`, eventKey);
}

function reportPlan(plan: SyncPlan, source: ScheduleSource, eventKey: string): void {
  if (!plan.ours) {
    report("waiting", noMatchesMessage(eventKey), eventKey);
    return;
  }
  const name = SCHEDULE_SOURCE_NAMES[source];
  const added = plan.add.length;
  const updated = plan.update.length;
  const changes = added && updated ? `Added ${matchCount(added)} and updated ${updated} from ${name}.`
    : added ? `Added ${matchCount(added)} from ${name}.`
    : updated ? `Updated ${matchCount(updated)} from ${name}.`
    : `Up to date with ${name}.`;
  const skipped = plan.skipped ? ` ${plan.skipped} deleted ${plan.skipped === 1 ? "match wasn't" : "matches weren't"} re-added.` : "";
  report("synced", changes + skipped, eventKey);
}

// both sources failed - nexus only decides whether the event exists at all and whether we're offline
function reportFailure(eventKey: string, nexus: SourceResponse, tba: SourceResponse): void {
  if (nexus.kind === "offline" || tba.kind === "offline") report("offline", failureMessage({ kind: "offline" }, eventKey), eventKey);
  else if (nexus.kind === "not-found" && tba.kind === "not-found") report("error", `No event called ${eventKey} on Nexus or TBA.`, eventKey);
  else if (nexus.kind === "ok" && tba.kind === "not-found") report("waiting", `Waiting for the ${eventKey} schedule.`, eventKey);
  else report("error", failureMessage(tba, eventKey, "tba"), eventKey);
}

async function nexusEventStatus(eventKey: string, etag: string | undefined): Promise<SourceResponse> {
  try {
    return await native.nexus.eventStatus(eventKey, etag);
  } catch (error) {
    return { kind: "unreachable", detail: error instanceof Error ? error.message : String(error) };
  }
}

// a forced run skips etags and the tba throttle so the board matches the schedule even after matches were cleared
async function run(force: boolean): Promise<void> {
  const resolved = await resolveCurrentEvent();
  currentEvent = resolved.event;
  if (!resolved.event) {
    if (resolved.failure) report(resolved.failure.kind === "offline" ? "offline" : "error", failureMessage(resolved.failure, ""), null);
    else report("waiting", "Waiting for schedule.", null);
    return;
  }
  const eventKey = resolved.event.eventKey;
  report("syncing", status.message, eventKey);
  const etagKey = `nexus:event:${eventKey}`;
  const response = await nexusEventStatus(eventKey, force ? undefined : bookkeeping.etags[etagKey]);
  if (response.kind === "not-modified") {
    await recordRead("nexus", eventKey, etagKey, response.etag);
    reportUnchanged("nexus", eventKey, etagKey);
    return;
  }
  const schedule = response.kind === "ok" ? parseNexusEvent(response.data) : null;
  if (schedule) await applySchedule(schedule, etagKey, response.kind === "ok" ? response.etag : null);
  else await syncFromTba(eventKey, response, force);
}

// used while nexus has no schedule for the event - tba has no queue status and no practice matches
async function syncFromTba(eventKey: string, nexus: SourceResponse, force: boolean): Promise<void> {
  const etagKey = `tba:matches:${eventKey}`;
  if (!force && bookkeeping.source === "tba" && bookkeeping.eventKey === eventKey && bookkeeping.at !== null && Date.now() - bookkeeping.at < TBA_INTERVAL_MS) {
    reportUnchanged("tba", eventKey, etagKey);
    return;
  }
  const response = await native.tba.teamMatchesStatus(OUR_TEAM, eventKey, force ? null : bookkeeping.etags[etagKey]);
  if (response.kind === "not-modified") {
    await recordRead("tba", eventKey, etagKey, response.etag);
    reportUnchanged("tba", eventKey, etagKey);
    return;
  }
  if (response.kind !== "ok") {
    reportFailure(eventKey, nexus, response);
    return;
  }
  const schedule = parseTbaMatches(response.data, eventKey);
  if (schedule) await applySchedule(schedule, etagKey, response.etag);
  else report("waiting", `Waiting for the ${eventKey} schedule.`, eventKey);
}

async function applySchedule(schedule: EventSchedule, etagKey: string, etag: string | null): Promise<void> {
  const { eventKey, source } = schedule;
  await app.init();
  const plan = await app.applySync((packets) => planSync({ packets, schedule, dismissed, newId }));
  if (plan.update.length) lastChange = { revision: lastChange.revision + 1, ids: plan.update.map((packet) => packet[7]) };
  queue = { eventKey, schedule: plan.schedule, nextMatch: plan.nextMatch };
  await native.storage.set(QUEUE_KEY, queue as unknown as JsonValue).catch(() => undefined);
  await recordRead(source, eventKey, etagKey, etag, plan.ours === 0);
  reportPlan(plan, source, eventKey);
}

function canPoll(): boolean {
  return polling && document.visibilityState !== "hidden" && navigator.onLine !== false;
}

function scheduleNext(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = canPoll() ? window.setTimeout(() => { timer = null; void syncAndContinue(); }, NEXUS_INTERVAL_MS) : null;
}

async function syncAndContinue(): Promise<void> {
  await scheduleSync.syncNow();
  scheduleNext();
}

export const scheduleSync = {
  get manualEventKey(): string | null { return manualEventKey; },
  get currentEvent(): CurrentEvent | null { return currentEvent; },
  get queue(): EventQueue | null { return queue; },
  get dismissed(): DismissedMatches { return dismissed; },
  get lastChange(): { revision: number; ids: readonly string[] } { return lastChange; },

  async dismiss(deleted: readonly MatchPacket[]): Promise<void> {
    dismissed = dismissMatches(dismissed, deleted);
    await native.storage.set(DISMISSED_KEY, dismissed as unknown as JsonValue);
  },

  async restoreState(restored: { manualEventKey: string | null; dismissed: DismissedMatches }): Promise<void> {
    dismissed = restored.dismissed;
    queue = null;
    await native.storage.set(DISMISSED_KEY, dismissed as unknown as JsonValue);
    await native.storage.delete(QUEUE_KEY);
    await this.setManualEventKey(restored.manualEventKey);
    void this.syncNow(true);
  },

  async restore(eventKey: string): Promise<void> {
    dismissed = restoreDismissed(dismissed, eventKey);
    await native.storage.set(DISMISSED_KEY, dismissed as unknown as JsonValue);
    if (eventKey === currentEvent?.eventKey) void this.syncNow(true);
  },
  get status(): SyncStatus { return status; },

  init(): Promise<void> {
    loading ??= Promise.all([native.storage.get(MANUAL_EVENT_KEY), native.storage.get(BOOKKEEPING_KEY), native.storage.get(QUEUE_KEY), native.storage.get(DISMISSED_KEY)]).then(
      ([storedEventKey, storedBookkeeping, storedQueue, storedDismissed]) => {
        dismissed = readDismissedMatches(storedDismissed);
        manualEventKey = isEventKey(storedEventKey) ? storedEventKey : null;
        bookkeeping = readBookkeeping(storedBookkeeping);
        if (isStillRunning(bookkeeping.detected, Date.now())) currentEvent = bookkeeping.detected;
        queue = isObject(storedQueue) && typeof storedQueue.eventKey === "string" ? storedQueue as unknown as EventQueue : null;
        status = { ...status, eventKey: bookkeeping.eventKey, source: bookkeeping.source, at: bookkeeping.at };
      },
      () => undefined,
    );
    return loading;
  },

  // refuses a key only when both sources answer that no such event exists - offline or unreachable lets it through
  async useEvent(input: string): Promise<void> {
    const key = input.trim().toLowerCase();
    if (!isEventKey(key)) throw new Error("An event key looks like 2026isde1.");
    const [nexus, tba] = await Promise.all([nexusEventStatus(key, undefined), native.tba.teamMatchesStatus(OUR_TEAM, key).catch(() => null)]);
    if (nexus.kind === "not-found" && tba?.kind === "not-found") throw new Error(`No event called ${key} on Nexus or TBA.`);
    await this.setManualEventKey(key);
    await this.syncNow(true);
  },

  async forgetReads(): Promise<void> {
    bookkeeping = { ...bookkeeping, etags: {}, empty: [] };
    await saveBookkeeping();
  },

  async setManualEventKey(input: string | null): Promise<void> {
    const key = input?.trim().toLowerCase() || null;
    if (key && !isEventKey(key)) throw new Error("An event key looks like 2026isde1.");
    manualEventKey = key;
    currentEvent = null;
    detectedAt = 0;
    if (key) await native.storage.set(MANUAL_EVENT_KEY, key);
    else await native.storage.delete(MANUAL_EVENT_KEY);
  },

  // a forced sync waits for one already running instead of joining it - that one may have used an old etag
  syncNow(force = false): Promise<void> {
    if (running && !force) return running;
    const next: Promise<void> = (running ?? Promise.resolve())
      .then(() => run(force))
      .catch((error: unknown) => {
        console.error("Schedule Sync failed", error);
        report("error", "Sync failed. Your matches were not changed.", status.eventKey);
      })
      .finally(() => { if (running === next) running = null; });
    running = next;
    return next;
  },

  start(): () => void {
    if (polling) return () => undefined;
    polling = true;
    const onVisibility = () => { if (document.visibilityState === "visible") void syncAndContinue(); else scheduleNext(); };
    const onOnline = () => void syncAndContinue();
    const onOffline = () => {
      scheduleNext();
      report("offline", "You're offline. Sync resumes when the connection returns.", status.eventKey);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void this.init().then(syncAndContinue);
    return () => {
      polling = false;
      scheduleNext();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  },
};
