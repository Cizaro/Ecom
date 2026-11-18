import { describe, expect, it } from "vitest";
import { missingEnvLines } from "./sync.mjs";

describe("pnpm sync: new settings", () => {
  it("lists the example's keys that .env lacks, with their example values", () => {
    const example = [
      "# comment",
      "DATABASE_URL=postgres://example",
      "AI_PAUSED=false",
      "",
      "GROQ_API_KEY=",
    ].join("\n");
    const env = "DATABASE_URL=postgres://mine\r\nAI_PAUSED=true\r\n";
    expect(missingEnvLines(example, env)).toEqual(["GROQ_API_KEY="]);
  });

  it("never touches keys .env already has, even when commented differently", () => {
    expect(missingEnvLines("A=1\nB=2", "B=9\nA=8")).toEqual([]);
  });
});
