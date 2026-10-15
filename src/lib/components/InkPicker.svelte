<script lang="ts">
  import { onMount } from "svelte";
  import { inkColor, NEUTRAL_INK, resolveTeamColor, STATION_NAMES, STATIONS, stationAlliance, teamInk, teamNumberKey, type AllianceColor, type BenchTeams, type Lineup, type StationKey, type TeamColorOverrides } from "$lib/domain";
  import { native } from "$lib/native/api";

  let { lineup, ink, overrides, autoLighten, hiddenTeams, bench, onPick, onToggleHidden, onSavePath, onSwapBench, onRecolor }: {
    lineup: Lineup;
    ink: number;
    overrides: TeamColorOverrides;
    autoLighten: boolean;
    hiddenTeams: readonly string[];
    onPick: (ink: number) => void;
    onToggleHidden: (team: string) => void;
    onSavePath: (station: StationKey) => void;
    bench: BenchTeams;
    onSwapBench: (station: StationKey) => void;
    onRecolor: (team: string, color: string | null) => void;
  } = $props();

  const LAST_STATION: Partial<Record<StationKey, AllianceColor>> = { redThree: "red", blueThree: "blue" };
  const COLOR_CHOICES = ["#ffffff", "#9ca3af", "#facc15", "#fb923c", "#ef4444", "#f472b6", "#a855f7", "#3b82f6", "#38bdf8", "#2dd4bf", "#22c55e"];

  type Menu = { kind: "team"; station: StationKey; team: string } | { kind: "bench"; alliance: AllianceColor; team: string };
  let menu = $state<Menu | null>(null);
  let menuPlace = $state({ edge: 0, up: false, left: false });

  let expanded = $state(true);
  let closing = $state(false);

  type Offset = { x: number; y: number };
  const OFFSET_KEY = "inkPickerOffset";
  const DRAG_THRESHOLD = 8;
  let picker = $state<HTMLDivElement>();
  let offset = $state.raw<Offset>({ x: 0, y: 0 });
  let drag: { id: number; x: number; y: number; from: Offset; moving: boolean } | null = null;
  let swallowClick = false;

  function clamped(next: Offset): Offset {
    const area = picker?.parentElement;
    if (!picker || !area) return next;
    const homeLeft = picker.offsetLeft - offset.x;
    const homeTop = picker.offsetTop - offset.y;
    const minX = -homeLeft;
    const minY = -homeTop;
    const maxX = Math.max(minX, area.clientWidth - homeLeft - picker.offsetWidth);
    const maxY = Math.max(minY, area.clientHeight - homeTop - picker.offsetHeight);
    return { x: Math.min(Math.max(next.x, minX), maxX), y: Math.min(Math.max(next.y, minY), maxY) };
  }

  function startDrag(event: PointerEvent) {
    swallowClick = false;
    if (drag || menu || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, from: offset, moving: false };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moving = true;
      picker?.setPointerCapture(event.pointerId);
    }
    offset = clamped({ x: drag.from.x + dx, y: drag.from.y + dy });
  }

  function endDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moving) {
      swallowClick = true;
      void native.storage.set(OFFSET_KEY, offset).catch(() => undefined);
    }
    drag = null;
  }

  // a drag that started on a chip must not also pick it
  function guardClick(event: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  onMount(() => {
    void native.storage.get(OFFSET_KEY).then((stored) => {
      if (stored && typeof stored === "object" && "x" in stored && "y" in stored && typeof stored.x === "number" && typeof stored.y === "number") {
        offset = clamped({ x: stored.x, y: stored.y });
      }
    }, () => undefined);
  });

  // expanding or rotating the tablet can push a moved picker off the board
  $effect(() => {
    const area = picker?.parentElement;
    if (!picker || !area) return;
    const observer = new ResizeObserver(() => { offset = clamped(offset); });
    observer.observe(picker);
    observer.observe(area);
    return () => observer.disconnect();
  });

  const chips = $derived([
    { ink: NEUTRAL_INK, station: null, team: "", label: "Neutral", color: "#ffffff", alliance: "", empty: false, hidden: false },
    ...STATIONS.map((station) => {
      const team = lineup[station].trim();
      return {
        ink: teamInk(station), station, team, label: team || "Empty", color: inkColor(teamInk(station), lineup, overrides, autoLighten),
        alliance: stationAlliance(station), empty: !team, hidden: Boolean(team) && hiddenTeams.includes(team),
      };
    }),
  ]);

  function pick(chipInk: number) {
    if (!expanded) { expanded = true; return; }
    onPick(chipInk);
  }

  // the menu opens away from whichever board edges the trigger is near so it stays on screen
  function openMenu(next: Menu, trigger: HTMLElement) {
    menu = menu && menu.kind === next.kind && menu.team === next.team ? null : next;
    const area = picker?.parentElement;
    if (!menu || !picker || !area) return;
    const pickerRect = picker.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    const up = triggerRect.top + triggerRect.height / 2 > areaRect.top + areaRect.height / 2;
    menuPlace = {
      edge: up ? picker.clientHeight - trigger.offsetTop - trigger.offsetHeight : trigger.offsetTop,
      up,
      left: pickerRect.left + pickerRect.width / 2 > areaRect.left + areaRect.width / 2,
    };
  }

  function collapse() {
    closing = true;
    window.setTimeout(() => { closing = false; expanded = false; }, 300);
  }
</script>

<svelte:window onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} />

<!-- shifted with margins not translate - a transform would trap the fixed menu backdrop inside the picker -->
<div
  bind:this={picker}
  id="whiteboard-ink-picker"
  class="absolute flex flex-col gap-1.5 bottom-3 sm:bottom-4 md:bottom-6 left-3 sm:left-4 md:left-6 p-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-[1.6rem] select-none touch-none"
  class:ink-picker-hidden={closing}
  style:margin-left="{offset.x}px"
  style:margin-bottom="{-offset.y}px"
  role="toolbar"
  aria-label="Ink"
  tabindex="-1"
  onpointerdown={startDrag}
  onclickcapture={guardClick}
>
  {#each chips as chip (chip.ink)}
    <div class="ink-chip {chip.alliance}" class:selected={chip.ink === ink} class:empty={chip.empty} class:hidden-team={chip.hidden} class:collapsed-away={!expanded && chip.ink !== ink}>
      <button
        class="ink-pick"
        disabled={chip.empty}
        aria-pressed={chip.ink === ink}
        aria-label={chip.empty ? "Empty Station" : chip.ink === NEUTRAL_INK ? "Neutral Ink" : `Ink for team ${chip.label}`}
        onclick={() => pick(chip.ink)}
      >
        <span class="ink-swatch" style:background={chip.color}></span>
        <span>{chip.label}</span>
      </button>
      {#if chip.team && chip.station}
        {@const station = chip.station}
        <button
          class="ink-eye"
          aria-pressed={chip.hidden}
          aria-label={chip.hidden ? `Show team ${chip.team}` : `Hide team ${chip.team}`}
          onclick={() => onToggleHidden(chip.team)}
        >
          <i class="fas {chip.hidden ? 'fa-eye-slash' : 'fa-eye'}"></i>
        </button>
        <button class="ink-eye" aria-label={`More for team ${chip.team}`} aria-expanded={menu?.kind === "team" && menu.station === station} onclick={(event) => openMenu({ kind: "team", station, team: chip.team }, event.currentTarget)}>
          <i class="fas fa-ellipsis-vertical"></i>
        </button>
      {/if}
    </div>
    {@const benchAlliance = chip.station ? LAST_STATION[chip.station] : undefined}
    {@const benchTeam = benchAlliance ? bench[benchAlliance] : undefined}
    {#if benchAlliance && benchTeam}
      <div class="ink-chip bench-chip {benchAlliance}" class:collapsed-away={!expanded}>
        <button
          class="ink-pick"
          aria-label={`Bench Team ${benchTeam}, swap into a Station`}
          aria-expanded={menu?.kind === "bench" && menu.alliance === benchAlliance}
          onclick={(event) => openMenu({ kind: "bench", alliance: benchAlliance, team: benchTeam }, event.currentTarget)}
        >
          <span class="ink-swatch" style:background={resolveTeamColor(benchTeam, overrides, autoLighten)}></span>
          <span>{benchTeam}</span>
          <span class="bench-label">Bench <i class="fas fa-right-left"></i></span>
        </button>
      </div>
    {/if}
  {/each}
  {#if menu}
    {@const current = menu}
    <button class="ink-menu-backdrop" aria-label="Close the team menu" onclick={() => (menu = null)}></button>
    <div
      class="ink-menu"
      class:on-left={menuPlace.left}
      style:top={menuPlace.up ? null : `${menuPlace.edge}px`}
      style:bottom={menuPlace.up ? `${menuPlace.edge}px` : null}
      role="menu"
      aria-label={`Team ${current.team}`}
    >
      {#if current.kind === "team"}
        {@const team = current.team}
        {@const key = teamNumberKey(team)}
        {#if key}
          {@const color = resolveTeamColor(team, overrides, autoLighten)}
          <div class="ink-colors" role="group" aria-label={`Color for team ${team}`}>
            {#each COLOR_CHOICES as choice (choice)}
              <button
                class="ink-color"
                role="menuitemradio"
                aria-checked={choice === color}
                aria-label={`Color team ${team} ${choice}`}
                style:background={choice}
                onclick={() => onRecolor(team, choice)}
              ></button>
            {/each}
            <span class="ink-color ink-color-custom">
              <input type="color" value={color} aria-label={`Pick any color for team ${team}`} onchange={(event) => onRecolor(team, event.currentTarget.value)} />
            </span>
          </div>
          <!-- always rendered so picking a color never shifts the swatches under the finger -->
          <button role="menuitem" disabled={!overrides[key]} onclick={() => onRecolor(team, null)}>
            <span class="ink-swatch" style:background={resolveTeamColor(team, {}, autoLighten)}></span> Use scouting app color
          </button>
          <div class="ink-menu-divider" role="separator"></div>
        {/if}
        <button role="menuitem" onclick={() => { const { station } = current; menu = null; onSavePath(station); }}>
          <i class="fas fa-route w-5"></i> Save as Common Path…
        </button>
      {:else}
        {#each STATIONS.filter((station) => stationAlliance(station) === current.alliance) as station (station)}
          <button role="menuitem" onclick={() => { menu = null; onSwapBench(station); }}>
            <i class="fas fa-right-left w-5"></i> Swap {current.team} into {STATION_NAMES[station]}{lineup[station].trim() ? ` for ${lineup[station]}` : ""}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
  <div class="ink-chip justify-center" class:collapsed-away={!expanded}>
    <button id="whiteboard-ink-close" class="ink-pick justify-center" aria-label="Collapse the Ink picker" onclick={collapse}>
      <i class="fa fa-close text-red-500"></i>
    </button>
  </div>
</div>

<style>
  .ink-chip {
    display: flex;
    align-items: center;
    min-width: 11rem;
    height: 2.6rem;
    border: 2px solid #2e2e2e;
    border-left-width: 6px;
    border-radius: 999px;
    background: #141414;
    overflow: hidden;
    animation: colorItemSlideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .ink-chip.red { border-left-color: #dc2626; }
  .ink-chip.blue { border-left-color: #2563eb; }
  .ink-chip.selected {
    border-color: #ffffff;
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.25);
  }
  .ink-chip.red.selected { border-left-color: #dc2626; }
  .ink-chip.blue.selected { border-left-color: #2563eb; }
  .ink-chip.empty { opacity: 0.35; }
  .bench-chip { border-style: dashed; border-left-style: solid; }
  .bench-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-left: auto;
    color: #888;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .ink-chip.collapsed-away { display: none; }
  .ink-pick,
  .ink-eye {
    display: flex;
    align-items: center;
    height: 100%;
    min-height: 0;
    min-width: 0;
    border: none;
    background: transparent;
    color: #e8e8e8;
    font-family: inherit;
    cursor: pointer;
  }
  .ink-pick {
    flex: 1;
    gap: 0.6rem;
    padding: 0 0.5rem 0 0.65rem;
    font-size: 1rem;
    font-weight: 700;
  }
  .ink-pick:disabled { cursor: default; }
  .ink-eye {
    justify-content: center;
    width: 2.2rem;
    padding: 0;
    color: #777;
    border-left: 1px solid #2a2a2a;
  }
  .ink-eye:hover { color: #e8e8e8; }
  .hidden-team .ink-eye { color: #e89090; }
  .hidden-team .ink-pick { color: #777; }
  .hidden-team .ink-swatch { opacity: 0.35; }
  .ink-swatch {
    width: 1.2rem;
    height: 1.2rem;
    flex-shrink: 0;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-radius: 999px;
  }
  .ink-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    min-height: 0;
    border: none;
    background: transparent;
    cursor: default;
  }
  .ink-menu {
    position: absolute;
    left: calc(100% + 0.5rem);
    z-index: 11;
    min-width: 15rem;
    padding: 0.35rem;
    border: 1px solid #3a3a3a;
    border-radius: 0.75rem;
    background: #1a1a1a;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .ink-menu.on-left {
    left: auto;
    right: calc(100% + 0.5rem);
  }
  .ink-menu button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.75rem 0.9rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: #e8e8e8;
    font-family: inherit;
    font-size: 1rem;
    text-align: left;
    cursor: pointer;
  }
  .ink-menu button:hover { background: #252525; }
  .ink-menu button:disabled {
    opacity: 0.4;
    background: transparent;
    cursor: default;
  }
  .ink-colors {
    display: grid;
    grid-template-columns: repeat(6, 2.25rem);
    gap: 0.45rem;
    padding: 0.5rem 0.55rem;
  }
  .ink-menu .ink-color {
    position: relative;
    width: 2.25rem;
    height: 2.25rem;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 999px;
  }
  .ink-menu .ink-color[aria-checked="true"] { box-shadow: 0 0 0 2px #1a1a1a, 0 0 0 4px #ffffff; }
  .ink-color-custom {
    overflow: hidden;
    background: conic-gradient(#ef4444, #facc15, #22c55e, #38bdf8, #a855f7, #ef4444);
  }
  .ink-color-custom input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .ink-menu-divider {
    height: 1px;
    margin: 0.35rem 0;
    background: #2a2a2a;
  }
  #whiteboard-ink-picker.ink-picker-hidden .ink-chip {
    animation: colorItemSlideDown 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }
</style>
