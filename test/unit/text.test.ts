import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContext,
  createWholeWordPattern,
  dedupeStrings,
  escapeRegExp,
  normalizeDictionaryWord,
  preserveReplacementCase,
  stripDiacritics
} from "../../src/core/text.ts";

test("escapeRegExp escapa metacaracteres", () => {
  assert.equal(escapeRegExp("a+b?c.*"), "a\\+b\\?c\\.\\*");
});

test("createWholeWordPattern respeita fronteiras de palavra", () => {
  const pattern = createWholeWordPattern("site");
  assert.equal("o site oficial".match(pattern)?.[0], "site");
  assert.equal("website corporativo".match(pattern), null);
});

test("preserveReplacementCase respeita caixa original", () => {
  assert.equal(preserveReplacementCase("SERVICO", "serviço"), "SERVIÇO");
  assert.equal(preserveReplacementCase("Servico", "serviço"), "Serviço");
  assert.equal(preserveReplacementCase("servico", "serviço"), "serviço");
});

test("buildContext recorta contexto sem sair dos limites", () => {
  const text = "Um texto curto para validar contexto.";
  const context = buildContext(text, 3, 5);
  assert.equal(context.length, 5);
  assert.equal(context.offset, 3);
  assert.ok(context.text.includes("texto curto"));
});

test("dedupeStrings remove vazios e duplicados", () => {
  assert.deepEqual(dedupeStrings(["a", "", "b", "a"]), ["a", "b"]);
});

test("normalizeDictionaryWord normaliza e reduz para minusculas", () => {
  assert.equal(normalizeDictionaryWord("  AÇÃO  "), "ação");
});

test("stripDiacritics remove acentos", () => {
  assert.equal(stripDiacritics("ação útil"), "acao util");
});
