import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("ignore les valeurs falsy et garde la dernière classe Tailwind en conflit", () => {
    expect(cn("px-2 text-sm", false && "hidden", null, "px-4")).toBe("text-sm px-4");
  });
});
