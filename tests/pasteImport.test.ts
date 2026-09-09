import { describe, it, expect } from "vitest";
import { parsePastedChat } from "@/lib/pasteImport";

describe("parsePastedChat", () => {
  it("pairs a venue name with the map link shared in the same message", () => {
    const text = [
      "[8/22/2026 1:26 PM] Nazanin Rezaee: Marina palace",
      "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96",
    ].join("\n");
    expect(parsePastedChat(text)).toEqual([
      { name: "Marina palace", mapsUrl: "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96" },
    ]);
  });

  it("skips chatter messages that carry no map link", () => {
    const text = [
      "[8/22/2026 1:26 PM] Nazanin Rezaee: talare erfan",
      "https://maps.app.goo.gl/VLebKgNL1uLSse3Z8",
      "[8/22/2026 1:26 PM] Nazanin Rezaee: تالار تشریفاتی عرفان",
      "لیست قیمت ارسال شده",
    ].join("\n");
    expect(parsePastedChat(text)).toEqual([
      { name: "talare erfan", mapsUrl: "https://maps.app.goo.gl/VLebKgNL1uLSse3Z8" },
    ]);
  });

  it("skips a multi-line unrelated block (price grid) with no link", () => {
    const text = [
      "[8/22/2026 1:27 PM] Nazanin Rezaee: آقای نظری مسئول خریده",
      "کره نیوزیلند میخواد",
      "",
      "گریدa:",
      "۱۵/۵۰۰/۰۰۰",
      "[8/22/2026 1:28 PM] Nazanin Rezaee: باغ تالار کلاسیک",
      "https://maps.app.goo.gl/rivCedWdpG6TPg5g9",
    ].join("\n");
    expect(parsePastedChat(text)).toEqual([
      { name: "باغ تالار کلاسیک", mapsUrl: "https://maps.app.goo.gl/rivCedWdpG6TPg5g9" },
    ]);
  });

  it("dedupes a link that appears twice", () => {
    const text = [
      "[8/22/2026 1:26 PM] Nazanin Rezaee: Marina palace",
      "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96",
      "[8/22/2026 1:30 PM] Nazanin Rezaee: (forwarded again) Marina palace",
      "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96",
    ].join("\n");
    expect(parsePastedChat(text)).toHaveLength(1);
  });

  it("falls back to the previous message's text for a link sent bare in its own message", () => {
    const text = [
      "[8/22/2026 1:26 PM] Nazanin Rezaee: Sadaf Hall",
      "[8/22/2026 1:26 PM] Nazanin Rezaee: https://maps.app.goo.gl/hiDMigc2r33kUn2w7",
    ].join("\n");
    expect(parsePastedChat(text)).toEqual([
      { name: "Sadaf Hall", mapsUrl: "https://maps.app.goo.gl/hiDMigc2r33kUn2w7" },
    ]);
  });

  it("tolerates a plain name-then-link paste with no chat header at all", () => {
    const text = "Dariush Hall\nhttps://maps.app.goo.gl/QP2wwuS1crijjQDu9";
    expect(parsePastedChat(text)).toEqual([
      { name: "Dariush Hall", mapsUrl: "https://maps.app.goo.gl/QP2wwuS1crijjQDu9" },
    ]);
  });

  it("keeps every link of a bare list pasted with no names at all", () => {
    // The shape that used to collapse into one location whose "name" was the other 24 links.
    const links = [
      "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96",
      "https://maps.app.goo.gl/VLebKgNL1uLSse3Z8",
      "https://maps.app.goo.gl/wd4RdPVJdY6p4bSj8",
    ];
    expect(parsePastedChat(links.join("\n"))).toEqual(links.map((mapsUrl) => ({ name: "", mapsUrl })));
  });

  it("pairs each link with its own name in a headerless name/link list", () => {
    const text = [
      "Marina palace",
      "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96",
      "talare erfan",
      "https://maps.app.goo.gl/VLebKgNL1uLSse3Z8",
    ].join("\n");
    expect(parsePastedChat(text)).toEqual([
      { name: "Marina palace", mapsUrl: "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96" },
      { name: "talare erfan", mapsUrl: "https://maps.app.goo.gl/VLebKgNL1uLSse3Z8" },
    ]);
  });

  it("keeps both links when one message carries two of them", () => {
    const text =
      "[8/22/2026 1:26 PM] Nazanin Rezaee: دو تا تالار https://maps.app.goo.gl/kt9VH4nCrXUfKkm96 و https://maps.app.goo.gl/VLebKgNL1uLSse3Z8";
    expect(parsePastedChat(text)).toEqual([
      { name: "دو تا تالار و", mapsUrl: "https://maps.app.goo.gl/kt9VH4nCrXUfKkm96" },
      { name: "دو تا تالار و", mapsUrl: "https://maps.app.goo.gl/VLebKgNL1uLSse3Z8" },
    ]);
  });

  it("drops sentence punctuation the link pattern swallowed", () => {
    const text = "[8/22/2026 1:26 PM] Nazanin Rezaee: Marina palace (https://maps.app.goo.gl/kt9VH4nCrXUfKkm96).";
    expect(parsePastedChat(text)[0].mapsUrl).toBe("https://maps.app.goo.gl/kt9VH4nCrXUfKkm96");
  });

  it("returns an empty array for text with no map links", () => {
    expect(parsePastedChat("[8/22/2026 1:26 PM] Nazanin Rezaee: just chatting, no links here")).toEqual([]);
  });

  it("parses the user's exact paste", () => {
    const text = `[9/4/2026 3:54 PM] M.s parsa: تهران کباب شعبه پیروزی
https://maps.app.goo.gl/2uC6TXV5e7Y8n3qSA
[9/4/2026 3:54 PM] M.s parsa: کباب حلیم پیروزی 
https://maps.app.goo.gl/PLyWGAXbrUKK7nih6
[9/4/2026 3:54 PM] M.s parsa: کباب خوب ذغالی پیروزی 
https://maps.app.goo.gl/hp89fHAbeAHfNS8V7
[9/4/2026 3:54 PM] M.s parsa: کبابخانه محفل
https://maps.app.goo.gl/ZN8ZgSZQbCbExmYf9
[9/4/2026 3:54 PM] M.s parsa: کباب گلپایگانی اعتماد 
https://maps.app.goo.gl/oYakW3oLxkJJu2XL9
[9/4/2026 3:54 PM] M.s parsa: رستوران کباب بازاری 
https://maps.app.goo.gl/fN9u6Jj5Ei6ToCee8
[9/4/2026 3:54 PM] M.s parsa: رستوران ایرانی عربی شاهپسند 
https://maps.app.goo.gl/9NUW4MEr8rNKAknRA`;

    const res = parsePastedChat(text);
    console.log("TEST RESULT:", JSON.stringify(res, null, 2));
    expect(res).toHaveLength(7);
  });
});
