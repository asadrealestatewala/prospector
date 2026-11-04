import { describe, expect, it } from "vitest";
import { csvCell, dncRowsFromCsv, parseCsv } from "./csv";

describe("csv", () => {
  it("escapes cells and stops formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+923001234567")).toBe("'+923001234567");
  });
  it("parses quotes, semicolons and Windows line ends", () => {
    expect(parseCsv('a,"b, c",d\r\n"x ""y""",2,3\r\n')).toEqual([["a", "b, c", "d"], ['x "y"', "2", "3"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("reads do-not-contact imports with and without a header", () => {
    expect(dncRowsFromCsv("Email,Reason,Note\ninfo@a.pk,Replied stop,asked twice\n,,\nb@b.pk,,")).toEqual([
      { value: "info@a.pk", channel: undefined, reason: "replied_stop", note: "asked twice" },
      { value: "b@b.pk", channel: undefined, reason: undefined, note: undefined },
    ]);
    expect(dncRowsFromCsv("0300 1234567\n'+92 321 1112223").map((r) => r.value)).toEqual(["0300 1234567", "+92 321 1112223"]);
    expect(dncRowsFromCsv("WhatsApp\n03001234567")[0]).toMatchObject({ value: "03001234567", channel: "whatsapp" });
  });
});
