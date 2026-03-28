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
}

export interface ContextRuleDefinition {
  id: string;
  pattern: string[];
  targetIndex: number;
  replacements: string[];
  message: string;
  description: string;
}

export interface RuleMatchReplacement {
  value: string;
}

export interface RuleMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: RuleMatchReplacement[];
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
