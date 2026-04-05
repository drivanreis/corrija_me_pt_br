import fs from "node:fs/promises";
import path from "node:path";

const CURATED_PATH = "data/test-cases/curated.json";
const KNOW_PATH = "data/test-cases/curated-know.json";
const PROOF_PATH = "data/test-cases/curated-proof.json";
const REPORT_PATH = "data/test-cases/curated-partitions-report.json";

const TAG_FAMILY_RULES = [
  { family: "phenomenon:acentuacao", patterns: [/acent/, /til/, /circunflex/, /agud/, /grave/, /hiato/] },
  { family: "phenomenon:crase", patterns: [/crase/, /^a$/, /a_ha/, /a\/há/, /a_fim/, /a_cerca_de/] },
  { family: "phenomenon:hifen", patterns: [/hifen/, /hífen/, /prefix/, /segunda_feira/, /recem/, /pos /, /pós/] },
  { family: "phenomenon:pontuacao", patterns: [/pontua/, /virg/, /vírg/, /interroga/, /exclama/, /dois-pontos/, /travess/, /aposto/, /aspas/, /par[eê]ntes/] },
  { family: "phenomenon:concordancia_verbal", patterns: [/concordancia verbal/, /concordância verbal/, /verbal/, /sujeito plural/, /verbo/] },
  { family: "phenomenon:concordancia_nominal", patterns: [/concordancia nominal/, /concordância nominal/, /adjetiv/, /substantiv/, /adjunto/] },
  { family: "phenomenon:regencia", patterns: [/regencia/, /regência/, /preposic/, /preposição/] },
  { family: "phenomenon:colocacao_pronominal", patterns: [/pronome/, /pronominal/, /ênclise/, /enclise/, /próclise/, /proclise/, /mesoclise/] },
  { family: "phenomenon:homofonos", patterns: [/hom[oô]n/, /hom[oô]f/, /sess[aã]o/, /concerto/, /acerca/, /afim/] },
  { family: "phenomenon:ortografia", patterns: [/ortograf/, /grafia/, /escrita/, /abrevia/, /mai[úu]sc/, /min[úu]sc/] },
  { family: "phenomenon:anuncios", patterns: [/an[úu]ncio/, /venda/, /aluga/, /vende-se/, /vendem-se/] },
  { family: "phenomenon:texto_tecnico", patterns: [/tecnic/, /t[ée]cnico/, /arquivo/, /api/, /endpoint/, /par[aâ]metro/, /json/, /sigla/] },
  { family: "phenomenon:tempo_data_horario", patterns: [/hora/, /hor[áa]rio/, /data/, /dias da semana/, /segunda/, /ontem/, /amanh/] },
  { family: "phenomenon:numero_moeda", patterns: [/moeda/, /r\$/, /valor/, /n[uú]mero/, /quantidade/] }
];

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function stripDiacritics(value) {
  return normalizeWhitespace(value).normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function normalizeKey(value) {
  return stripDiacritics(value).toLowerCase();
}

function tokenizeWithOffsets(text) {
  const tokens = [];
  const pattern = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
  for (const match of normalizeWhitespace(text).matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    tokens.push({ text: token, start, end: start + token.length });
  }
  return tokens;
}

function buildTokenDiffGroups(sourceTokens, targetTokens) {
  const rows = sourceTokens.length + 1;
  const cols = targetTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    dp[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    dp[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (sourceTokens[row - 1]?.text === targetTokens[col - 1]?.text) {
        dp[row][col] = dp[row - 1][col - 1];
      } else {
        dp[row][col] = Math.min(
          dp[row - 1][col] + 1,
          dp[row][col - 1] + 1,
          dp[row - 1][col - 1] + 1
        );
      }
    }
  }

  const operations = [];
  let row = sourceTokens.length;
  let col = targetTokens.length;

  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && sourceTokens[row - 1]?.text === targetTokens[col - 1]?.text) {
      operations.push({ type: "equal", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
      continue;
    }

    const replaceCost = row > 0 && col > 0 ? dp[row - 1][col - 1] : Number.POSITIVE_INFINITY;
    const deleteCost = row > 0 ? dp[row - 1][col] : Number.POSITIVE_INFINITY;
    const currentCost = dp[row][col];

    if (row > 0 && col > 0 && currentCost === replaceCost + 1) {
      operations.push({ type: "replace", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
    } else if (row > 0 && currentCost === deleteCost + 1) {
      operations.push({ type: "delete", srcIndex: row - 1 });
      row -= 1;
    } else {
      operations.push({ type: "insert", tgtIndex: col - 1 });
      col -= 1;
    }
  }

  operations.reverse();

  const groups = [];
  let current = null;
  let sourceCursor = 0;

  function closeGroup() {
    if (!current) {
      return;
    }

    const slice = sourceTokens.slice(current.srcStartToken, current.srcEndToken);
    const srcCharStart = slice[0]?.start ?? 0;
    const srcCharEnd = slice[slice.length - 1]?.end ?? srcCharStart;
    groups.push({
      srcText: current.srcTexts.join(" ").trim(),
      tgtText: current.tgtTexts.join(" ").trim(),
      srcCharStart,
      srcCharEnd
    });
    current = null;
  }

  operations.forEach((operation) => {
    if (operation.type === "equal") {
      closeGroup();
      sourceCursor += 1;
      return;
    }

    if (operation.type === "replace") {
      closeGroup();
    }

    if (!current) {
      current = {
        srcStartToken: sourceCursor,
        srcEndToken: sourceCursor,
        srcTexts: [],
        tgtTexts: []
      };
    }

    if (operation.type === "replace") {
      current.srcTexts.push(sourceTokens[operation.srcIndex ?? 0]?.text || "");
      current.tgtTexts.push(targetTokens[operation.tgtIndex ?? 0]?.text || "");
      sourceCursor += 1;
      current.srcEndToken = sourceCursor;
      closeGroup();
      return;
    }

    if (operation.type === "delete") {
      current.srcTexts.push(sourceTokens[operation.srcIndex ?? 0]?.text || "");
      sourceCursor += 1;
    } else {
      current.tgtTexts.push(targetTokens[operation.tgtIndex ?? 0]?.text || "");
    }

    current.srcEndToken = sourceCursor;
  });

  closeGroup();
  return groups.filter((group) => group.srcText && group.tgtText && group.srcCharEnd > group.srcCharStart);
}

function inferTagFamilies(tags, category) {
  const familyKeys = new Set([`category:${normalizeKey(category)}`]);
  const phenomenonKeys = new Set();

  for (const rawTag of tags) {
    const tag = normalizeWhitespace(rawTag);
    const normalizedTag = normalizeKey(tag);
    if (!normalizedTag) {
      continue;
    }

    for (const rule of TAG_FAMILY_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(normalizedTag))) {
        familyKeys.add(rule.family);
        phenomenonKeys.add(rule.family.replace(/^phenomenon:/u, ""));
      }
    }
  }

  if (!phenomenonKeys.size) {
    phenomenonKeys.add(normalizeKey(category));
    familyKeys.add(`phenomenon:${normalizeKey(category)}`);
  }

  return {
    familyKeys,
    phenomena: [...phenomenonKeys].sort()
  };
}

function inferDiffFamilies(errado, correto, category) {
  const groups = buildTokenDiffGroups(tokenizeWithOffsets(errado), tokenizeWithOffsets(correto));
  const familyKeys = new Set();
  const pairKeys = [];
  const normalizedCategory = normalizeKey(category);

  for (const group of groups) {
    const src = normalizeWhitespace(group.srcText);
    const tgt = normalizeWhitespace(group.tgtText);
    const srcKey = normalizeKey(src);
    const tgtKey = normalizeKey(tgt);
    const srcPlain = stripDiacritics(src).toLowerCase();
    const tgtPlain = stripDiacritics(tgt).toLowerCase();
    const srcTokenCount = tokenizeWithOffsets(src).length;
    const tgtTokenCount = tokenizeWithOffsets(tgt).length;

    if (!srcKey || !tgtKey) {
      continue;
    }

    if (srcPlain === tgtPlain && srcKey !== tgtKey) {
      familyKeys.add("phenomenon:acentuacao");
    }

    if (srcPlain.replace(/[-\s]/g, "") === tgtPlain.replace(/[-\s]/g, "") && srcKey !== tgtKey) {
      familyKeys.add(src.includes("-") || tgt.includes("-") ? "phenomenon:hifen" : "phenomenon:tokenizacao");
    }

    if (/\bpor que\b/iu.test(src) && /\bporque\b/iu.test(tgt)) {
      familyKeys.add("phenomenon:conjuncao_por_que");
    }

    if (/^\p{L}+\s+\p{L}+$/u.test(src) && /^\p{L}+-\p{L}+$/u.test(tgt)) {
      familyKeys.add("phenomenon:colocacao_pronominal");
    }

    if (/[?!.;,:"“”()-]/u.test(src) || /[?!.;,:"“”()-]/u.test(tgt)) {
      familyKeys.add("phenomenon:pontuacao");
    }

    if (/\b[àa]\b/iu.test(tgt) || /\bàs\b/iu.test(tgt)) {
      familyKeys.add("phenomenon:crase");
    }

    const shouldTrackSpecificPair = (
      srcKey !== tgtKey
      && srcKey.length <= 18
      && tgtKey.length <= 18
      && srcTokenCount <= 2
      && tgtTokenCount <= 2
      && (
        normalizedCategory === "homofonos"
        || normalizedCategory === "contexto"
        || srcPlain === tgtPlain
        || familyKeys.has("phenomenon:colocacao_pronominal")
        || familyKeys.has("phenomenon:conjuncao_por_que")
        || familyKeys.has("phenomenon:crase")
      )
    );

    if (shouldTrackSpecificPair) {
      const pairKey = `diff:${srcKey}=>${tgtKey}`;
      familyKeys.add(pairKey);
      pairKeys.push(pairKey);
    }
  }

  if (!familyKeys.size) {
    familyKeys.add(`phenomenon:${normalizeKey(category)}`);
  }

  return {
    familyKeys,
    pairKeys: [...new Set(pairKeys)].sort()
  };
}

function enrichCase(item) {
  const errado = normalizeWhitespace(item.errado);
  const correto = normalizeWhitespace(item.correto);
  const category = normalizeWhitespace(item.category);
  const tags = Array.isArray(item.tags) ? item.tags.map((entry) => normalizeWhitespace(entry)).filter(Boolean) : [];
  const { familyKeys: tagFamilyKeys, phenomena } = inferTagFamilies(tags, category);
  const { familyKeys: diffFamilyKeys, pairKeys } = inferDiffFamilies(errado, correto, category);
  const familyKeys = new Set([
    `difficulty:${Number(item.difficulty) || 0}`,
    `error_count:${Number(item.error_count) || 0}`,
    ...tagFamilyKeys,
    ...diffFamilyKeys
  ]);
  const orderedFamilies = [...familyKeys].sort();
  const specificFamily = orderedFamilies.find((entry) => entry.startsWith("diff:"))
    || orderedFamilies.find((entry) => entry.startsWith("phenomenon:"))
    || orderedFamilies[0]
    || "family:unknown";

  return {
    ...item,
    partition_metadata: {
      primary_family: specificFamily,
      family_keys: orderedFamilies,
      phenomena,
      diff_pairs: pairKeys
    }
  };
}

function chooseProofCases(enrichedCases) {
  const remaining = [...enrichedCases];
  const uncovered = new Set(enrichedCases.flatMap((item) => item.partition_metadata.family_keys));
  const proof = [];

  while (remaining.length && uncovered.size) {
    let bestIndex = -1;
    let bestScore = -1;

    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const uncoveredCoverage = item.partition_metadata.family_keys.filter((key) => uncovered.has(key)).length;
      const score = uncoveredCoverage * 1000 + (Number(item.error_count) || 0) * 10 + (Number(item.difficulty) || 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex === -1 || bestScore <= 0) {
      break;
    }

    const [selected] = remaining.splice(bestIndex, 1);
    proof.push(selected);
    selected.partition_metadata.family_keys.forEach((key) => uncovered.delete(key));
  }

  const proofSet = new Set(proof.map((item) => item.id));
  const pruned = [...proof].sort((left, right) => (
    left.partition_metadata.family_keys.length - right.partition_metadata.family_keys.length
    || (Number(left.error_count) || 0) - (Number(right.error_count) || 0)
  ));
  const retained = new Map(proof.map((item) => [item.id, item]));

  for (const candidate of pruned) {
    const others = [...retained.values()].filter((item) => item.id !== candidate.id);
    const coveredByOthers = candidate.partition_metadata.family_keys.every((key) => (
      others.some((item) => item.partition_metadata.family_keys.includes(key))
    ));

    if (coveredByOthers) {
      retained.delete(candidate.id);
      proofSet.delete(candidate.id);
    }
  }

  const finalProof = enrichedCases.filter((item) => proofSet.has(item.id));
  const know = enrichedCases.filter((item) => !proofSet.has(item.id));
  return { proof: finalProof, know };
}

function buildCoverageSummary(items) {
  const counts = new Map();
  for (const item of items) {
    for (const key of item.partition_metadata.family_keys) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family, "pt-BR"));
}

async function readJsonArray(filePath) {
  const content = await fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeJson(filePath, payload) {
  await fs.writeFile(path.resolve(process.cwd(), filePath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const curated = await readJsonArray(CURATED_PATH);
  const enrichedCases = curated.map(enrichCase);
  const { proof, know } = chooseProofCases(enrichedCases);

  const allFamilies = new Set(enrichedCases.flatMap((item) => item.partition_metadata.family_keys));
  const proofFamilies = new Set(proof.flatMap((item) => item.partition_metadata.family_keys));
  const knowFamilies = new Set(know.flatMap((item) => item.partition_metadata.family_keys));
  const uncoveredFamilies = [...allFamilies].filter((key) => !proofFamilies.has(key)).sort();

  const report = {
    generated_at: new Date().toISOString(),
    curated_total: enrichedCases.length,
    know_total: know.length,
    proof_total: proof.length,
    proof_ratio: enrichedCases.length ? Number((proof.length / enrichedCases.length).toFixed(4)) : 0,
    total_family_keys: allFamilies.size,
    proof_family_keys: proofFamilies.size,
    know_family_keys: knowFamilies.size,
    uncovered_families_in_proof: uncoveredFamilies,
    coverage_ok: uncoveredFamilies.length === 0,
    proof_coverage_by_family: buildCoverageSummary(proof),
    know_coverage_by_family: buildCoverageSummary(know)
  };

  await Promise.all([
    writeJson(KNOW_PATH, know),
    writeJson(PROOF_PATH, proof),
    writeJson(REPORT_PATH, report)
  ]);

  console.log(`Curated total: ${enrichedCases.length}`);
  console.log(`Curated know: ${know.length}`);
  console.log(`Curated proof: ${proof.length}`);
  console.log(`Famílias cobertas no proof: ${proofFamilies.size}/${allFamilies.size}`);
  console.log(`Relatório: ${path.resolve(process.cwd(), REPORT_PATH)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
