import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

describe("createLogger", () => {
  it("redacts sensitive fields at the top level and when nested", () => {
    const sink = capture();
    const logger = createLogger("test", "info", sink);

    logger.info({
      password: "hunter2",
      user: { password: "hunter2", email: "a@example.com" },
      headers: { authorization: "Bearer abc" },
      request: { headers: { cookie: "session=abc" } },
    });

    const output = sink.lines.join("");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("Bearer abc");
    expect(output).not.toContain("session=abc");
    expect(output).toContain("[redacted]");
    expect(output).toContain("a@example.com");
  });

  it("writes JSON with the given name and respects the level", () => {
    const sink = capture();
    const logger = createLogger("worker", "warn", sink);

    logger.info("ignored");
    logger.warn("kept");

    expect(sink.lines).toHaveLength(1);
    expect(JSON.parse(sink.lines[0]!)).toMatchObject({ name: "worker", msg: "kept" });
  });
});
