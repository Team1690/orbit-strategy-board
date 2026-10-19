import { describe, expect, it } from "vitest";

import { canvasLayout, clampCamera, fieldToScreen, homeCamera, pinchCamera, screenToField, segmentTouchesBounds, segmentsIntersect, strokeBounds, type BoardFrame } from "../src/lib/whiteboard/geometry";

describe("whiteboard eraser geometry", () => {
  it("identifies direct and tolerance-based eraser intersections", () => {
    expect(segmentsIntersect([0, 0], [20, 20], [0, 20], [20, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [20, 0], [0, 3], [20, 3])).toBe(false);
    expect(segmentsIntersect([0, 0], [20, 0], [0, 3], [20, 3], 3)).toBe(true);
  });

  it("uses padded stroke bounds before detailed eraser segment checks", () => {
    expect(segmentTouchesBounds([0, 0], [30, 0], [10, 5, 20, 15])).toBe(false);
    expect(segmentTouchesBounds([0, 0], [30, 0], [10, 5, 20, 15], 5)).toBe(true);
    expect(strokeBounds([1, [50, 60]])).toEqual([45, 55, 55, 65]);
  });

  it("keeps canvas layout safe for invalid sizes and 2026 crop offsets", () => {
    expect(canvasLayout(0, 600, 3510, 1610)).toBeNull();
    const layout = canvasLayout(1000, 600, 3510, 1610, 2026);
    expect(layout?.scale).toBeCloseTo(0.2849);
    expect(layout?.left).toBe(0);
    expect(layout?.top).toBeCloseTo(40.6553);
  });

  it("leaves room beside the field for the station labels", () => {
    const layout = canvasLayout(1000, 600, 3510, 1610, 2026, 130)!;
    expect(layout.scale).toBeCloseTo(1000 / 3770);
    expect(layout.left).toBeCloseTo(130 * layout.scale);
    expect(layout.left + 3510 * layout.scale).toBeCloseTo(1000 - 130 * layout.scale);
  });
});

describe("whiteboard camera", () => {
  const frame: BoardFrame = { width: 1000, height: 600, ...canvasLayout(1000, 600, 3510, 1610)! };

  it("starts on the whole field with every field corner on screen", () => {
    const camera = homeCamera(frame);
    expect(fieldToScreen([0, 0], camera, frame)).toEqual([expect.closeTo(frame.left), expect.closeTo(frame.top)]);
    const [right, bottom] = fieldToScreen([3510, 1610], camera, frame);
    expect(right).toBeCloseTo(1000);
    expect(bottom).toBeLessThanOrEqual(600);
  });

  it("maps screen points back to the same field points", () => {
    const camera = { zoom: 2.5, center: [1200, 700] as const };
    const [x, y] = screenToField(fieldToScreen([1500, 300], camera, frame), camera, frame);
    expect(x).toBeCloseTo(1500);
    expect(y).toBeCloseTo(300);
  });

  it("keeps the field point under the fingers while pinching", () => {
    const camera = pinchCamera(homeCamera(frame), frame, [300, 300], [300, 300], 2, 3);
    expect(camera.zoom).toBe(2);
    const [x, y] = fieldToScreen(screenToField([300, 300], homeCamera(frame), frame), camera, frame);
    expect(x).toBeCloseTo(300);
    expect(y).toBeCloseTo(300);
  });

  it("zooms between the whole field and three times closer", () => {
    expect(pinchCamera(homeCamera(frame), frame, [500, 300], [500, 300], 10, 3).zoom).toBe(3);
    expect(pinchCamera(homeCamera(frame), frame, [500, 300], [500, 300], 0.2, 3).zoom).toBe(1);
  });

  it("cannot pan at the whole field or past its edges when zoomed", () => {
    expect(pinchCamera(homeCamera(frame), frame, [500, 300], [900, 100], 1, 3)).toEqual(homeCamera(frame));
    const zoomed = clampCamera({ zoom: 2, center: [-5000, 99999] }, frame, 3);
    expect(fieldToScreen([0, 0], zoomed, frame)[0]).toBeCloseTo(0);
    expect(screenToField([0, 600], zoomed, frame)[1]).toBeCloseTo(screenToField([0, 600], homeCamera(frame), frame)[1]);
  });
});
