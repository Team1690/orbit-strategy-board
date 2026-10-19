<script lang="ts">
  import { boardConfig } from "$lib/stores/config.svelte";
  import SettingSwitch from "./SettingSwitch.svelte";

  const fingerDrawing = $derived(boardConfig.current.fingerDrawing);

  function toggleFingerDrawing() {
    void boardConfig.update({ ...boardConfig.current, fingerDrawing: !fingerDrawing });
  }
</script>

<SettingSwitch
  id="pen-finger-drawing"
  on={fingerDrawing}
  title="Finger Drawing"
  description="For when the Pen is missing or flat: a finger draws like the Pen and two fingers move the view. It turns itself off the next time the Pen touches the board."
  onToggle={toggleFingerDrawing}
/>
