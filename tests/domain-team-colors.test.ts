import { describe, expect, it } from "vitest";

import { emptyBoardConfig, readBoardConfig, removeTeamColorOverride, resolveTeamColor, setTeamColorOverride } from "$lib/domain";

describe("Team Colors", () => {
  it("come from the scouting app's color table", () => {
    expect(resolveTeamColor("1690")).toBe("#0100fc");
  });

  it("fall back to the scouting app's palette by team number for a team missing from the table", () => {
    expect(resolveTeamColor("11480")).toBe("#99b125");
  });

  it("use this device's override first", () => {
    expect(resolveTeamColor("1690", { "1690": "#33aaff" })).toBe("#33aaff");
    expect(resolveTeamColor("11480", { "11480": "#ff8800" })).toBe("#ff8800");
  });

  it("are drawn just light enough to stand out on the dark board when Auto-Lighten is on, keeping their hue", () => {
    expect(resolveTeamColor("1", {}, true)).toBe("#5f5f5f");
    expect(resolveTeamColor("1690", {}, true)).toBe("#3b3bff");
    expect(resolveTeamColor("67", {}, true)).toBe("#c00300");
    expect(resolveTeamColor("11", {}, true)).toBe("#ffc100");
    expect(resolveTeamColor("1690", {}, false)).toBe("#0100fc");
  });

  it("never lighten this device's override", () => {
    expect(resolveTeamColor("1690", { "1690": "#000080" }, true)).toBe("#000080");
  });

  it("can be overridden, changed, and reset on the device through the Board Config", () => {
    let config = setTeamColorOverride(emptyBoardConfig(), "1690", "#33AAFF");
    expect(resolveTeamColor("1690", config.teamColors)).toBe("#33aaff");

    config = setTeamColorOverride(config, "1690", "#ffffff");
    expect(resolveTeamColor("1690", config.teamColors)).toBe("#ffffff");

    config = removeTeamColorOverride(config, "1690");
    expect(resolveTeamColor("1690", config.teamColors)).toBe("#0100fc");
  });

  it("keep only valid overrides when a stored Board Config is read back", () => {
    const config = readBoardConfig({ teamColors: { "1690": "#33AAFF", "0254": "#00ff00", nope: "#123456", "4590": "red" } });

    expect(config.teamColors).toEqual({ "1690": "#33aaff", "254": "#00ff00" });
    expect(readBoardConfig(null)).toEqual(emptyBoardConfig());
  });

  it("have Auto-Lighten on unless the stored Board Config turned it off", () => {
    expect(emptyBoardConfig().autoLighten).toBe(true);
    expect(readBoardConfig({ teamColors: {} }).autoLighten).toBe(true);
    expect(readBoardConfig({ autoLighten: false }).autoLighten).toBe(false);
  });
});
