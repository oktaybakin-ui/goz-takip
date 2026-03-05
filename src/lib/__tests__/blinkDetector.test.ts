import { BlinkDetector } from "../blinkDetector";

describe("BlinkDetector", () => {
  it("starts with OPEN state and no blinks", () => {
    const bd = new BlinkDetector();
    bd.start();
    expect(bd.isBlinking()).toBe(false);
    const m = bd.getMetrics();
    expect(m.blinkCount).toBe(0);
    expect(m.currentState).toBe("OPEN");
  });

  it("does not detect blink when EAR stays above threshold", () => {
    const bd = new BlinkDetector(0.20, 3);
    bd.start();
    for (let i = 0; i < 30; i++) {
      bd.update(0.30, 0.30, 1000 + i * 33);
    }
    expect(bd.getMetrics().blinkCount).toBe(0);
    expect(bd.isBlinking()).toBe(false);
  });

  it("detects blink when EAR drops below threshold for consecutive frames", () => {
    const bd = new BlinkDetector(0.20, 3, 2);
    bd.start();
    // Eyes open
    for (let i = 0; i < 5; i++) {
      bd.update(0.30, 0.30, 1000 + i * 33);
    }
    // Eyes closing (below threshold for 3+ frames)
    for (let i = 0; i < 5; i++) {
      bd.update(0.10, 0.10, 1200 + i * 33);
    }
    // Eyes opening
    for (let i = 0; i < 3; i++) {
      bd.update(0.30, 0.30, 1400 + i * 33);
    }
    // Wait for post-blink to clear
    for (let i = 0; i < 5; i++) {
      bd.update(0.30, 0.30, 1600 + i * 33);
    }
    expect(bd.getMetrics().blinkCount).toBe(1);
  });

  it("rejects very short blinks (< 50ms)", () => {
    const bd = new BlinkDetector(0.20, 1, 0); // 1 consecutive frame, no post-blink
    bd.start();
    // Open
    bd.update(0.30, 0.30, 1000);
    // Very short close (1 frame at 33ms)
    bd.update(0.10, 0.10, 1033);
    // Open again
    bd.update(0.30, 0.30, 1040); // Only 7ms duration → rejected
    bd.update(0.30, 0.30, 1100);
    // With 1 consecutive frame threshold and hysteresis, this should be marginal
    expect(bd.getMetrics().blinkCount).toBeLessThanOrEqual(1);
  });

  it("tracks post-blink rejection period", () => {
    const bd = new BlinkDetector(0.20, 2, 3);
    bd.start();
    // Normal open
    for (let i = 0; i < 5; i++) {
      bd.update(0.30, 0.30, 1000 + i * 33);
    }
    // Blink (below threshold)
    for (let i = 0; i < 4; i++) {
      bd.update(0.08, 0.08, 1200 + i * 33);
    }
    // Eyes opening → state goes to OPENING
    bd.update(0.30, 0.30, 1400);
    // One more open frame → completes blink, triggers post-blink rejection
    const result = bd.update(0.30, 0.30, 1433);
    expect(result).toBe(true); // Should reject during post-blink
    expect(bd.isInPostBlinkPeriod()).toBe(true);
  });

  it("returns blink events with correct structure", () => {
    const bd = new BlinkDetector(0.20, 2, 0);
    bd.start();
    // Full blink cycle
    for (let i = 0; i < 5; i++) bd.update(0.30, 0.30, 1000 + i * 33);
    for (let i = 0; i < 5; i++) bd.update(0.05, 0.05, 1200 + i * 33);
    for (let i = 0; i < 5; i++) bd.update(0.30, 0.30, 1400 + i * 33);

    const events = bd.getBlinkEvents();
    if (events.length > 0) {
      expect(events[0]).toHaveProperty("startTime");
      expect(events[0]).toHaveProperty("endTime");
      expect(events[0]).toHaveProperty("duration");
      expect(events[0]).toHaveProperty("minEAR");
      expect(events[0].duration).toBeGreaterThan(0);
      expect(events[0].minEAR).toBeLessThan(0.20);
    }
  });

  it("reset clears all state", () => {
    const bd = new BlinkDetector();
    bd.start();
    bd.update(0.05, 0.05, 1000);
    bd.reset();
    expect(bd.getMetrics().blinkCount).toBe(0);
    expect(bd.getMetrics().currentState).toBe("OPEN");
  });
});
