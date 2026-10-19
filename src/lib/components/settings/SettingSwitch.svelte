<script lang="ts">
  let { id, on, title, description, onToggle }: { id: string; on: boolean; title: string; description: string; onToggle: () => void } = $props();
</script>

<button {id} role="switch" aria-checked={on} class="flex items-center gap-4 text-left cursor-pointer" onclick={onToggle}>
  <span class="switch" class:on><span class="knob"></span></span>
  <span class="flex flex-col gap-0.5">
    <span class="text-base font-semibold text-[#e8e8e8]">{title}</span>
    <span class="text-sm text-[#999]">{description}</span>
  </span>
</button>

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
</style>
