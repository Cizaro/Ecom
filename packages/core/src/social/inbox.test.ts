import { describe, expect, it } from "vitest";
import { interpretSocialEvent } from "./inbox";

const own = { pageId: "100000000000001", instagramAccountId: "17800000000000001" };

describe("interpretSocialEvent", () => {
  it("reads an Instagram direct message into a thread per person", () => {
    const parsed = interpretSocialEvent(
      {
        channel: "instagram",
        kind: "message",
        payload: {
          sender: { id: "5551234" },
          recipient: { id: own.instagramAccountId },
          message: { mid: "aWdfZAG1", text: "  Do you deliver to Beirut?  " },
        },
      },
      own,
    );
    expect(parsed).toEqual({
      threadKey: "instagram:dm:5551234",
      kind: "message",
      externalId: "instagram:message:aWdfZAG1",
      userId: "5551234",
      username: null,
      replyToId: null,
      body: "Do you deliver to Beirut?",
    });
  });

  it("skips the shop's own messages and echoes", () => {
    const echo = {
      channel: "instagram",
      kind: "message",
      payload: { sender: { id: "5551234" }, message: { mid: "m1", text: "Hi", is_echo: true } },
    };
    expect(interpretSocialEvent(echo, own)).toBeNull();
    const fromShop = {
      channel: "instagram",
      kind: "message",
      payload: { sender: { id: own.instagramAccountId }, message: { mid: "m2", text: "Hi" } },
    };
    expect(interpretSocialEvent(fromShop, own)).toBeNull();
  });

  it("says a message without text has an attachment", () => {
    const parsed = interpretSocialEvent(
      {
        channel: "facebook",
        kind: "message",
        payload: { sender: { id: "77" }, message: { mid: "m3", attachments: [{ type: "image" }] } },
      },
      own,
    );
    expect(parsed?.body).toMatch(/photo, video or attachment/);
    expect(parsed?.threadKey).toBe("facebook:dm:77");
  });

  it("keeps an Instagram comment and its replies in one thread", () => {
    const top = interpretSocialEvent(
      {
        channel: "instagram",
        kind: "comment",
        payload: {
          field: "comments",
          value: { id: "1799", text: "Price?", from: { id: "42", username: "lina.b" } },
        },
      },
      own,
    );
    expect(top).toMatchObject({
      threadKey: "instagram:comment:1799",
      replyToId: "1799",
      username: "lina.b",
    });
    const reply = interpretSocialEvent(
      {
        channel: "instagram",
        kind: "comment",
        payload: {
          field: "comments",
          value: { id: "1800", parent_id: "1799", text: "Still there?", from: { id: "42" } },
        },
      },
      own,
    );
    expect(reply?.threadKey).toBe("instagram:comment:1799");
  });

  it("reads new Facebook Page comments only, never the Page's own", () => {
    const comment = (value: Record<string, unknown>) =>
      interpretSocialEvent(
        { channel: "facebook", kind: "comment", payload: { field: "feed", value } },
        own,
      );
    expect(
      comment({
        item: "comment",
        verb: "add",
        comment_id: "123_456",
        post_id: "123_1",
        parent_id: "123_1",
        message: "Nice bag",
        from: { id: "9", name: "Rami K" },
      }),
    ).toMatchObject({ threadKey: "facebook:comment:123_456", username: "Rami K" });
    expect(comment({ item: "comment", verb: "edited", comment_id: "123_456" })).toBeNull();
    expect(
      comment({ item: "comment", verb: "add", comment_id: "123_457", from: { id: own.pageId } }),
    ).toBeNull();
  });

  it("ignores anything else", () => {
    expect(
      interpretSocialEvent({ channel: "instagram", kind: "other", payload: { x: 1 } }, own),
    ).toBeNull();
    expect(
      interpretSocialEvent({ channel: "instagram", kind: "message", payload: null }, own),
    ).toBeNull();
  });
});
