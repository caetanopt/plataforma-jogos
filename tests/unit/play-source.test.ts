import { describe, expect, it } from "vitest";
import { referrerSource } from "@/features/play/source";
import { isDeadlock } from "@/lib/db/transaction-retry";

describe("origem de uma participação", () => {
  it("guarda só o endereço do site de onde veio", () => {
    expect(referrerSource("https://www.Google.com/search?q=ana%40example.pt")).toBe("www.google.com");
    expect(referrerSource("http://news.example:8080/abrir?subscriber=123#topo")).toBe("news.example:8080");
    expect(referrerSource("android-app://com.example")).toBeUndefined();
    expect(referrerSource("não é um endereço")).toBeUndefined();
    expect(referrerSource("")).toBeUndefined();
    expect(referrerSource(undefined)).toBeUndefined();
  });
});

describe("deteção de deadlock", () => {
  it("reconhece o 40P01 nas formas em que o driver o reporta", () => {
    expect(isDeadlock(new Error("Raw query failed. Code: `40P01`. Message: `deadlock detected`"))).toBe(true);
    expect(isDeadlock(Object.assign(new Error("x"), { cause: { originalCode: "40P01" } }))).toBe(true);
    expect(isDeadlock(new Error("unique constraint"))).toBe(false);
    expect(isDeadlock("40P01")).toBe(false);
  });
});
