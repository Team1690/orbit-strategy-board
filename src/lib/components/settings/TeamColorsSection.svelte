<script lang="ts">
  import { removeTeamColorOverride, resolveTeamColor, setTeamColorOverride, teamNumberKey } from "$lib/domain";
  import { boardConfig } from "$lib/stores/config.svelte";

  let team = $state("");
  let color = $state("#ffffff");

  const overrides = $derived(Object.entries(boardConfig.current.teamColors).sort(([a], [b]) => Number(a) - Number(b)));
  const autoLighten = $derived(boardConfig.current.autoLighten);
  const teamKey = $derived(teamNumberKey(team));

  function chooseTeam(event: Event) {
    team = (event.currentTarget as HTMLInputElement).value.replace(/\D/g, "").slice(0, 5);
    const key = teamNumberKey(team);
    if (key) color = resolveTeamColor(key, boardConfig.current.teamColors, autoLighten);
  }

  function toggleAutoLighten() {
    void boardConfig.update({ ...boardConfig.current, autoLighten: !autoLighten });
  }

  function add(event: SubmitEvent) {
    event.preventDefault();
    if (!teamKey) return;
    void boardConfig.update(setTeamColorOverride(boardConfig.current, teamKey, color));
    team = "";
  }

  function recolor(number: string, event: Event) {
    void boardConfig.update(setTeamColorOverride(boardConfig.current, number, (event.currentTarget as HTMLInputElement).value));
  }

  function remove(number: string) {
    void boardConfig.update(removeTeamColorOverride(boardConfig.current, number));
  }
</script>

<div class="flex flex-col gap-5">
  <button id="team-color-auto-lighten" role="switch" aria-checked={autoLighten} class="flex items-center gap-4 text-left cursor-pointer" onclick={toggleAutoLighten}>
    <span class="switch" class:on={autoLighten}><span class="knob"></span></span>
    <span class="flex flex-col gap-0.5">
      <span class="text-base font-semibold text-[#e8e8e8]">Auto-Lighten dark colors</span>
      <span class="text-sm text-[#999]">Scouting app colors too dark for the board are drawn lighter in the same hue. Overrides stay exactly as picked.</span>
    </span>
  </button>

  <form class="flex flex-wrap items-center gap-3" onsubmit={add}>
    <input
      id="team-color-team-input"
      placeholder="Team number"
      inputmode="numeric"
      maxlength="5"
      autocomplete="off"
      class="w-40 p-3 text-base text-center text-[#e8e8e8] rounded-[6px] bg-[#0d0d0d] border border-[#2a2a2a] outline-0"
      value={team}
      oninput={chooseTeam}
    />
    <input id="team-color-color-input" type="color" bind:value={color} aria-label="Override color" class="color-input" />
    <button id="team-color-add-btn" type="submit" class="px-5 py-3 btn-secondary disabled:opacity-40" disabled={!teamKey}>Override color</button>
  </form>

  {#if overrides.length}
    <ul id="team-color-overrides" class="flex flex-col border border-[#1e1e1e] rounded-[6px] divide-y divide-[#1e1e1e]">
      {#each overrides as [number, override] (number)}
        {@const scouting = resolveTeamColor(number, {}, autoLighten)}
        <li class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span class="w-20 text-lg font-semibold text-[#e8e8e8]">{number}</span>
          <label class="flex items-center gap-2 text-sm text-[#999]">
            On this device
            <input type="color" value={override} onchange={(event) => recolor(number, event)} class="color-input" />
          </label>
          <span class="flex items-center gap-2 text-sm text-[#666]">
            {scouting === resolveTeamColor(number) ? "Scouting app" : "Scouting app, lightened"}
            <span class="inline-block size-6 rounded border border-[#2a2a2a]" style:background={scouting}></span>
          </span>
          <button class="ml-auto px-4 py-2 btn-danger" onclick={() => remove(number)}>Remove</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-sm text-[#999]">No overrides yet. Every team uses its color from the scouting app.</p>
  {/if}
</div>

<style>
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 3.25rem;
    height: 1.875rem;
    border: 1px solid #2a2a2a;
    border-radius: 999px;
    background: #181818;
    transition: background 150ms, border-color 150ms;
  }

  .switch.on {
    border-color: #ebebeb;
    background: #ebebeb;
  }

  .knob {
    position: absolute;
    top: 0.1875rem;
    left: 0.1875rem;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 999px;
    background: #666;
    transition: transform 150ms, background 150ms;
  }

  .switch.on .knob {
    transform: translateX(1.375rem);
    background: #0d0d0d;
  }

  .color-input {
    width: 3.5rem;
    height: 2.75rem;
    padding: 0.2rem;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    background: #0d0d0d;
    cursor: pointer;
  }
</style>
