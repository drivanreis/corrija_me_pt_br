import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { GoogleGenAI } from "@google/genai";

const DEFAULT_AUDIT = "data/test-cases/latest-audit.json";
const DEFAULT_OUTPUT = "data/rules/proof-improvement-candidates.json";
const TOKEN_PATTERN = /(?<![\p{L}\p{N}\p{M}])[\p{L}][\p{L}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;

function parseArgs(argv) {
  const args = {
    audit: DEFAULT_AUDIT,
    output: DEFAULT_OUTPUT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--audit" && next) {
      args.audit = next;
      index += 1;
    } else if (current === "--output" && next) {
      args.output = next;
      index += 1;
    }
  }

  return args;
}

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return normalizeWhitespace(value).toLocaleLowerCase("pt-BR");
}

function stripDiacritics(value) {
  return normalizeWhitespace(value).normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function tokenizeWords(text) {
  return [...normalizeWhitespace(text).matchAll(TOKEN_PATTERN)].map((match) => match[0]);
}

function findDiffWindow(sourceWords, targetWords) {
  let start = 0;
  while (
    start < sourceWords.length
    && start < targetWords.length
    && normalizeToken(sourceWords[start]) === normalizeToken(targetWords[start])
  ) {
    start += 1;
  }

  let sourceEnd = sourceWords.length - 1;
  let targetEnd = targetWords.length - 1;
  while (
    sourceEnd >= start
    && targetEnd >= start
    && normalizeToken(sourceWords[sourceEnd]) === normalizeToken(targetWords[targetEnd])
  ) {
    sourceEnd -= 1;
    targetEnd -= 1;
  }

  return {
    start,
    sourceSlice: sourceWords.slice(start, sourceEnd + 1),
    targetSlice: targetWords.slice(start, targetEnd + 1),
    leftContext: sourceWords.slice(Math.max(0, start - 2), start),
    rightContext: sourceWords.slice(sourceEnd + 1, Math.min(sourceWords.length, sourceEnd + 3))
  };
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function mergeByKey(current, next, keyFactory) {
  const byKey = new Map();

  for (const entry of [...current, ...next]) {
    const key = keyFactory(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()];
}

function collectFailedItems(audit) {
  const failed = [];

  for (const phase of audit.phases || []) {
    for (const item of phase.items || []) {
      if ((item.remaining_errors || 0) > 0 || (item.corrected_wrong_errors || 0) > 0 || (item.new_errors || 0) > 0) {
        failed.push({
          id: item.id,
          difficulty: item.difficulty,
          category: item.category,
          original: item.original,
          actual: item.extension_result,
          expected: item.expected,
          remaining: item.remaining_errors || 0,
          wrong: item.corrected_wrong_errors || 0,
          newErrors: item.new_errors || 0
        });
      }
    }
  }

  return failed.sort((left, right) => {
    const leftBurden = (left.remaining || 0) + (left.wrong || 0) + (left.newErrors || 0);
    const rightBurden = (right.remaining || 0) + (right.wrong || 0) + (right.newErrors || 0);
    return rightBurden - leftBurden || Number(right.difficulty || 0) - Number(left.difficulty || 0);
  });
}

async function getApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  try {
    const raw = (await readFile(path.resolve(process.cwd(), ".env"), "utf8")).trim();
    if (raw && !raw.includes("=")) {
      return raw;
    }
  } catch {
    return "";
  }

  return "";
}

function buildDeterministicCandidates(failedItems) {
  const replacements = [];
  const phraseRules = [];
  const contextRules = [];

  for (const item of failedItems.slice(0, 220)) {
    const original = normalizeWhitespace(item.original);
    const expected = normalizeWhitespace(item.expected);

    if (/cheguei no aeroporto/iu.test(original) && /cheguei ao aeroporto/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_CHEGUEI_NO`,
        pattern: ["cheguei", "no"],
        replacements: ["cheguei ao"],
        message: "Com 'chegar', a regência esperada aqui é 'ao'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/ir no cinema/iu.test(original) && /ir ao cinema/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_IR_NO_CINEMA`,
        pattern: ["ir", "no", "cinema"],
        replacements: ["ir ao cinema"],
        message: "Nesse contexto, a regência esperada é 'ao cinema'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/afim de/iu.test(original) && /a fim de/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_AFIM_DE`,
        pattern: ["afim", "de"],
        replacements: ["a fim de"],
        message: "Para indicar finalidade, a locução esperada é 'a fim de'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/assistir o novo filme/iu.test(original) && /assistir ao novo filme/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_ASSISTIR_FILME`,
        pattern: ["assistir", "o", "novo", "filme"],
        replacements: ["assistir ao novo filme"],
        message: "Com 'assistir' nesse uso, a regência esperada é 'ao'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/de encontro as? antigas/iu.test(original) && /ao encontro das? antigas/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_DE_ENCONTRO_ANTIGAS`,
        pattern: ["de", "encontro", "as", "antigas"],
        replacements: ["ao encontro das antigas"],
        message: "Nessa construção, a locução esperada é 'ao encontro de'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/ao encontro do que eu odeio/iu.test(original) && /de encontro ao que eu odeio/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_AO_ENCONTRO_ODEIO`,
        pattern: ["ao", "encontro", "do", "que", "eu", "odeio"].slice(0, 5),
        replacements: ["de encontro ao que eu odeio"],
        message: "Com ideia de choque ou oposição, a locução esperada é 'de encontro a'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/namora com/iu.test(original) && /namora a/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_NAMORA_COM`,
        pattern: ["namora", "com"],
        replacements: ["namora"],
        message: "Nesse uso, a forma esperada dispensa a preposição.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/sess[aã]o eleitoral/iu.test(original) && /sess[aã]o eleitoral/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SECAO_ELEITORAL`,
        pattern: ["seção", "eleitoral"],
        replacements: ["sessão eleitoral"],
        message: "No contexto de votação, a forma esperada é 'sessão'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/sess[aã]o do filme/iu.test(original) && /sess[aã]o do filme/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SECAO_DO_FILME`,
        pattern: ["seção", "do", "filme"],
        replacements: ["sessão do filme"],
        message: "No contexto de exibição, a forma esperada é 'sessão'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/sess[aã]o de cr[eé]dito/iu.test(original) && /cess[aã]o de cr[eé]dito/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SESSAO_CREDITO`,
        pattern: ["sessão", "de", "crédito"],
        replacements: ["cessão de crédito"],
        message: "No contexto financeiro, a forma esperada é 'cessão'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/se[cç][aã]o dos seus direitos autorais/iu.test(original) && /cess[aã]o dos seus direitos autorais/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SECAO_DIREITOS_AUTORAIS`,
        pattern: ["seção", "dos", "seus", "direitos", "autorais"],
        replacements: ["cessão dos seus direitos autorais"],
        message: "No contexto jurídico, a forma esperada é 'cessão'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/se[cç][aã]o de cinema/iu.test(original) && /sess[aã]o de cinema/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SECAO_CINEMA`,
        pattern: ["seção", "de", "cinema"],
        replacements: ["sessão de cinema"],
        message: "No contexto de exibição, a forma esperada é 'sessão'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/sess[aã]o de produtos org[aâ]nicos/iu.test(original) && /se[cç][aã]o de produtos org[aâ]nicos/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SESSAO_PRODUTOS`,
        pattern: ["sessão", "de", "produtos", "orgânicos"],
        replacements: ["seção de produtos orgânicos"],
        message: "No contexto de loja, a forma esperada é 'seção'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/se[cç][aã]o de desconto especial/iu.test(original) && /sess[aã]o de desconto especial/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SECAO_DESCONTO`,
        pattern: ["seção", "de", "desconto", "especial"],
        replacements: ["sessão de desconto especial"],
        message: "Nesse contexto promocional, a forma esperada é 'sessão'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/sess[aã]o de problemas/iu.test(original) && /se[cç][aã]o de problemas/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SESSAO_PROBLEMAS`,
        pattern: ["sessão", "de", "problemas"],
        replacements: ["seção de problemas"],
        message: "No contexto organizacional, a forma esperada é 'seção'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/porqu[eê] voc[eê]/iu.test(original) && /por que voc[eê]/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_PORQUE_VOCE`,
        pattern: ["porquê", "você"],
        replacements: ["por que você"],
        message: "Em pergunta direta ou indireta, a forma esperada aqui é 'por que'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_POR_QUE_ACENTO_VOCE`,
        pattern: ["por", "quê", "você"],
        replacements: ["por que você"],
        message: "Em pergunta direta ou indireta, a forma esperada aqui é 'por que'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/porque voc[eê] n[aã]o veio/iu.test(original) && /por que voc[eê] n[aã]o veio/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_PORQUE_NAO_VEIO`,
        pattern: ["porque", "você", "não", "veio"],
        replacements: ["por que você não veio"],
        message: "Em pergunta direta, a forma esperada é 'por que'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/porqu[eê] ele/iu.test(original) && /porque ele/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_PORQUE_ELE`,
        pattern: ["porquê", "ele"],
        replacements: ["porque ele"],
        message: "Em oração explicativa, a forma esperada aqui é 'porque'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/por que seu chefe/iu.test(original) && /porque seu chefe/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_POR_QUE_CHEFE`,
        pattern: ["por", "que", "seu", "chefe"],
        replacements: ["porque seu chefe"],
        message: "Em oração explicativa, a forma esperada é 'porque'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/por qual motivo/iu.test(original) && /por que motivo/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_POR_QUAL_MOTIVO`,
        pattern: ["por", "qual", "motivo"],
        replacements: ["por que motivo"],
        message: "Nesta construção interrogativa, a forma esperada é 'por que motivo'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/n[aã]o h[aá] nada de mais/iu.test(original) && /n[aã]o h[aá] nada demais/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_NADA_DEMAIS`,
        pattern: ["nada", "de", "mais"],
        replacements: ["nada demais"],
        message: "Nesta expressão, a forma esperada é 'demais'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/nada [àa] ver/iu.test(original) && /nada a ver/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_NADA_A_VER`,
        pattern: ["nada", "à", "ver"],
        replacements: ["nada a ver"],
        message: "A expressão esperada é 'nada a ver'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/a cerca de uma hora/iu.test(original) && /h[aá] cerca de uma hora/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_A_CERCA_HA`,
        pattern: ["a", "cerca", "de", "uma", "hora"],
        replacements: ["há cerca de uma hora"],
        message: "Para indicar tempo decorrido, a forma esperada é 'há cerca de'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/aonde voc[eê] deixou/iu.test(original) && /onde voc[eê] deixou/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_AONDE_DEIXOU`,
        pattern: ["aonde", "você", "deixou"],
        replacements: ["onde você deixou"],
        message: "Com verbo estático, a forma esperada é 'onde'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/aonde voc[eê] guardou/iu.test(original) && /onde voc[eê] guardou/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_AONDE_GUARDOU`,
        pattern: ["aonde", "você", "guardou"],
        replacements: ["onde você guardou"],
        message: "Com verbo estático, a forma esperada é 'onde'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/aonde quer que fosse/iu.test(original) && /onde quer que fosse/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_AONDE_QUER_QUE`,
        pattern: ["aonde", "quer", "que", "fosse"],
        replacements: ["onde quer que fosse"],
        message: "Com ideia de lugar fixo, a forma esperada é 'onde'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/incidir em erro/iu.test(original) && /incorrer em erro/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_INCIDIR_ERRO`,
        pattern: ["incidir", "em", "erro"],
        replacements: ["incorrer em erro"],
        message: "Nesta construção formal, a forma esperada é 'incorrer em erro'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/tachar os produtos/iu.test(original) && /taxar os produtos/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_TACHAR_PRODUTOS`,
        pattern: ["tachar", "os", "produtos"],
        replacements: ["taxar os produtos"],
        message: "No contexto tributário, a forma esperada é 'taxar'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/taxar o gerente de incompetente/iu.test(original) && /tachar o gerente de incompetente/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_TAXAR_GERENTE`,
        pattern: ["taxar", "o", "gerente", "de", "incompetente"],
        replacements: ["tachar o gerente de incompetente"],
        message: "No sentido de rotular alguém, a forma esperada é 'tachar'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/tachar o imposto/iu.test(original) && /taxar o imposto/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_TACHAR_IMPOSTO`,
        pattern: ["tachar", "o", "imposto"],
        replacements: ["taxar o imposto"],
        message: "No contexto tributário, a forma esperada é 'taxar'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/taxar a imagem ruim/iu.test(original) && /tachar a imagem ruim/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_TAXAR_IMAGEM`,
        pattern: ["taxar", "a", "imagem", "ruim"],
        replacements: ["tachar a imagem ruim"],
        message: "No sentido de rotular algo, a forma esperada é 'tachar'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/eu cinto que o sinto/iu.test(original) && /eu sinto que o cinto/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_CINTO_SINTO`,
        pattern: ["eu", "cinto", "que", "o", "sinto"],
        replacements: ["Eu sinto que o cinto"],
        message: "Nesse contexto, 'sinto' é verbo e 'cinto' é substantivo.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/concertar o r[aá]dio/iu.test(original) && /consertar o r[aá]dio/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_CONCERTAR_RADIO`,
        pattern: ["concertar", "o", "rádio"],
        replacements: ["consertar o rádio"],
        message: "No contexto de reparo, a forma esperada é 'consertar'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/ver o conserto/iu.test(original) && /ver o concerto/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_VER_CONSERTO`,
        pattern: ["ver", "o", "conserto"],
        replacements: ["ver o concerto"],
        message: "No contexto de apresentação, a forma esperada é 'concerto'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/porisso/iu.test(original) && /por isso/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_PORISSO`,
        pattern: ["porisso"],
        replacements: ["por isso"],
        message: "Essa locução costuma ser escrita separada.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/segunda feira/iu.test(original) && /segunda-feira/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SEGUNDA_FEIRA`,
        pattern: ["segunda", "feira"],
        replacements: ["segunda-feira"],
        message: "Esse composto costuma ser escrito com hífen.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/sexta feira/iu.test(original) && /sexta-feira/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SEXTA_FEIRA`,
        pattern: ["sexta", "feira"],
        replacements: ["sexta-feira"],
        message: "Esse composto costuma ser escrito com hífen.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/bem estar/iu.test(original) && /bem-estar/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_BEM_ESTAR`,
        pattern: ["bem", "estar"],
        replacements: ["bem-estar"],
        message: "Esse composto costuma ser escrito com hífen.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/não ha/iu.test(original) && /não há/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_NAO_HA`,
        pattern: ["não", "ha"],
        replacements: ["não há"],
        message: "Nessa construção, a forma esperada é 'não há'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/o porque/iu.test(original) && /o porquê/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_O_PORQUE`,
        pattern: ["o", "porque"],
        replacements: ["o porquê"],
        message: "Com artigo, a forma esperada é 'porquê'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    const sourceWords = tokenizeWords(original);
    const targetWords = tokenizeWords(expected);
    const diff = findDiffWindow(sourceWords, targetWords);

    if (diff.sourceSlice.length && diff.targetSlice.length) {
      const sourceJoined = diff.sourceSlice.map(normalizeToken).join(" ");
      const targetJoined = diff.targetSlice.join(" ");

      if (
        diff.sourceSlice.length <= 3
        && diff.targetSlice.length <= 3
        && sourceJoined !== diff.targetSlice.map(normalizeToken).join(" ")
      ) {
        phraseRules.push({
          id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_DIFF`,
          pattern: diff.sourceSlice.map(normalizeToken),
          replacements: [targetJoined],
          message: "Essa sequência costuma ser escrita de outra forma.",
          description: `Regra curta derivada de falha observada no proof (${item.id}).`
        });
      }

      if (
        diff.sourceSlice.length === 1
        && diff.targetSlice.length === 1
        && (diff.leftContext.length >= 1 || diff.rightContext.length >= 1)
      ) {
        const pattern = [
          ...diff.leftContext.slice(-2).map(normalizeToken),
          normalizeToken(diff.sourceSlice[0]),
          ...diff.rightContext.slice(0, 2).map(normalizeToken)
        ];
        const targetIndex = diff.leftContext.slice(-2).length;

        if (pattern.length >= 3 && pattern.length <= 5) {
          contextRules.push({
            id: `PT_BR_PROOF_CONTEXT_${slugify(item.id)}_DIFF`,
            pattern,
            targetIndex,
            replacements: [normalizeWhitespace(diff.targetSlice[0])],
            message: "Nesse contexto, a forma esperada é outra.",
            description: `Regra contextual curta derivada de falha observada no proof (${item.id}).`
          });
        }
      }
    }

    if (sourceWords.length === targetWords.length) {
      for (let index = 0; index < sourceWords.length; index += 1) {
        const from = normalizeWhitespace(sourceWords[index]);
        const to = normalizeWhitespace(targetWords[index]);
        const normalizedFrom = normalizeToken(from);
        const normalizedTo = normalizeToken(to);

        if (!from || !to || normalizedFrom === normalizedTo || /\s/u.test(from) || /\s/u.test(to)) {
          continue;
        }

        if (
          from.length >= 5
          && to.length >= 5
        ) {
          replacements.push({
            from,
            replacements: [to],
            source: `proof_fallback:${item.id}`
          });
        }
      }
    }
  }

  return {
    replacements,
    phraseRules,
    contextRules
  };
}

function mergeCandidatePayloads(...payloads) {
  return payloads.reduce((accumulator, payload) => ({
    replacements: mergeByKey(
      accumulator.replacements,
      payload?.replacements || [],
      (entry) => JSON.stringify([normalizeWhitespace(entry.from), entry.replacements])
    ),
    phraseRules: mergeByKey(
      accumulator.phraseRules,
      payload?.phraseRules || [],
      (entry) => JSON.stringify([entry.pattern, entry.replacements])
    ),
    contextRules: mergeByKey(
      accumulator.contextRules,
      payload?.contextRules || [],
      (entry) => JSON.stringify([entry.pattern, entry.targetIndex, entry.replacements])
    )
  }), {
    replacements: [],
    phraseRules: [],
    contextRules: []
  });
}

async function askGeminiForCandidates(failedItems) {
  const deterministicCandidates = buildDeterministicCandidates(failedItems);
  const apiKey = await getApiKey();
  if (!apiKey) {
    return deterministicCandidates;
  }

  const ai = new GoogleGenAI({ apiKey });
  const sample = failedItems.slice(0, 220).map((item) => ({
    id: item.id,
    difficulty: item.difficulty,
    category: item.category,
    original: item.original,
    actual: item.actual,
    expected: item.expected,
    remaining: item.remaining,
    wrong: item.wrong,
    newErrors: item.newErrors
  }));

  const prompt = `Você está refinando um corretor pt-BR com metodologia honesta.

Regra de ouro:
- A base "proof" é APENAS prova.
- O "proof-pardau" é o fiscal dessa prova.
- NÃO copie frases inteiras do proof para o motor.
- Gere apenas conhecimento generalizável e curto.

Responda SOMENTE com JSON puro neste formato:
{
  "replacements": [{"from":"...", "replacements":["..."], "source":"proof_gemini:<id>"}],
  "phraseRules": [{"id":"...", "pattern":["..."], "replacements":["..."], "message":"...", "description":"..."}],
  "contextRules": [{"id":"...", "pattern":["..."], "targetIndex":1, "replacements":["..."], "message":"...", "description":"..."}]
}

Restrições obrigatórias:
- replacements: apenas 1 palavra -> 1 palavra OU 1 palavra inválida -> 2 palavras/composto seguro. Nunca use artigos soltos como "o" -> "a".
- phraseRules: no máximo 5 tokens no pattern. Proibido usar a frase inteira do proof.
- contextRules: 3 a 5 tokens no pattern, com targetIndex válido.
- Priorize compostos, hifenização, acentuação contextual curta, locuções fixas, homófonos muito explícitos e abreviações estáveis.
- Evite regras ambíguas e semânticas demais.

Casos falhos:
${JSON.stringify(sample)}`;

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Gemini timeout")), 20_000);
      })
    ]);
    const parsed = JSON.parse(response.text.trim().replace(/^```json\s*|```$/g, ""));
    return mergeCandidatePayloads(deterministicCandidates, {
      replacements: Array.isArray(parsed.replacements) ? parsed.replacements : [],
      phraseRules: Array.isArray(parsed.phraseRules) ? parsed.phraseRules : [],
      contextRules: Array.isArray(parsed.contextRules) ? parsed.contextRules : []
    });
  } catch {
    return deterministicCandidates;
  }
}

function validateReplacementCandidates(candidates, failedItems) {
  const forbiddenTexts = new Set(failedItems.map((item) => normalizeToken(item.original)));
  const failedById = new Map(failedItems.map((item) => [String(item.id), normalizeToken(item.category)]));
  const allowedCategories = new Set(["acentuacao", "acentuação", "hifen", "hífen", "ortografia"]);

  return candidates.filter((candidate) => {
    const from = normalizeWhitespace(candidate?.from);
    const replacements = Array.isArray(candidate?.replacements)
      ? candidate.replacements.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];

    if (!from || !replacements.length || replacements.length !== 1) {
      return false;
    }

    const normalizedFrom = normalizeToken(from);
    const normalizedTo = normalizeToken(replacements[0]);
    const wordCount = tokenizeWords(from).length;
    if (wordCount < 1 || wordCount > 5 || from.length > 48 || forbiddenTexts.has(normalizedFrom)) {
      return false;
    }

    const sourceId = String(candidate?.source || "").split(":").pop() || "";
    const category = failedById.get(sourceId) || "";
    const singleWord = tokenizeWords(from).length === 1 && tokenizeWords(replacements[0]).length === 1;

    if (singleWord) {
      if (!allowedCategories.has(category)) {
        return false;
      }

      const fromNoAccent = stripDiacritics(normalizedFrom);
      const toNoAccent = stripDiacritics(normalizedTo);
      const distance = levenshteinDistance(fromNoAccent, toNoAccent);
      const sameInitial = fromNoAccent[0] === toNoAccent[0];

      if (!(distance <= 2 || (sameInitial && distance <= 3))) {
        return false;
      }
    }

    return {
      from,
      replacements,
      source: normalizeWhitespace(candidate.source || "proof_gemini")
    };
  });
}

function validatePhraseRuleCandidates(candidates, failedItems) {
  const forbiddenPatternTexts = new Set(
    failedItems.map((item) => tokenizeWords(item.original).map(normalizeToken).join(" "))
  );
  const forbiddenSingleTokenPatterns = new Set([
    "a", "ao", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "para", "por", "pra", "que", "se", "um", "uma"
  ]);

  return candidates.filter((candidate) => {
    const pattern = Array.isArray(candidate?.pattern)
      ? candidate.pattern.map((value) => normalizeToken(value)).filter(Boolean)
      : [];
    const replacements = Array.isArray(candidate?.replacements)
      ? candidate.replacements.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];
    const patternJoined = pattern.join(" ");

    if (!pattern.length || pattern.length > 5 || !replacements.length || forbiddenPatternTexts.has(patternJoined)) {
      return false;
    }

    if (pattern.length === 1) {
      const single = pattern[0];
      const replacementWords = tokenizeWords(replacements[0]).map(normalizeToken);
      const distance = levenshteinDistance(stripDiacritics(single), stripDiacritics(replacementWords.join(" ")));

      if (
        forbiddenSingleTokenPatterns.has(single)
        || single.length < 4
        || replacementWords.length > 1
        || distance > 2
      ) {
        return false;
      }
    }

    return {
      id: normalizeWhitespace(candidate.id || `PT_BR_PROOF_${slugify(patternJoined)}`),
      pattern,
      replacements,
      message: normalizeWhitespace(candidate.message || "Essa combinação costuma ser escrita de outra forma."),
      description: normalizeWhitespace(candidate.description || "Regra curta derivada de falha observada no proof.")
    };
  });
}

function validateContextRuleCandidates(candidates, failedItems) {
  const forbiddenPatternTexts = new Set(
    failedItems.map((item) => tokenizeWords(item.original).map(normalizeToken).join(" "))
  );

  return candidates.filter((candidate) => {
    const pattern = Array.isArray(candidate?.pattern)
      ? candidate.pattern.map((value) => normalizeToken(value)).filter(Boolean)
      : [];
    const replacements = Array.isArray(candidate?.replacements)
      ? candidate.replacements.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];
    const targetIndex = Number(candidate?.targetIndex);
    const patternJoined = pattern.join(" ");

    if (
      !pattern.length
      || pattern.length < 3
      || pattern.length > 5
      || !Number.isInteger(targetIndex)
      || targetIndex < 0
      || targetIndex >= pattern.length
      || replacements.length !== 1
      || forbiddenPatternTexts.has(patternJoined)
    ) {
      return false;
    }

    return {
      id: normalizeWhitespace(candidate.id || `PT_BR_PROOF_CONTEXT_${slugify(patternJoined)}`),
      pattern,
      targetIndex,
      replacements,
      message: normalizeWhitespace(candidate.message || "Nesse contexto, a forma esperada é outra."),
      description: normalizeWhitespace(candidate.description || "Regra contextual curta derivada de falha observada no proof.")
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = JSON.parse(await readFile(path.resolve(process.cwd(), args.audit), "utf8"));
  const failedItems = collectFailedItems(audit);
  const rawCandidates = await askGeminiForCandidates(failedItems);
  const payload = {
    generated_at: new Date().toISOString(),
    audit: args.audit,
    failed_items: failedItems.length,
    replacements: validateReplacementCandidates(rawCandidates.replacements || [], failedItems),
    phraseRules: validatePhraseRuleCandidates(rawCandidates.phraseRules || [], failedItems),
    contextRules: validateContextRuleCandidates(rawCandidates.contextRules || [], failedItems)
  };

  await writeFile(path.resolve(process.cwd(), args.output), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Falhas analisadas do proof sob fiscalizacao proof-pardau: ${failedItems.length}`);
  console.log(`Candidatos gerados: replacements=${payload.replacements.length}, phraseRules=${payload.phraseRules.length}, contextRules=${payload.contextRules.length}`);
  console.log(`Arquivo atualizado: ${path.resolve(process.cwd(), args.output)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
