export interface ReplacementEntry {
  from: string;
  replacements: string[];
  source: string;
}

export interface DictionaryData {
  words: Set<string>;
  commonMistakes: ReplacementEntry[];
  dictionaryReady: boolean;
  contextRules: ContextRuleDefinition[];
  phraseRules: PhraseRuleDefinition[];
  linguisticData: LinguisticData;
}

export interface ContextRuleDefinition {
  id: string;
  pattern: string[];
  targetIndex: number;
  replacements: string[];
  message: string;
  description: string;
}

export interface PhraseRuleDefinition {
  id: string;
  pattern: string[];
  replacements: string[];
  message: string;
  description: string;
}

export interface RuleMatchReplacement {
  value: string;
}

export interface MatchConfidence {
  level: "high" | "medium" | "low";
  score: number;
  reason?: string;
}

export interface RuleMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: RuleMatchReplacement[];
  confidence?: MatchConfidence;
  rule: {
    id: string;
    description: string;
    issueType: string;
  };
  context: {
    text: string;
    offset: number;
    length: number;
  };
}

export interface CheckResult {
  language: {
    name: string;
    code: string;
    detectedLanguage: {
      name: string;
      code: string;
      confidence: number;
    };
  };
  matches: RuleMatch[];
}

export interface LexicalEntry {
  lemma?: string;
  classes: string[];
  genero?: string | null;
  numero?: string | null;
  pessoa?: number | null;
  grupo?: string | null;
  irregular?: boolean;
  variavel?: boolean;
  autoCorrect?: "allow" | "blocked" | "review";
  tags?: string[];
  forms?: string[];
  notes?: string[];
}

export interface VerbConjugationRule {
  tempos: Record<string, string[]>;
}

export interface NominalInflectionRule {
  plural: Array<{
    terminacao: string;
    resultado: string;
  }>;
}

export interface DerivationRuleSet {
  sufixos: string[];
  prefixos: string[];
}

export interface VerbalAgreementProfile {
  pessoa: number;
  numero: string;
}

export interface BasicSyntaxPattern {
  id: string;
  pattern: string[];
  description: string;
}

export interface AllowedUnknownWordEntry {
  status: "permitido" | "bloquear_autocorrecao";
  tags?: string[];
  notes?: string[];
}

export interface LinguisticData {
  lexicalEntries: Map<string, LexicalEntry>;
  blockedAutoCorrections: Set<string>;
  allowedUnknownWords: Set<string>;
  locutions: Map<string, string>;
  verbConjugationRules: Record<string, VerbConjugationRule>;
  nominalInflection: NominalInflectionRule | null;
  derivation: DerivationRuleSet | null;
  verbalAgreement: Record<string, VerbalAgreementProfile>;
  irregularVerbs: Record<string, Record<string, string[]>>;
  irregularPlurals: Record<string, string>;
  syntaxPatterns: BasicSyntaxPattern[];
}
