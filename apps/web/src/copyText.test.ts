import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { copyText } from "./copyText";

describe("REQ_ui__copy_text", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies via navigator.clipboard", async () => {
    const ok = await copyText("TempPass1!");
    expect(ok).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("TempPass1!");
  });
});
