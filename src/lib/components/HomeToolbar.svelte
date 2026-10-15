<script lang="ts">
  let { onNew, onImportQr, onImportFile, onClear, onSettings }: { onNew: () => void; onImportQr: () => void; onImportFile: () => void; onClear: () => void; onSettings: () => void } = $props();
</script>

<div
  id="home-toolbar"
  class="flex items-center justify-between gap-3 w-full h-24 bg-[#111111] border-b border-[#1e1e1e] pt-[env(safe-area-inset-top)]"
>
  <div
    id="home-toolbar-logo"
    class="flex items-center gap-[0.5em] min-w-0 font-bold text-[#e8e8e8] select-none cursor-pointer tracking-tight"
    onclick={() => location.reload()}
    role="button"
    tabindex="0"
    onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") location.reload(); }}
  >
    <img src="/logo.svg" alt="" class="h-[2em] w-auto shrink-0" draggable="false" />
    <span class="truncate">Orbit Strategy Board</span>
  </div>
  <div id="home-toolbar-actions" class="flex shrink-0 items-center">
    <button id="home-toolbar-new-btn" class="home-toolbar-btn btn-secondary" onclick={onNew}>New</button>
    <button id="home-toolbar-import-btn" class="home-toolbar-btn btn-secondary" onclick={onImportQr}>Import QR</button>
    <button id="home-toolbar-import-file-btn" class="home-toolbar-btn btn-secondary" onclick={onImportFile}>
      <span>Import file</span>
      <i class="fas fa-file-import"></i>
    </button>
    <button id="home-toolbar-clear-btn" class="home-toolbar-btn btn-danger" onclick={onClear}>Clear</button>
    <button
      id="home-toolbar-settings-btn"
      class="home-toolbar-btn btn-secondary"
      onclick={onSettings}
      aria-label="Settings"
      title="Settings"
    >
      <i class="fas fa-gear"></i>
    </button>
  </div>
</div>
