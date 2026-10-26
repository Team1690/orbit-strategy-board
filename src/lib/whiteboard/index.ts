import field2025 from "../images/2025.png";
import field2026 from "../images/2026.png";
import { fieldLayout } from "$lib/domain/field-layout";
import { commonPathPaste, type CommonPath } from "$lib/domain/common-paths";
import { defaultInk, inkColor, inkStation, isStrokeErasable, isStrokeVisible, NEUTRAL_INK, officialInkColor, teamInk, type Lineup } from "$lib/domain/ink";
import type { StationKey } from "$lib/domain/stations";
import { resolveTeamColor, type TeamColorOverrides } from "$lib/domain/team-colors";
import { canvasLayout, clampCamera, distanceToSegment, homeCamera, pinchCamera, pointInRotatedRect, screenToField, segmentTouchesBounds, segmentsIntersect, strokeBounds, type BoardFrame, type Camera, type Point } from "./geometry";
import { FIELD_HEIGHT, FIELD_WIDTH, MAX_HISTORY, type BoardPhaseName, type CheckboxAnnotation, type RobotPosition, type Stroke, type WhiteboardCommit, type WhiteboardControllerOptions, type WhiteboardMatch, type WhiteboardMode, type WhiteboardPhase, type WhiteboardRefs, type WhiteboardState, type WhiteboardTool } from "./types";

export * from "./geometry";
export * from "./packet";
export * from "./types";

type Slot = StationKey;
type Action =
  | { kind: "stroke"; stroke: Stroke }
  | { kind: "erase"; strokes: Array<{ index: number; stroke: Stroke }>; checkboxes: Array<{ index: number; checkbox: CheckboxAnnotation }> }
  | { kind: "checkbox-add"; checkbox: CheckboxAnnotation }
  | { kind: "checkbox-toggle"; index: number; before: boolean; after: boolean }
  | { kind: "transform"; slot: Slot; before: Pick<RobotPosition, "x" | "y" | "r">; after: Pick<RobotPosition, "x" | "y" | "r"> }
  | { kind: "paste"; slot: Slot; strokes: Stroke[]; before: Pick<RobotPosition, "x" | "y" | "r">; after: Pick<RobotPosition, "x" | "y" | "r"> };

const slots: readonly Slot[] = ["redOne", "redTwo", "redThree", "blueOne", "blueTwo", "blueThree"];
const fieldImageCache = new Map<string, HTMLImageElement>();
const DOUBLE_TAP_MS = 400;
const TAP_SLOP_PX = 10;
const DOUBLE_TAP_SLOP_PX = 24;
const MAX_ZOOM = 3;
// room beside each alliance wall so the station labels never cover the field
const LABEL_MARGIN = 130;
// how long after the last pen event a touch still counts as the palm holding it
const PEN_NEAR_MS = 500;

function phaseFor(match: WhiteboardMatch, mode: BoardPhaseName): WhiteboardPhase { return match[mode]; }
function lineupOf(match: WhiteboardMatch): Lineup { return { redOne: match.redOne, redTwo: match.redTwo, redThree: match.redThree, blueOne: match.blueOne, blueTwo: match.blueTwo, blueThree: match.blueThree }; }
function isBlue(slot: Slot): boolean { return slot.startsWith("blue"); }
function samePose(a: Pick<RobotPosition, "x" | "y" | "r">, b: Pick<RobotPosition, "x" | "y" | "r">): boolean { return a.x === b.x && a.y === b.y && a.r === b.r; }
function onField(point: Point): boolean { return point[0] >= 0 && point[0] <= FIELD_WIDTH && point[1] >= 0 && point[1] <= FIELD_HEIGHT; }
function middle(points: readonly Point[]): Point { return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length]; }

/** Begin loading field art once per URL. It is a safe no-op during SSR/tests. */
export function preloadFieldImages(fieldImages: Readonly<Record<number, string>> = { 2025: field2025, 2026: field2026 }): void {
  if (typeof Image === "undefined") return;
  for (const url of Object.values(fieldImages)) {
    if (fieldImageCache.has(url)) continue;
    const image = new Image(); image.decoding = "async"; image.src = url;
    fieldImageCache.set(url, image);
  }
}

/**
 * Canvas-only whiteboard. It deliberately owns transient pointer/render state,
 * while the match object supplied by the application remains the sole durable
 * state. No movement is sent across IPC; `onCommit` fires at gesture boundaries.
 */
export class WhiteboardController {
  private refs: WhiteboardRefs | null = null;
  private contexts: { background: CanvasRenderingContext2D; items: CanvasRenderingContext2D; drawing: CanvasRenderingContext2D } | null = null;
  private match: WhiteboardMatch | null = null;
  private mode: WhiteboardMode = "auto";
  private tool: WhiteboardTool = "marker";
  private ink = NEUTRAL_INK;
  private camera: Camera = { zoom: 1, center: [FIELD_WIDTH / 2, FIELD_HEIGHT / 2] };
  private frame: BoardFrame = { width: 0, height: 0, scale: 1, left: 0, top: 0 };
  private pixelRatio = 1;
  private redrawRequest = 0;
  // pointers moving the view - fingers or a right-dragged mouse - in board pixels
  private movers = new Map<number, Point>();
  private gesture: { ids: number[]; camera: Camera; from: Point; reach: number } | null = null;
  private image: HTMLImageElement | null = null;
  private imageYear: number | undefined;
  private selected: { slot: Slot; robot: RobotPosition; offset: Point; rotating: boolean; before: Pick<RobotPosition, "x" | "y" | "r"> } | null = null;
  private pointer: {
    id: number; type: string; start: Point; screen: Point; last: Point; travel: number; stroke: Stroke | null; erased: Extract<Action, { kind: "erase" }>;
    waiting?: boolean; undoTop?: Action; redo?: Action[];
  } | null = null;
  private lastRobotTap: { slot: Slot; at: number } | null = null;
  private lastFieldTap: { at: number; screen: Point; mode: WhiteboardMode; action: Action | undefined; redo: Action[] | undefined } | null = null;
  private penDown = false;
  private penSeenAt = -Infinity;
  private undoHistory = new Map<BoardPhaseName, Action[]>();
  private redoHistory = new Map<BoardPhaseName, Action[]>();
  private resizeObserver: ResizeObserver | null = null;
  private abortController: AbortController | null = null;
  private teamColors: TeamColorOverrides = {};
  private autoLighten = false;
  private hiddenTeams = new Set<string>();
  private fingerDrawing = false;
  private readonly options: Required<Pick<WhiteboardControllerOptions, "fieldImages">> & Omit<WhiteboardControllerOptions, "fieldImages">;

  constructor(options: WhiteboardControllerOptions = {}) {
    this.options = { fieldImages: { 2025: field2025, 2026: field2026, ...options.fieldImages }, ...options };
    preloadFieldImages(this.options.fieldImages);
  }

  mount(refs: WhiteboardRefs): () => void {
    this.destroy();
    const foundContexts = {
      background: refs.background.getContext("2d"), items: refs.items.getContext("2d"), drawing: refs.drawing.getContext("2d"),
    };
    if (!foundContexts.background || !foundContexts.items || !foundContexts.drawing) throw new Error("Orbit Strategy Board requires 2D canvas support.");
    const contexts = { background: foundContexts.background, items: foundContexts.items, drawing: foundContexts.drawing };
    this.refs = refs;
    this.contexts = contexts;
    for (const canvas of [refs.background, refs.items, refs.drawing]) canvas.style.touchAction = "none";
    const signal = (this.abortController = new AbortController()).signal;
    refs.drawing.addEventListener("pointerdown", this.onPointerDown, { signal });
    refs.drawing.addEventListener("pointermove", this.onPointerMove, { signal });
    refs.drawing.addEventListener("pointerup", this.onPointerEnd, { signal });
    refs.drawing.addEventListener("pointercancel", this.onPointerEnd, { signal });
    refs.drawing.addEventListener("lostpointercapture", this.onPointerEnd, { signal });
    refs.drawing.addEventListener("wheel", this.onWheel, { signal, passive: false });
    refs.drawing.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
    // a pen hovering over the ink picker or toolbar still means a palm may be resting on the field
    window.addEventListener("pointermove", this.notePen, { signal, passive: true });
    window.addEventListener("keydown", this.onKeyDown, { signal });
    this.resizeObserver = new ResizeObserver(() => this.updateLayout());
    this.resizeObserver.observe(refs.container);
    this.updateLayout();
    this.redrawAll();
    return () => this.destroy();
  }

  destroy(): void {
    this.abortController?.abort(); this.abortController = null;
    this.resizeObserver?.disconnect(); this.resizeObserver = null;
    if (this.redrawRequest) cancelAnimationFrame(this.redrawRequest);
    this.redrawRequest = 0;
    this.refs = null; this.contexts = null; this.pointer = null; this.selected = null; this.movers.clear(); this.gesture = null;
  }

  setMatch(match: WhiteboardMatch | null): void {
    if (this.match?.id !== match?.id) {
      this.undoHistory.clear();
      this.redoHistory.clear();
      this.ink = match ? defaultInk(lineupOf(match)) : NEUTRAL_INK;
      this.hiddenTeams = new Set();
      this.camera = homeCamera(this.frame); this.movers.clear(); this.gesture = null;
    }
    this.match = match;
    this.selected = null; this.pointer = null;
    this.loadFieldImage();
    this.redrawAll(); this.emitState();
  }
  getMatch(): WhiteboardMatch | null { return this.match; }
  // the match changed outside the canvas - its undo history no longer applies
  reloadMatch(match: WhiteboardMatch): void {
    const inkTeam = this.inkTeam(this.ink);
    this.undoHistory.clear(); this.redoHistory.clear();
    this.match = match; this.selected = null; this.pointer = null;
    if (this.ink !== NEUTRAL_INK) {
      const station = slots.find((slot) => inkTeam !== null && match[slot].trim() === inkTeam);
      this.ink = station ? teamInk(station) : defaultInk(lineupOf(match));
    }
    this.loadFieldImage(); this.redrawAll(); this.emitState();
  }
  /** Field artwork year in use; phase labels differ from 2026 onward. */
  getCurrentFieldYear(): number | undefined { return this.fieldYear(); }
  getState(): WhiteboardState { return { mode: this.mode, tool: this.tool, ink: this.ink, zoomed: this.camera.zoom > 1, canUndo: this.canUndo(), canRedo: this.canRedo(), isCanvasVisible: this.mode !== "stats", hiddenTeams: [...this.hiddenTeams] }; }
  setMode(mode: WhiteboardMode): void {
    if (this.mode === mode) return;
    this.mode = mode; this.selected = null; this.pointer = null;
    if (mode !== "notes" && this.tool === "checkbox") this.tool = "marker";
    this.redrawAll(); this.emitState();
  }
  setTool(tool: WhiteboardTool): void { if (tool === "checkbox" && this.mode !== "notes") tool = "marker"; if (this.tool !== tool) { this.tool = tool; this.emitState(); } }
  toggleTool(): void { this.setTool(this.tool === "marker" ? "eraser" : this.tool === "eraser" ? (this.mode === "notes" ? "checkbox" : "marker") : "marker"); }
  setInk(ink: number): void {
    const next = ink === NEUTRAL_INK || inkStation(ink) ? ink : NEUTRAL_INK;
    const team = this.inkTeam(next);
    if (team && this.hiddenTeams.delete(team)) this.redrawDrawing();
    this.ink = next; this.emitState();
  }
  // hiding the selected ink's team falls back to neutral so new strokes never vanish as they are drawn
  toggleHiddenTeam(team: string): void {
    if (!team.trim()) return;
    if (this.hiddenTeams.has(team)) this.hiddenTeams.delete(team);
    else { this.hiddenTeams.add(team); if (this.inkTeam(this.ink) === team) this.ink = NEUTRAL_INK; }
    this.redrawDrawing(); this.emitState();
  }
  resetView(): void { this.setCamera(homeCamera(this.frame)); }
  forceRedraw(): void { this.redrawAll(); }
  setTeamColors(overrides: TeamColorOverrides, autoLighten: boolean): void { this.teamColors = overrides; this.autoLighten = autoLighten; this.drawItems(); this.redrawDrawing(); }
  setFingerDrawing(on: boolean): void { this.fingerDrawing = on; }
  resetMode(): void { this.setMode("auto"); }

  canUndo(): boolean { const mode = this.dataMode(); return !!mode && (this.undoHistory.get(mode)?.length ?? 0) > 0; }
  canRedo(): boolean { const mode = this.dataMode(); return !!mode && (this.redoHistory.get(mode)?.length ?? 0) > 0; }
  undo(): void { const mode = this.dataMode(); if (!mode || !this.match) return; const action = this.undoHistory.get(mode)?.pop(); if (!action) return; this.apply(action, "undo"); this.history(this.redoHistory, mode).push(action); this.redrawFor(action); this.commit("undo"); }
  redo(): void { const mode = this.dataMode(); if (!mode || !this.match) return; const action = this.redoHistory.get(mode)?.pop(); if (!action) return; this.apply(action, "redo"); this.history(this.undoHistory, mode).push(action); this.redrawFor(action); this.commit("redo"); }

  pasteCommonPath(path: CommonPath, station: StationKey): void {
    const phase = this.phase(); if (!phase || !this.match) return;
    const paste = commonPathPaste(path, station);
    const strokes: Stroke[] = paste.strokes;
    const robot = phase[`${station}Robot`]; const before = this.pose(robot); const after = { ...paste.pose };
    const team = this.match[station].trim(); if (team) this.hiddenTeams.delete(team);
    for (const stroke of strokes) { phase.drawing.push(stroke); phase.drawingBBox.push(strokeBounds(stroke)); }
    Object.assign(robot, after);
    this.drawItems(); this.redrawDrawing();
    this.record({ kind: "paste", slot: station, strokes, before, after }, "paste");
  }

  /** Produces a complete whole-field PNG (background, robots, and annotations). */
  exportPng(type = "image/png", quality?: number): string | null {
    if (!this.refs || typeof document === "undefined") return null;
    const margin = this.mode === "notes" ? 0 : LABEL_MARGIN;
    const output = document.createElement("canvas"); output.width = FIELD_WIDTH + margin * 2; output.height = FIELD_HEIGHT;
    const context = output.getContext("2d"); if (!context) return null;
    context.fillStyle = "#0d0d0d"; context.fillRect(0, 0, output.width, output.height); context.translate(margin, 0);
    this.paintBackground(context);
    if (margin) this.paintStationLabels(context, (x, y) => [x, y], 1);
    this.paintItems(context);
    const phase = this.phase(); if (phase && this.mode !== "stats") this.paintDrawing(context, phase, new Set());
    return output.toDataURL(type, quality);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier || event.code !== "KeyZ") return;
    event.preventDefault(); if (event.shiftKey) this.redo(); else this.undo();
  };
  private readonly notePen = (event: PointerEvent): void => { if (event.pointerType === "pen") this.penSeenAt = event.timeStamp; };
  private penNear(at: number): boolean { return this.penDown || at - this.penSeenAt < PEN_NEAR_MS; }
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.refs || !this.match || this.mode === "stats") return;
    const touch = event.pointerType === "touch";
    if (touch && this.penNear(event.timeStamp)) return;
    this.notePen(event);
    // the pointer events standard reports a pen's side button as the right button - some pens use the middle one - and it can be held as the tip lands
    const sideButton = event.pointerType === "pen" && (event.button === 1 || event.button === 2 || (event.buttons & 6) !== 0);
    if (sideButton) { this.endFingerDrawing(); this.toggleTool(); return; }
    const panning = event.pointerType === "mouse" && (event.button === 1 || event.button === 2);
    if (event.button !== 0 && !touch && !panning) return;
    event.preventDefault();
    const screen = this.screenPoint(event); if (!screen) return;
    if (panning || (touch && (!this.fingerDrawing || this.movers.size > 0))) { this.moverDown(event.pointerId, screen, touch); return; }
    if (touch) { this.refs.drawing.setPointerCapture(event.pointerId); this.movers.set(event.pointerId, screen); }
    if (event.pointerType === "pen") { this.penDown = true; this.dropTouches(); this.endFingerDrawing(); }
    const point = screenToField(screen, this.camera, this.frame);
    const grabbed = this.grab(point);
    // the strips beside the field only hold the station labels
    if (!grabbed && !onField(point)) return;
    this.refs.drawing.setPointerCapture(event.pointerId);
    const mode = this.dataMode();
    this.pointer = {
      id: event.pointerId, type: event.pointerType, start: point, screen, last: point, travel: 0, stroke: null, erased: { kind: "erase", strokes: [], checkboxes: [] },
      undoTop: mode ? this.undoHistory.get(mode)?.at(-1) : undefined, redo: mode ? this.redoHistory.get(mode) : undefined,
    };
    if (grabbed) { this.lastFieldTap = null; return; }
    // a quick second tap by the last one might be a double tap - it marks nothing until it moves
    if (this.secondTap(screen, event.timeStamp)) { this.pointer.waiting = true; return; }
    this.startMark(this.pointer);
  };
  private startMark(pointer: NonNullable<WhiteboardController["pointer"]>): void {
    const point = pointer.start;
    if (this.tool === "marker") pointer.stroke = [this.ink, [point[0], point[1]]];
    else if (this.tool === "checkbox") this.toggleCheckbox(point);
    else this.eraseSegment(point, point, pointer.erased);
  }
  private secondTap(screen: Point, at: number): boolean {
    const tap = this.lastFieldTap;
    return tap !== null && tap.mode === this.mode && at - tap.at < DOUBLE_TAP_MS && Math.hypot(screen[0] - tap.screen[0], screen[1] - tap.screen[1]) < DOUBLE_TAP_SLOP_PX;
  }
  private noteFieldTap(pointer: NonNullable<WhiteboardController["pointer"]>, event: PointerEvent): void {
    const mode = this.dataMode(); const top = mode ? this.undoHistory.get(mode)?.at(-1) : undefined;
    const tapped = event.type === "pointerup" && pointer.travel < TAP_SLOP_PX;
    this.lastFieldTap = tapped ? { at: event.timeStamp, screen: pointer.screen, mode: this.mode, action: top !== pointer.undoTop ? top : undefined, redo: pointer.redo } : null;
  }
  // takes back whatever the first tap left and switches between the marker and the eraser
  private doubleTap(): void {
    const tap = this.lastFieldTap; this.lastFieldTap = null;
    const mode = this.dataMode(); const undo = mode ? this.undoHistory.get(mode) : undefined;
    if (mode && tap?.action && undo?.at(-1) === tap.action) {
      undo.pop(); this.apply(tap.action, "undo"); this.redoHistory.set(mode, tap.redo ?? []); this.redrawFor(tap.action); this.commit("undo");
    }
    this.setTool(this.tool === "marker" ? "eraser" : "marker");
  }
  // one finger drags a robot or pans - a second finger pinches - a mouse pans with its right or middle button
  private moverDown(id: number, screen: Point, touch: boolean): void {
    this.refs?.drawing.setPointerCapture(id);
    this.movers.set(id, screen);
    if (this.movers.size > 2) return;
    if (this.movers.size === 2) { this.dropTouchMark(true); this.startGesture(); return; }
    const point = screenToField(screen, this.camera, this.frame);
    if (touch && this.grab(point)) { this.pointer = { id, type: "touch", start: point, screen, last: point, travel: 0, stroke: null, erased: { kind: "erase", strokes: [], checkboxes: [] } }; return; }
    this.startGesture();
  }
  private startGesture(): void {
    const ids = [...this.movers.keys()].slice(0, 2); const points = ids.map((id) => this.movers.get(id)!);
    this.gesture = { ids, camera: this.camera, from: middle(points), reach: points.length === 2 ? Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) : 0 };
  }
  private moveGesture(): void {
    const gesture = this.gesture; if (!gesture) return;
    const points = gesture.ids.map((id) => this.movers.get(id)).filter((point): point is Point => point !== undefined);
    if (points.length !== gesture.ids.length) return;
    const spread = gesture.reach ? Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) / gesture.reach : 1;
    this.setCamera(pinchCamera(gesture.camera, this.frame, gesture.from, middle(points), spread, MAX_ZOOM));
  }
  // a finger's unfinished mark gives way to a second finger or the pen - only a second finger leaves a dragged robot where it got to
  private dropTouchMark(keepRobot: boolean): void {
    const pointer = this.pointer; if (pointer?.type !== "touch") return;
    this.pointer = null;
    if (this.selected) {
      if (keepRobot) { this.settleSelected(); return; }
      Object.assign(this.selected.robot, this.selected.before); this.selected = null; this.drawItems(); return;
    }
    if (pointer.erased.strokes.length || pointer.erased.checkboxes.length) this.apply(pointer.erased, "undo");
    this.redrawDrawing();
  }
  // a palm can land before the pen does - whatever it moved goes back
  private dropTouches(): void {
    this.dropTouchMark(false);
    if (this.gesture) this.setCamera(this.gesture.camera);
    for (const id of this.movers.keys()) {
      try { this.refs?.drawing.releasePointerCapture(id); } catch { /* already released */ }
    }
    this.movers.clear(); this.gesture = null;
  }
  private endFingerDrawing(): void {
    if (!this.fingerDrawing) return;
    this.fingerDrawing = false; this.options.onPenReturn?.();
  }
  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.match || this.mode === "stats") return;
    const screen = this.screenPoint(event); if (!screen) return;
    event.preventDefault();
    // a trackpad pinch arrives as ctrl+wheel in much smaller steps
    const step = event.deltaY * (event.deltaMode === 1 ? 16 : 1) * (event.ctrlKey ? 0.01 : 0.002);
    this.setCamera(pinchCamera(this.camera, this.frame, screen, screen, Math.exp(-step), MAX_ZOOM));
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    this.notePen(event);
    if (this.movers.has(event.pointerId)) {
      const screen = this.screenPoint(event);
      if (screen) { this.movers.set(event.pointerId, screen); if (this.gesture?.ids.includes(event.pointerId)) { event.preventDefault(); this.moveGesture(); } }
    }
    const pointer = this.pointer; if (!pointer || pointer.id !== event.pointerId) return;
    const screen = this.screenPoint(event); if (!screen) return;
    const point = screenToField(screen, this.camera, this.frame);
    event.preventDefault();
    if (this.selected) { this.moveSelected(point); pointer.last = point; return; }
    pointer.travel = Math.max(pointer.travel, Math.hypot(screen[0] - pointer.screen[0], screen[1] - pointer.screen[1]));
    if (pointer.waiting) {
      if (pointer.travel < TAP_SLOP_PX) return;
      pointer.waiting = false; this.lastFieldTap = null; this.startMark(pointer);
    }
    if (this.tool === "marker" && pointer.stroke) {
      if (Math.hypot(point[0] - pointer.last[0], point[1] - pointer.last[1]) < 2) return;
      this.drawStrokeSegment(pointer.last, point, pointer.stroke[0]); pointer.stroke.push([point[0], point[1]]); pointer.last = point;
    } else if (this.tool === "eraser") { this.eraseSegment(pointer.last, point, pointer.erased); pointer.last = point; }
  };
  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.notePen(event);
    if (event.pointerType === "pen" && event.type !== "lostpointercapture") this.penDown = false;
    // android cancels a touch it decides was a palm
    const palm = event.type === "pointercancel" && event.pointerType === "touch";
    if (this.movers.delete(event.pointerId) && this.gesture?.ids.includes(event.pointerId)) {
      if (palm) this.setCamera(this.gesture.camera);
      this.gesture = null;
    }
    const pointer = this.pointer; if (!pointer || pointer.id !== event.pointerId) return;
    if (palm) { this.dropTouchMark(false); return; }
    try { this.refs?.drawing.releasePointerCapture(event.pointerId); } catch { /* browser may already have released it */ }
    this.pointer = null;
    if (this.selected) {
      const slot = this.settleSelected();
      if (slot && event.type === "pointerup") this.tapRobot(slot, pointer, event.timeStamp);
      return;
    }
    if (pointer.waiting) { if (event.type === "pointerup") this.doubleTap(); else this.lastFieldTap = null; return; }
    if (pointer.stroke) {
      const phase = this.phase(); if (phase) { phase.drawing.push(pointer.stroke); phase.drawingBBox.push(strokeBounds(pointer.stroke)); this.redrawDrawing(); this.record({ kind: "stroke", stroke: pointer.stroke }, "stroke"); }
    } else if (pointer.erased.strokes.length || pointer.erased.checkboxes.length) this.record(pointer.erased, "erase");
    this.noteFieldTap(pointer, event);
  };

  private dataMode(): BoardPhaseName | null { return this.mode === "stats" ? null : this.mode; }
  private phase(): WhiteboardPhase | null { return this.match && this.dataMode() ? phaseFor(this.match, this.dataMode()!) : null; }
  private history(store: Map<BoardPhaseName, Action[]>, mode: BoardPhaseName): Action[] { let values = store.get(mode); if (!values) { values = []; store.set(mode, values); } return values; }
  private record(action: Action, reason: WhiteboardCommit["reason"]): void { const mode = this.dataMode(); if (!mode) return; const undo = this.history(this.undoHistory, mode); undo.push(action); if (undo.length > MAX_HISTORY) undo.shift(); this.redoHistory.set(mode, []); this.commit(reason); }
  private commit(reason: WhiteboardCommit["reason"]): void { const mode = this.dataMode(); if (this.match && mode) void this.options.onCommit?.({ match: this.match, mode, reason }); this.emitState(); }
  private emitState(): void { this.options.onStateChange?.(this.getState()); }

  private apply(action: Action, direction: "undo" | "redo"): void {
    const phase = this.phase(); if (!phase) return;
    if (action.kind === "stroke") {
      if (direction === "undo") { const i = phase.drawing.indexOf(action.stroke); if (i >= 0) { phase.drawing.splice(i, 1); phase.drawingBBox.splice(i, 1); } }
      else { phase.drawing.push(action.stroke); phase.drawingBBox.push(strokeBounds(action.stroke)); }
    } else if (action.kind === "erase") {
      if (direction === "undo") {
        for (const { index, stroke } of [...action.strokes].sort((a, b) => a.index - b.index)) { phase.drawing.splice(index, 0, stroke); phase.drawingBBox.splice(index, 0, strokeBounds(stroke)); }
        for (const { index, checkbox } of [...action.checkboxes].sort((a, b) => a.index - b.index)) phase.checkboxes.splice(index, 0, checkbox);
      } else {
        for (const { stroke } of action.strokes) { const i = phase.drawing.indexOf(stroke); if (i >= 0) { phase.drawing.splice(i, 1); phase.drawingBBox.splice(i, 1); } }
        for (const { checkbox } of action.checkboxes) { const i = phase.checkboxes.indexOf(checkbox); if (i >= 0) phase.checkboxes.splice(i, 1); }
      }
    } else if (action.kind === "checkbox-add") {
      if (direction === "undo") { const i = phase.checkboxes.indexOf(action.checkbox); if (i >= 0) phase.checkboxes.splice(i, 1); } else phase.checkboxes.push(action.checkbox);
    } else if (action.kind === "checkbox-toggle") { if (phase.checkboxes[action.index]) phase.checkboxes[action.index][3] = direction === "undo" ? action.before : action.after; }
    else if (action.kind === "paste") {
      if (direction === "undo") for (const stroke of action.strokes) { const i = phase.drawing.indexOf(stroke); if (i >= 0) { phase.drawing.splice(i, 1); phase.drawingBBox.splice(i, 1); } }
      else for (const stroke of action.strokes) { phase.drawing.push(stroke); phase.drawingBBox.push(strokeBounds(stroke)); }
      Object.assign(phase[`${action.slot}Robot`], direction === "undo" ? action.before : action.after);
    }
    else { const robot = phase[`${action.slot}Robot`]; Object.assign(robot, direction === "undo" ? action.before : action.after); }
  }
  private redrawFor(action: Action): void { if (action.kind === "transform" || action.kind === "paste") this.drawItems(); if (action.kind !== "transform") this.redrawDrawing(); }

  // the canvases match the board's pixels so zoomed strokes stay sharp
  private updateLayout(): void {
    if (!this.refs) return;
    const { clientWidth: width, clientHeight: height } = this.refs.container;
    const layout = canvasLayout(width, height, FIELD_WIDTH, FIELD_HEIGHT, this.fieldYear(), LABEL_MARGIN);
    if (!layout) return;
    const atHome = this.camera.zoom <= 1;
    this.frame = { width, height, ...layout };
    this.pixelRatio = window.devicePixelRatio || 1;
    for (const canvas of [this.refs.background, this.refs.items, this.refs.drawing]) {
      const pixelWidth = Math.round(width * this.pixelRatio); const pixelHeight = Math.round(height * this.pixelRatio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    this.camera = atHome ? homeCamera(this.frame) : clampCamera(this.camera, this.frame, MAX_ZOOM);
    this.redrawAll();
  }
  private fieldYear(): number | undefined {
    const requested = this.match?.fieldMetadata?.selectedFieldYear ?? this.match?.tbaYear;
    const years = Object.keys(this.options.fieldImages).map(Number).sort((a, b) => a - b);
    if (!years.length) return undefined;
    if (!requested || !Number.isFinite(requested)) return years.at(-1);
    return years.reduce((chosen, year) => year <= requested && year > chosen ? year : chosen, years[0]);
  }
  private loadFieldImage(): void {
    const year = this.fieldYear(); if (year === this.imageYear && this.image) return; this.imageYear = year;
    if (typeof Image === "undefined" || !year) { this.image = null; return; }
    const url = this.options.fieldImages[year];
    let image = fieldImageCache.get(url);
    if (!image) { image = new Image(); image.decoding = "async"; image.src = url; fieldImageCache.set(url, image); }
    image.onload = () => { if (this.image === image) this.drawBackground(); };
    this.image = image; this.updateLayout();
  }
  private redrawAll(): void { this.drawBackground(); this.drawItems(); this.redrawDrawing(); }
  private scheduleRedraw(): void {
    if (this.redrawRequest) return;
    this.redrawRequest = requestAnimationFrame(() => { this.redrawRequest = 0; this.redrawAll(); });
  }
  private setCamera(camera: Camera): void {
    if (camera.zoom === this.camera.zoom && camera.center[0] === this.camera.center[0] && camera.center[1] === this.camera.center[1]) return;
    const zoomed = this.camera.zoom > 1;
    this.camera = camera; this.scheduleRedraw();
    if (zoomed !== camera.zoom > 1) this.emitState();
  }
  // from here on the context draws in field units and the camera decides where they land
  private begin(context: CanvasRenderingContext2D): void {
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    const scale = this.frame.scale * this.camera.zoom * this.pixelRatio;
    context.setTransform(scale, 0, 0, scale, (this.frame.width / 2) * this.pixelRatio - this.camera.center[0] * scale, (this.frame.height / 2) * this.pixelRatio - this.camera.center[1] * scale);
  }
  private drawBackground(): void {
    const context = this.contexts?.background; if (!context) return;
    this.begin(context); this.paintBackground(context);
    if (this.mode === "notes") return;
    // pinned where the whole-field view puts them so every team stays readable however far the field is zoomed
    const { scale, left, top } = this.frame;
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.paintStationLabels(context, (x, y) => [left + x * scale, top + y * scale], scale);
  }
  private paintBackground(context: CanvasRenderingContext2D): void {
    if (this.mode === "notes") { this.drawNotesGrid(context); return; }
    context.fillStyle = "#0d0d0d"; context.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
    if (this.image?.complete && this.image.naturalWidth) { context.imageSmoothingQuality = "high"; context.drawImage(this.image, 0, 0, FIELD_WIDTH, FIELD_HEIGHT); }
  }
  private paintStationLabels(context: CanvasRenderingContext2D, place: (x: number, y: number) => Point, unit: number): void {
    const match = this.match; if (!match) return;
    const labels = fieldLayout(this.fieldYear()).teamLabels;
    context.font = `bold ${64 * unit}px sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
    context.lineJoin = "round"; context.lineWidth = 12 * unit; context.strokeStyle = "rgba(0, 0, 0, 0.85)"; context.fillStyle = "white";
    for (const slot of slots) {
      const [x, y] = place(labels[slot].x, labels[slot].y);
      context.save(); context.translate(x, y); context.rotate(Math.PI / 2); context.strokeText(match[slot], 0, 0); context.fillText(match[slot], 0, 0); context.restore();
    }
  }
  private drawNotesGrid(context: CanvasRenderingContext2D): void { context.fillStyle = "#000"; context.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT); context.strokeStyle = "rgba(255,255,255,.2)"; context.lineWidth = 1; for (let x = 0; x < FIELD_WIDTH; x += 100) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, FIELD_HEIGHT); context.stroke(); } for (let y = 0; y < FIELD_HEIGHT; y += 100) { context.beginPath(); context.moveTo(0, y); context.lineTo(FIELD_WIDTH, y); context.stroke(); } }
  private drawItems(): void { const context = this.contexts?.items; if (!context) return; this.begin(context); this.paintItems(context); }
  private paintItems(context: CanvasRenderingContext2D): void {
    const phase = this.phase(); if (!phase || this.mode === "notes" || this.mode === "stats") return;
    for (const slot of slots) this.drawRobot(context, slot, phase[`${slot}Robot`]);
  }
  private drawRobot(context: CanvasRenderingContext2D, slot: Slot, robot: RobotPosition): void {
    const selected = this.selected?.slot === slot; const team = isBlue(slot) ? "#2563eb" : "#dc2626";
    // shadow blur ignores the transform so it is scaled by hand
    const unit = context.getTransform().a;
    context.save(); context.translate(robot.x, robot.y); context.rotate(robot.r); context.fillStyle = team; if (selected) { context.shadowBlur = 28 * unit; context.shadowColor = "#fff"; } context.beginPath(); context.roundRect(-robot.w / 2, -robot.h / 2, robot.w, robot.h, 20); context.fill(); context.shadowBlur = 0;
    context.fillStyle = "#242429"; context.beginPath(); context.roundRect(-robot.w / 2 + 17, -robot.h / 2 + 17, robot.w - 34, robot.h - 34, 10); context.fill();
    const teamNumber = this.match?.[slot].trim();
    if (teamNumber) {
      context.fillStyle = resolveTeamColor(teamNumber, this.teamColors, this.autoLighten); context.strokeStyle = "rgba(255,255,255,0.35)"; context.lineWidth = 3;
      context.beginPath(); context.roundRect(-robot.w / 2 + 27, robot.h / 2 - 49, robot.w - 54, 22, 6); context.fill(); context.stroke();
    }
    context.fillStyle = "#fff"; context.font = "bold 48px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; if (this.match) context.fillText(this.match[slot], 0, 0);
    if (selected) { context.beginPath(); context.arc(isBlue(slot) ? -robot.w / 2 : robot.w / 2, 0, 20, 0, Math.PI * 2); context.fill(); }
    context.restore();
  }
  private redrawDrawing(): void {
    const context = this.contexts?.drawing; const phase = this.phase(); if (!context) return; this.begin(context); if (!phase || this.mode === "stats") return;
    this.paintDrawing(context, phase, this.hiddenTeams);
    if (this.pointer?.stroke) this.drawStroke(context, this.pointer.stroke);
  }
  private paintDrawing(context: CanvasRenderingContext2D, phase: WhiteboardPhase, hiddenTeams: ReadonlySet<string>): void {
    const lineup = this.match ? lineupOf(this.match) : null;
    for (const stroke of phase.drawing) if (!lineup || isStrokeVisible(stroke[0], lineup, hiddenTeams)) this.drawStroke(context, stroke);
    for (const checkbox of phase.checkboxes ?? []) this.drawCheckbox(context, checkbox);
  }
  private drawStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.length < 2) return; context.lineWidth = 10; context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = this.strokeColor(stroke[0]); const first = stroke[1];
    if (stroke.length === 2) { context.fillStyle = context.strokeStyle; context.beginPath(); context.arc(first[0], first[1], 5, 0, Math.PI * 2); context.fill(); return; }
    context.beginPath(); context.moveTo(first[0], first[1]); for (const point of stroke.slice(2) as Point[]) context.lineTo(point[0], point[1]); context.stroke();
  }
  private drawStrokeSegment(start: Point, end: Point, ink: number): void { const context = this.contexts?.drawing; if (!context) return; context.lineWidth = 10; context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = this.strokeColor(ink); context.beginPath(); context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke(); }
  private drawCheckbox(context: CanvasRenderingContext2D, checkbox: CheckboxAnnotation): void { const [x, y] = checkbox; const size = 150; context.strokeStyle = officialInkColor(checkbox[2]); context.lineWidth = 8; context.strokeRect(x - size / 2, y - size / 2, size, size); if (checkbox[3]) { context.strokeStyle = "#22c55e"; context.lineWidth = 12; context.lineCap = "round"; context.beginPath(); context.moveTo(x - size / 2 + 15, y); context.lineTo(x - size / 6, y + size / 2 - 15); context.lineTo(x + size / 2 - 15, y - size / 2 + 15); context.stroke(); } }
  private inkTeam(ink: number): string | null { const station = inkStation(ink); return station && this.match ? this.match[station].trim() || null : null; }
  private strokeColor(ink: number): string { return this.match ? inkColor(ink, lineupOf(this.match), this.teamColors, this.autoLighten) : officialInkColor(ink); }
  private screenPoint(event: MouseEvent): Point | null { if (!this.refs) return null; const rect = this.refs.drawing.getBoundingClientRect(); if (!rect.width || !rect.height) return null; return [event.clientX - rect.left, event.clientY - rect.top]; }
  // true when the point lands on a robot or the selected robot's rotation handle - anywhere else deselects
  private grab(point: Point): boolean {
    if (this.selected && this.rotationHandleAt(point, this.selected)) { this.selected.rotating = true; this.selected.before = this.pose(this.selected.robot); return true; }
    const hit = this.robotAt(point);
    this.selected = hit && { ...hit, rotating: false, before: this.pose(hit.robot) }; this.drawItems();
    return hit !== null;
  }
  // the robot stays selected after a drag so its rotation handle is ready for the next gesture
  private settleSelected(): Slot | null {
    if (!this.selected) return null;
    const { slot, robot, before } = this.selected; const after = this.pose(robot);
    this.selected = { slot, robot, offset: [0, 0], rotating: false, before: after };
    if (!samePose(before, after)) this.record({ kind: "transform", slot, before, after }, "transform");
    this.drawItems(); return slot;
  }
  private pose(robot: RobotPosition): Pick<RobotPosition, "x" | "y" | "r"> { return { x: robot.x, y: robot.y, r: robot.r }; }
  private robotAt(point: Point): { slot: Slot; robot: RobotPosition; offset: Point } | null { const phase = this.phase(); if (!phase || this.mode === "notes") return null; for (const slot of [...slots].reverse()) { const robot = phase[`${slot}Robot`]; if (pointInRotatedRect(point, [robot.x, robot.y], robot.w, robot.h, robot.r)) return { slot, robot, offset: [robot.x - point[0], robot.y - point[1]] }; } return null; }
  private rotationHandleAt(point: Point, selected: NonNullable<WhiteboardController["selected"]>): boolean { const sign = isBlue(selected.slot) ? -1 : 1; const handle: Point = [selected.robot.x + sign * selected.robot.w / 2 * Math.cos(selected.robot.r), selected.robot.y + sign * selected.robot.w / 2 * Math.sin(selected.robot.r)]; return Math.hypot(point[0] - handle[0], point[1] - handle[1]) < 35; }
  private tapRobot(slot: Slot, pointer: NonNullable<WhiteboardController["pointer"]>, at: number): void {
    const moved = Math.hypot(pointer.last[0] - pointer.start[0], pointer.last[1] - pointer.start[1]) * this.frame.scale * this.camera.zoom >= TAP_SLOP_PX;
    const double = !moved && this.lastRobotTap?.slot === slot && at - this.lastRobotTap.at < DOUBLE_TAP_MS;
    this.lastRobotTap = moved || double ? null : { slot, at };
    if (double && this.match?.[slot].trim()) { this.setInk(teamInk(slot)); this.setTool("marker"); }
  }
  private moveSelected(point: Point): void { if (!this.selected) return; const { robot, offset, rotating, slot } = this.selected; if (rotating) { robot.r = Math.atan2(point[1] - robot.y, point[0] - robot.x) + (isBlue(slot) ? Math.PI : 0); } else { robot.x = point[0] + offset[0]; robot.y = point[1] + offset[1]; } this.drawItems(); }
  private toggleCheckbox(point: Point): void { const phase = this.phase(); if (!phase) return; const index = phase.checkboxes.findIndex(([x, y]) => Math.abs(x - point[0]) <= 60 && Math.abs(y - point[1]) <= 60); if (index >= 0) { const before = phase.checkboxes[index][3]; phase.checkboxes[index][3] = !before; this.redrawDrawing(); this.record({ kind: "checkbox-toggle", index, before, after: !before }, "checkbox"); } else { const checkbox: CheckboxAnnotation = [point[0], point[1], NEUTRAL_INK, false]; phase.checkboxes.push(checkbox); this.redrawDrawing(); this.record({ kind: "checkbox-add", checkbox }, "checkbox"); } }
  private eraseSegment(start: Point, end: Point, erased: Extract<Action, { kind: "erase" }>): void { const phase = this.phase(); if (!phase) return; const radius = 10; let changed = false; const lineup = this.match ? lineupOf(this.match) : null; for (let index = phase.drawing.length - 1; index >= 0; index--) { const stroke = phase.drawing[index]; if (lineup && !isStrokeErasable(stroke[0], lineup, this.hiddenTeams)) continue; if (!segmentTouchesBounds(start, end, phase.drawingBBox[index] ?? strokeBounds(stroke), radius)) continue; const points = stroke.slice(1) as Point[]; const hit = points.length === 1 ? distanceToSegment(points[0], start, end) <= radius + 5 : points.slice(1).some((point, i) => segmentsIntersect(start, end, points[i], point, radius)); if (hit) { phase.drawing.splice(index, 1); phase.drawingBBox.splice(index, 1); erased.strokes.push({ index, stroke }); changed = true; } }
    for (let index = phase.checkboxes.length - 1; index >= 0; index--) { const checkbox = phase.checkboxes[index]; if (distanceToSegment([checkbox[0], checkbox[1]], start, end) <= 75 + radius) { phase.checkboxes.splice(index, 1); erased.checkboxes.push({ index, checkbox }); changed = true; } }
    if (changed) this.redrawDrawing(); }
}

export function createWhiteboardController(options: WhiteboardControllerOptions = {}): WhiteboardController { return new WhiteboardController(options); }
