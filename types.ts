export interface GlossaryEntry {
  term: string;
  definition: string;
  relatedTerms: string[];
  category: string;
  examRole: string;
  keyTermsInDefinition: string[];
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

export interface Toast {
    id: number;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

export interface Category {
    name: string;
}
