import { describe, expect, it } from "vitest";
import { problemeCleIa } from "@/scan/ia";

describe("clé Anthropic", () => {
  it("détecte une clé absente ou collée masquée", () => {
    expect(problemeCleIa("")).toMatch(/manquante/);
    expect(problemeCleIa("sk-ant-a•••••")).toMatch(/caractères masqués/);
    expect(problemeCleIa("sk-ant api")).toMatch(/invalide/);
  });
  it("accepte une clé normale, même avec un retour à la ligne final", () => {
    expect(problemeCleIa("sk-ant-api03-AbC_dEf-123\n")).toBeNull();
  });
});
