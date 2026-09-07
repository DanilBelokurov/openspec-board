import { describe, expect, it } from "vitest";
import { parseRawLabels } from "../prompts";

describe("parseRawLabels", () => {
  it("returns label=value for entries without a colon", () => {
    expect(parseRawLabels(["solo"])).toEqual([{ display: "solo", value: "solo" }]);
  });

  it("splits on the first colon", () => {
    expect(parseRawLabels(["Display:value:with-colons"])).toEqual([
      { display: "Display", value: "value:with-colons" },
    ]);
  });

  it("handles multiple entries with mixed shapes", () => {
    expect(
      parseRawLabels([
        "Аналитик/разработчик:analyst-developer",
        "Эксперт УЭК:uek-expert",
      ]),
    ).toEqual([
      { display: "Аналитик/разработчик", value: "analyst-developer" },
      { display: "Эксперт УЭК", value: "uek-expert" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseRawLabels([])).toEqual([]);
  });
});