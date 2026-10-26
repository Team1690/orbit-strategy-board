<script lang="ts">
  import { plural, textDirection, type StatsColumn } from "$lib/domain";

  let { column }: { column: StatsColumn } = $props();
</script>

{#if column.activeFaults || column.robotTags.length}
  <div class="marks">
    {#if column.activeFaults}
      <span class="fault-marker" role="img" aria-label={plural(column.activeFaults, "Active Fault")}>
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>{column.activeFaults}
      </span>
    {/if}
    {#each column.robotTags as tag}
      <span class="tag" style:--tag={tag.color} dir={textDirection(tag.name)}>{tag.name}</span>
    {/each}
  </div>
{/if}

<style>
  .marks {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.25rem;
    max-width: 10rem;
    margin: 0.35rem auto 0;
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
  .tag {
    max-width: 100%;
    padding: 0.1rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--tag) 55%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--tag) 18%, transparent);
    color: var(--tag);
    font-size: 0.75rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
