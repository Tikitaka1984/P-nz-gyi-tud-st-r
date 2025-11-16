import { getTermDetails, getTermsForCategory, generateExamQuestions, getRandomTerm, getQuizQuestion } from './services/geminiService';
import { type GlossaryEntry, type Suggestion, type QuizQuestion } from './types';

// Let TypeScript know about the vis.js library loaded from CDN
declare const vis: any;

// --- STATE MANAGEMENT ---
const state = {
  glossary: new Map<string, GlossaryEntry>(),
  glossaryLog: new Set<string>(),
  categoryCache: new Map<string, string[]>(),
  suggestions: [] as Suggestion[],
  isLoading: false,
};

// --- DOM ELEMENT REFERENCES ---
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const contentArea = document.getElementById('contentArea') as HTMLDivElement;
const welcomeBox = document.getElementById('welcomeBox') as HTMLDivElement;
const loadingSpinner = document.getElementById('loadingSpinner') as HTMLDivElement;
const randomTermBtn = document.getElementById('randomTermBtn') as HTMLButtonElement;
const glossaryLogBtn = document.getElementById('glossaryLogBtn') as HTMLButtonElement;
const examGenBtn = document.getElementById('examGenBtn') as HTMLButtonElement;
const suggestTermBtn = document.getElementById('suggestTermBtn') as HTMLButtonElement;
const viewSuggestionsBtn = document.getElementById('viewSuggestionsBtn') as HTMLButtonElement;
const startQuizBtn = document.getElementById('startQuizBtn') as HTMLButtonElement;
const categoryAccordion = document.getElementById('categoryAccordion') as HTMLDivElement;

// --- UTILITY FUNCTIONS ---
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  // Fix: Resolve TypeScript error by using the correct return type for `setTimeout`, which can differ between browser and Node.js environments.
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<F>): Promise<ReturnType<F>> =>
    new Promise(resolve => {
      clearTimeout(timeout);
      timeout = setTimeout(() => resolve(func(...args)), waitFor);
    });
}

const setLoading = (loading: boolean) => {
  state.isLoading = loading;
  welcomeBox.style.display = 'none';
  loadingSpinner.style.display = loading ? 'flex' : 'none';
  if (!loading) {
    const resultBox = contentArea.querySelector('.result-box');
    if (!resultBox) {
        welcomeBox.style.display = 'block';
    }
  }
};

// --- RENDERING FUNCTIONS ---
const renderTermGraph = (entry: GlossaryEntry) => {
    const container = document.getElementById('term-graph-container');
    const title = document.querySelector('h3[data-graph-title]') as HTMLElement;

    if (!container || !entry.relatedTerms || entry.relatedTerms.length === 0) {
        if (container) container.style.display = 'none';
        if (title) title.style.display = 'none';
        return;
    }

    const nodes = new vis.DataSet([
        { id: entry.term.toLowerCase(), label: entry.term, color: '#C19A6B', font: { color: '#0F1C2E' }, shape: 'box', mass: 3 },
        ...entry.relatedTerms.map(term => ({ id: term.toLowerCase(), label: term }))
    ]);

    const edges = new vis.DataSet(
        entry.relatedTerms.map(term => ({ from: entry.term.toLowerCase(), to: term.toLowerCase() }))
    );

    const data = { nodes, edges };
    const options = {
        physics: {
            barnesHut: { gravitationalConstant: -4000, springLength: 150, springConstant: 0.05 },
            minVelocity: 0.75
        },
        nodes: {
            shape: 'dot',
            size: 16,
            font: { size: 14, color: '#E8EEF2' },
            borderWidth: 2,
            color: {
                border: '#5A6A89',
                background: '#2C3548',
                highlight: {
                    border: '#C19A6B',
                    background: '#1F4D59'
                }
            }
        },
        edges: {
            width: 2,
            color: { color: 'rgba(193, 154, 107, 0.3)', highlight: '#C19A6B' }
        },
        interaction: { hover: true }
    };

    const network = new vis.Network(container, data, options);

    network.on("click", (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const clickedNode = nodes.get(nodeId);
            if (clickedNode && clickedNode.label && clickedNode.label.toLowerCase() !== entry.term.toLowerCase()) {
                displayTerm(clickedNode.label);
            }
        }
    });
};

const renderTerm = (entry: GlossaryEntry, isRandom = false) => {
  const isSaved = state.glossaryLog.has(entry.term);
  const logButtonHtml = `<button class="button btn-add-log" data-term="${entry.term}" ${isSaved ? 'disabled' : ''}>${isSaved ? 'Elmentve a naplóba' : 'Hozzáadás a fogalomnaplóhoz'}</button>`;
  
  const content = `
    <div class="result-box">
      ${isRandom ? '<p style="font-style: italic; color: #aeb9c5;"><strong>Tipp:</strong> Ez egy véletlen gyakorló fogalom! Próbálja meg saját szavaival megfogalmazni a jelentését, mielőtt elolvassa.</p>' : ''}
      <h2>${entry.term}</h2>
      
      <h3>Definíció</h3>
      <p>${entry.definition}</p>

      <h3>Tantárgyi hivatkozás</h3>
      <p>${entry.category}</p>
      
      <h3>Tipikus vizsgaszerep</h3>
      <p>${entry.examRole}</p>

      <h3>Kapcsolódó fogalmak</h3>
      <ul class="related-terms-list">
        ${entry.relatedTerms.map(term => `<li data-term="${term}">${term}</li>`).join('')}
      </ul>

      <h3 data-graph-title>Vizuális Fogalomtérkép</h3>
      <div id="term-graph-container"></div>
      
      ${logButtonHtml}
    </div>
  `;
  contentArea.innerHTML = content;
  renderTermGraph(entry); // Render the graph after HTML is in the DOM
  setLoading(false);
};

const renderTermList = (terms: string[], title: string) => {
  const content = `
    <div class="result-box">
      <h2>${title}</h2>
      <ul class="category-list" style="padding-left: 0; list-style-position: inside;">
        ${terms.map(term => `<li data-term="${term}">${term}</li>`).join('')}
      </ul>
    </div>
  `;
  contentArea.innerHTML = content;
  setLoading(false);
}

const renderSuggestions = (suggestions: Suggestion[]) => {
    setLoading(true); 
    let content: string;

    if (suggestions.length === 0) {
        content = `
            <div class="result-box">
                <h2>Javaslatok</h2>
                <p>Jelenleg nincsenek felhasználói javaslatok.</p>
            </div>`;
    } else {
        content = `
            <div class="result-box">
                <h2>Felhasználói Javaslatok Áttekintése</h2>
                <div class="suggestions-list">
                    ${suggestions.map((s, index) => `
                        <div class="suggestion-item">
                            <strong>${s.term}</strong>
                            <p>"${s.definition}"</p>
                            <div class="suggestion-actions">
                                <button class="btn-accept-suggestion" data-index="${index}" data-term="${s.term}">Elfogadás és Generálás</button>
                                <button class="btn-reject-suggestion" data-index="${index}">Elutasítás</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }
    contentArea.innerHTML = content;
    setLoading(false);
};

const renderQuizQuestion = (question: QuizQuestion) => {
  const optionsHtml = question.options.map((opt) =>
    `<button class="quiz-option" data-correct="${opt.isCorrect}">
       ${opt.definition}
     </button>`
  ).join('');

  const content = `
    <div class="result-box quiz-container">
      <h2>Pénzügyi Kvíz</h2>
      <p class="quiz-question">Melyik definíció tartozik a következő fogalomhoz: <strong>${question.term}</strong>?</p>
      <div class="quiz-options">
        ${optionsHtml}
      </div>
      <div class="quiz-feedback"></div>
      <button id="nextQuestionBtn" class="button btn-random" style="display:none;">Következő Kérdés</button>
    </div>
  `;
  contentArea.innerHTML = content;
  setLoading(false);
};


// --- CORE LOGIC ---
const displayTerm = async (term: string, isRandom = false) => {
  if (!term || state.isLoading) return;
  setLoading(true);
  try {
    let entry = state.glossary.get(term.toLowerCase());
    if (!entry) {
      entry = await getTermDetails(term);
      if(entry) {
        state.glossary.set(entry.term.toLowerCase(), entry);
      }
    }
    if (entry) {
      renderTerm(entry, isRandom);
    } else {
        throw new Error("A fogalom nem található.");
    }
  } catch (error) {
    contentArea.innerHTML = `<div class="result-box"><p>Hiba történt: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}</p></div>`;
    setLoading(false);
  }
};

const handleSearch = async (query: string) => {
  if (!query.trim() || state.isLoading) {
    if(!query.trim()){
      contentArea.innerHTML = '';
      welcomeBox.style.display = 'block';
    }
    return;
  };
  setLoading(true);
  try {
    // Exact match check first
    const exactMatch = state.glossary.get(query.toLowerCase());
    if (exactMatch) {
      renderTerm(exactMatch);
      return;
    }
    
    // If no exact match, call AI
    const entry = await getTermDetails(query);
    if (entry) {
      state.glossary.set(entry.term.toLowerCase(), entry);
      renderTerm(entry);
    } else {
       contentArea.innerHTML = `<div class="result-box"><p>A keresett fogalom (${query}) nem található, és nem sikerült új definíciót generálni.</p></div>`;
       setLoading(false);
    }
  } catch (error) {
    contentArea.innerHTML = `<div class="result-box"><p>Hiba a keresés során: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}</p></div>`;
    setLoading(false);
  }
};

const handleCategoryClick = async (detailsElement: HTMLElement) => {
    if (!detailsElement.hasAttribute('open') || state.isLoading) return;

    const category = detailsElement.dataset.category;
    const contentDiv = detailsElement.querySelector('.category-content') as HTMLDivElement;
    if (!category || !contentDiv) return;

    // Use cache if available
    if (state.categoryCache.has(category)) {
        const terms = state.categoryCache.get(category)!;
        contentDiv.innerHTML = `<ul class="category-list">${terms.map(t => `<li data-term="${t}">${t}</li>`).join('')}</ul>`;
        return;
    }

    contentDiv.innerHTML = 'Betöltés...';
    try {
        const terms = await getTermsForCategory(category);
        state.categoryCache.set(category, terms);
        contentDiv.innerHTML = `<ul class="category-list">${terms.map(t => `<li data-term="${t}">${t}</li>`).join('')}</ul>`;
    } catch (error) {
        contentDiv.innerHTML = 'Hiba a betöltéskor.';
    }
};

const handleRandomTerm = async () => {
    if(state.isLoading) return;
    setLoading(true);
    try {
        const knownTerms = Array.from(state.glossary.keys());
        const term = await getRandomTerm(knownTerms);
        await displayTerm(term, true);
    } catch (error) {
        contentArea.innerHTML = `<div class="result-box"><p>Hiba a véletlen fogalom lekérése során: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}</p></div>`;
        setLoading(false);
    }
};

const handleGlossaryLog = () => {
  if (state.glossaryLog.size === 0) {
    renderTermList([], "A fogalomnaplód üres");
  } else {
    renderTermList(Array.from(state.glossaryLog), "Fogalomnapló");
  }
};

const handleExamGenerator = async () => {
    if(state.isLoading) return;
    const topic = prompt("Melyik témakörből vagy fogalomhoz szeretne vizsgafeladatokat generálni?");
    if (!topic) return;

    setLoading(true);
    try {
        const questions = await generateExamQuestions(topic);
        const content = `
            <div class="result-box">
                <h2>Vizsgafeladatok: ${topic}</h2>
                <div class="exam-questions">${questions}</div>
            </div>`;
        contentArea.innerHTML = content;
        setLoading(false);
    } catch (error) {
        contentArea.innerHTML = `<div class="result-box"><p>Hiba a feladatok generálása során: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}</p></div>`;
        setLoading(false);
    }
};

const handleSuggestTerm = () => {
    const term = prompt("Melyik fogalmat szeretnéd javasolni?");
    if (!term || term.trim() === '') return;

    const definition = prompt(`Add meg a(z) "${term}" fogalom definícióját:`);
    if (!definition || definition.trim() === '') return;

    if (state.suggestions.some(s => s.term.toLowerCase() === term.trim().toLowerCase())) {
        alert("Ezt a fogalmat már javasolták.");
        return;
    }

    const newSuggestion: Suggestion = { term: term.trim(), definition: definition.trim() };
    state.suggestions.push(newSuggestion);
    localStorage.setItem('termSuggestions', JSON.stringify(state.suggestions));

    alert("Köszönjük a javaslatot! A moderátorok hamarosan átnézik.");
};

const handleViewSuggestions = () => {
    if (state.isLoading) return;
    renderSuggestions(state.suggestions);
};

const handleStartQuiz = async () => {
    if (state.isLoading) return;
    setLoading(true);
    try {
        const knownTerms = Array.from(state.glossary.keys());
        const question = await getQuizQuestion(knownTerms);
        if (question) {
            renderQuizQuestion(question);
        } else {
            throw new Error("Nem sikerült kvízkérdést generálni.");
        }
    } catch (error) {
        contentArea.innerHTML = `<div class="result-box"><p>Hiba a kvíz indítása során: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}</p></div>`;
        setLoading(false);
    }
};


// --- EVENT LISTENERS ---
const debouncedSearch = debounce(handleSearch, 500);
searchInput.addEventListener('input', () => debouncedSearch(searchInput.value));

randomTermBtn.addEventListener('click', handleRandomTerm);
glossaryLogBtn.addEventListener('click', handleGlossaryLog);
examGenBtn.addEventListener('click', handleExamGenerator);
suggestTermBtn.addEventListener('click', handleSuggestTerm);
viewSuggestionsBtn.addEventListener('click', handleViewSuggestions);
startQuizBtn.addEventListener('click', handleStartQuiz);

categoryAccordion.addEventListener('toggle', (event) => {
    const detailsElement = event.target as HTMLDetailsElement;
    if (detailsElement.tagName === 'DETAILS') {
        handleCategoryClick(detailsElement);
    }
}, true); // Use capture phase to handle toggle event properly

contentArea.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    
    // Term click
    if (target.dataset.term && target.tagName === 'LI') {
        displayTerm(target.dataset.term);
    }

    // Add to log
    if (target.matches('.btn-add-log')) {
        const term = target.dataset.term;
        if (term) {
            state.glossaryLog.add(term);
            localStorage.setItem('glossaryLog', JSON.stringify(Array.from(state.glossaryLog)));
            target.textContent = 'Elmentve a naplóba';
            (target as HTMLButtonElement).disabled = true;
        }
    }

    // Suggestion actions
    const suggestionIndexStr = target.dataset.index;
    if (suggestionIndexStr) {
         const suggestionIndex = parseInt(suggestionIndexStr, 10);
        if (target.matches('.btn-accept-suggestion')) {
            const term = target.dataset.term;
            if (term) {
                state.suggestions.splice(suggestionIndex, 1);
                localStorage.setItem('termSuggestions', JSON.stringify(state.suggestions));
                displayTerm(term);
            }
        } else if (target.matches('.btn-reject-suggestion')) {
            state.suggestions.splice(suggestionIndex, 1);
            localStorage.setItem('termSuggestions', JSON.stringify(state.suggestions));
            renderSuggestions(state.suggestions);
        }
    }
    
    // Quiz option click
    if (target.matches('.quiz-option')) {
        const quizContainer = target.closest('.quiz-container');
        if (!quizContainer || quizContainer.classList.contains('answered')) return;

        quizContainer.classList.add('answered'); // Prevent re-answering
        const isCorrect = target.dataset.correct === 'true';
        const feedbackEl = quizContainer.querySelector('.quiz-feedback') as HTMLDivElement;
        const nextButton = quizContainer.querySelector('#nextQuestionBtn') as HTMLButtonElement;

        if (isCorrect) {
            target.classList.add('correct');
            feedbackEl.innerHTML = `<p class="feedback-correct">Helyes! ✅</p>`;
        } else {
            target.classList.add('incorrect');
            const correctButton = quizContainer.querySelector('.quiz-option[data-correct="true"]') as HTMLElement;
            if (correctButton) correctButton.classList.add('correct');
            feedbackEl.innerHTML = `<p class="feedback-incorrect">Helytelen! ❌</p>`;
        }
        if(nextButton) nextButton.style.display = 'block';
    }

    // Next question click
    if (target.id === 'nextQuestionBtn') {
        handleStartQuiz();
    }
});

// --- INITIALIZATION ---
const init = () => {
    const savedLog = localStorage.getItem('glossaryLog');
    if (savedLog) {
        state.glossaryLog = new Set(JSON.parse(savedLog));
    }
    const savedSuggestions = localStorage.getItem('termSuggestions');
    if (savedSuggestions) {
        state.suggestions = JSON.parse(savedSuggestions);
    }
    console.log("Pénzügyi Tudástár+ inicializálva.");
};

init();