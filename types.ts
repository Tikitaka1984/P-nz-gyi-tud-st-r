export interface GlossaryEntry {
  term: string;
  definition: string;
  relatedTerms: string[];
  category: string;
  examRole: string;
}

export interface Suggestion {
  term: string;
  definition: string;
}

export interface QuizOption {
  definition: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  term: string;
  options: QuizOption[];
}