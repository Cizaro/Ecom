import { describe, expect, it } from "vitest";
import { redisConnectionOptions } from "./redis";

describe("redisConnectionOptions", () => {
  it("parses host and port", () => {
    expect(redisConnectionOptions("redis://localhost:6380")).toEqual({
      host: "localhost",
      port: 6380,
    });
  });

  it("defaults the port", () => {
    expect(redisConnectionOptions("redis://cache").port).toBe(6379);
  });

  it("parses credentials, database index and TLS", () => {
    expect(redisConnectionOptions("rediss://user:p%40ss@cache.example.com:6379/2")).toEqual({
      host: "cache.example.com",
      port: 6379,
      username: "user",
      password: "p@ss",
      db: 2,
      tls: {},
    });
  });
});
