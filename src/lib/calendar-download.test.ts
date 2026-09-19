import { describe, expect, it } from "vitest";
import { buildCalendarFile } from "./calendar-download";

const trip = {
  id: "test",
  name: "A, B; C\\D\nNew line",
  notes: "🌴".repeat(50),
  duration: 3,
  confirmedDate: "2026-12-31",
  confirmedAt: "2026-09-12T12:00:00Z",
  confirmationVersion: 2,
  timeZone: "America/New_York",
};
describe("calendar download", () => {
  it("uses inclusive trip days with an exclusive calendar end across years", () => {
    const result = buildCalendarFile(trip);
    expect(result).toContain(
      "DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270103",
    );
    expect(result).toContain("SUMMARY:A\\, B\\; C\\\\D\\nNew line");
    expect(result).toContain("SEQUENCE:2");
    expect(result).not.toMatch(/(?<!\r)\n/);
    for (const line of result.split("\r\n"))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(result.replace(/\r\n /g, "")).toContain("🌴".repeat(50));
    expect(result).not.toContain("ATTENDEE");
  });
  it("converts custom times across daylight saving time", () => {
    const result = buildCalendarFile({
      ...trip,
      duration: 2,
      confirmedDate: "2026-10-31",
      departureTime: "18:00",
      returnTime: "18:00",
    });
    expect(result).toContain("DTSTART:20261031T220000Z");
    expect(result).toContain("DTEND:20261101T230000Z");
  });
});
