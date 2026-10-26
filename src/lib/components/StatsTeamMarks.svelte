<script lang="ts">
  import type { StatsColumn } from "$lib/domain";

  let { column }: { column: StatsColumn } = $props();
</script>

{#if column.activeFaults}
  <div class="marks">
    <span class="fault-marker" role="img" aria-label={`${column.activeFaults} Active ${column.activeFaults === 1 ? "Fault" : "Faults"}`}>
      <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>{column.activeFaults}
    </span>
  </div>
{/if}

<style>
  .marks {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.25rem;
    margin-top: 0.35rem;
    white-space: normal;
  }
  .fault-marker {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: #dc2626;
    color: #ffffff;
    font-size: 0.8rem;
    font-weight: 700;
  }
</style>
