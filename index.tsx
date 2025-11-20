import { getTermDetails, getTermsForCategory, generateExamQuestions, getRandomTerm, getQuizQuestion, getCategoryList } from './services/geminiService';
import { type GlossaryEntry, type Suggestion, type QuizQuestion, type Toast, type Category } from './types';

// Let TypeScript know about the vis.js library loaded from CDN
declare const vis: any;

// --- STATE MANAGEMENT ---
const state = {
  glossary: new Map<string, GlossaryEntry>(),
  glossaryLog: new Set<string>(),
  categoryCache: new Map<string, string[]>(),
  suggestions: [] as Suggestion[],
  toasts: [] as Toast[],
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
const toastContainer = document.getElementById('toastContainer') as HTMLDivElement;
const modalOverlay = document.getElementById('modalOverlay') as HTMLDivElement;
const modalDialog = document.getElementById('modalDialog') as HTMLDivElement;


// --- UI SYSTEMS (TOAST & MODAL) ---
let toastIdCounter = 0;

const showToast = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info', duration: number = 3000) => {
    const id = toastIdCounter++;
    const newToast: Toast = { id, message, type };
    state.toasts.push(newToast);

    const toastElement = document.createElement('div');
    toastElement.className = `toast ${type}`;
    toastElement.textContent = message;
    
    toastContainer.appendChild(toastElement);

    setTimeout(() => toastElement.classList.add('show'), 10);

    setTimeout(() => {
        toastElement.classList.remove('show');
        toastElement.addEventListener('transitionend', () => {
            toastElement.remove();
            state.toasts = state.toasts.filter(t => t.id !== id);
        });
    }, duration);
};

const showModal = (title: string, contentHtml: string) => {
    modalDialog.innerHTML = `
        <h2>${title}</h2>
        ${contentHtml}
    `;
    modalOverlay.classList.add('show');
};

const hideModal = () => {
    modalOverlay.classList.remove('show');
};


// --- LOADING STATE ---
const setLoading = (isLoading: boolean) => {
    state.isLoading = isLoading;
    if (isLoading) {
        welcomeBox.style.display = 'none';
        contentArea.innerHTML = '';
        loadingSpinner.style.display = 'flex';
    } else {
        loadingSpinner.style.display = 'none';
    }
};

// --- RENDERING FUNCTIONS ---

const renderTerm = (termDetails: GlossaryEntry) => {
    const isTermInLog = state.glossaryLog.has(termDetails.term);
    
    // Safe regex creation to prevent syntax errors with special characters
    let highlightedDefinition = termDetails.definition;
    if (termDetails.keyTermsInDefinition && termDetails.keyTermsInDefinition.length > 0) {
        const escapedTerms = termDetails.keyTermsInDefinition
            .filter(t => t && t.trim().length > 0)
            .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Escape special regex chars
        
        if (escapedTerms.length > 0) {
            const pattern = new RegExp(`\\b(${escapedTerms.join('|')})\\b`, 'gi');
            highlightedDefinition = termDetails.definition.replace(
                pattern,
                (match) => `<span class="clickable-term" tabindex="0" role="button" data-term="${match}">${match}</span>`
            );
        }
    }

    const relatedTermsHtml = termDetails.relatedTerms.map(term => `<li data-term="${term}">${term}</li>`).join('');
    
    contentArea.innerHTML = `
        <div class="result-box">
            <h2>${termDetails.term}</h2>
            <button id="add-to-log-btn" class="button btn-add-log" ${isTermInLog ? 'disabled' : ''}>
                ${isTermInLog ? 'Naplóban van' : 'Hozzáadás a naplóhoz'}
            </button>
            <h3>Definíció</h3>
            <p>${highlightedDefinition}</p>
            <h3>Kategória</h3>
            <p>${termDetails.category}</p>
            <h3>Vizsgaszerep</h3>
            <p>${termDetails.examRole}</p>
            <h3>Kapcsolódó fogalmak</h3>
            <ul class="related-terms-list">${relatedTermsHtml}</ul>
            <h3>Fogalmi Térkép</h3>
            <div id="term-graph-container"></div>
        </div>
    `;

    renderTermGraph(termDetails);
};

const renderTermGraph = (termDetails: GlossaryEntry) => {
    const container = document.getElementById('term-graph-container');
    if (!container) return;

    // Create the main node (Level 0)
    const nodesArr: any[] = [
        {
            id: termDetails.term,
            label: termDetails.term,
            color: { background: '#C19A6B', border: '#A07855' }, // Gold color for main term
            font: { color: '#0F1C2E', size: 22, face: 'Segoe UI', bold: true },
            shape: 'box',
            level: 0, // Top level
            margin: 15,
            shadow: true
        }
    ];

    // Filter related terms to exclude the term itself and remove duplicates
    const uniqueRelatedTerms = [...new Set(termDetails.relatedTerms)]
        .filter(t => t !== termDetails.term);

    // Create related nodes (Level 1)
    uniqueRelatedTerms.forEach(term => {
        nodesArr.push({
            id: term,
            label: term,
            color: { background: '#1F4D59', border: '#5A6A89' }, // Teal color for related
            font: { color: '#E8EEF2', size: 14, face: 'Segoe UI' },
            shape: 'box',
            level: 1 // Second level
        });
    });

    const nodes = new vis.DataSet(nodesArr);

    // Create edges connecting Main -> Related
    const edges = new vis.DataSet(
        uniqueRelatedTerms.map(term => ({
            from: termDetails.term,
            to: term,
            arrows: 'to',
            color: { color: '#5A6A89' },
            width: 2
        }))
    );

    const data = { nodes: nodes, edges: edges };

    const options = {
        layout: {
            hierarchical: {
                enabled: true,
                direction: 'UD', // Up-Down direction
                sortMethod: 'directed', // Ensures proper levels
                nodeSpacing: 180, // Horizontal space between nodes
                levelSeparation: 150, // Vertical space between levels
                treeSpacing: 200,
                blockShifting: true,
                edgeMinimization: true,
                parentCentralization: true // Keeps the parent centered above children
            }
        },
        physics: {
            enabled: false // Disable physics for a stable, static tree view
        },
        interaction: {
            dragNodes: false, // Lock nodes in place
            zoomView: true,
            dragView: true,
            hover: true
        },
        edges: {
            smooth: {
                type: 'cubicBezier',
                forceDirection: 'vertical',
                roundness: 0.4
            }
        }
    };

    new vis.Network(container, data, options);
};

const renderCategories = (categories: string[]) => {
    categoryAccordion.innerHTML = categories.map(category => `
        <details data-category="${category}">
            <summary>${category}</summary>
            <div class="category-content"></div>
        </details>
    `).join('');
};

const renderCategoryTerms = (terms: string[], container: Element) => {
    const listHtml = terms.map(term => `<li data-term="${term}" tabindex="0" role="button" aria-label="Fogalom megnyitása: ${term}">${term}</li>`).join('');
    container.innerHTML = `<ul class="category-list">${listHtml}</ul>`;
};

const renderGlossaryLog = () => {
    const logHtml = Array.from(state.glossaryLog).map(term => 
        `<li class="clickable-term" tabindex="0" role="button" data-term="${term}">${term}</li>`
    ).join('');

    contentArea.innerHTML = `
        <div class="result-box">
            <h2>Fogalomnapló</h2>
            ${logHtml.length > 0 ? `<ul>${logHtml}</ul>` : '<p>Még nem mentettél el egyetlen fogalmat sem.</p>'}
        </div>
    `;
};


const renderSuggestions = (suggestions: Suggestion[]) => {
     if (suggestions.length === 0) {
        contentArea.innerHTML = `
            <div class="result-box">
                <h2>Javaslatok</h2>
                <p>Jelenleg nincsenek új fogalomjavaslatok.</p>
            </div>
        `;
        return;
    }

    const suggestionsHtml = suggestions.map((s, index) => `
        <div class="suggestion-item">
            <strong>${s.term}</strong>
            <p>"${s.definition}"</p>
            <div class="suggestion-actions">
                <button class="btn-accept-suggestion" data-index="${index}">Elfogadás</button>
                <button class="btn-reject-suggestion" data-index="${index}">Elutasítás</button>
            </div>
        </div>
    `).join('');

    contentArea.innerHTML = `
        <div class="result-box">
            <h2>Beérkezett Javaslatok</h2>
            ${suggestionsHtml}
        </div>
    `;
}

const renderExamQuestions = (questions: string, topic: string) => {
    contentArea.innerHTML = `
        <div class="result-box">
            <h2>Vizsgafeladatok: ${topic}</h2>
            <div class="exam-questions">${questions}</div>
        </div>
    `;
};

const renderQuiz = (question: QuizQuestion) => {
    const optionsHtml = question.options.map((opt, index) => 
        `<button class="quiz-option" data-correct="${opt.isCorrect}">${opt.definition}</button>`
    ).join('');

    contentArea.innerHTML = `
        <div class="result-box">
            <div class="quiz-container">
                <h2>Kvíz</h2>
                <p class="quiz-question">Melyik definíció tartozik a következő fogalomhoz: <strong>${question.term}</strong>?</p>
                <div class="quiz-options">${optionsHtml}</div>
                <div class="quiz-feedback"></div>
                <button id="nextQuestionBtn" class="button btn-random" style="display: none;">Következő Kérdés</button>
            </div>
        </div>
    `;
};


// --- DATA FETCHING & LOGIC ---

const searchAndDisplayTerm = async (term: string) => {
    if (!term || state.isLoading) return;
    setLoading(true);
    
    try {
        let termDetails = state.glossary.get(term);
        if (!termDetails) {
            termDetails = await getTermDetails(term);
        }
        
        if (termDetails) {
            state.glossary.set(term, termDetails);
            renderTerm(termDetails);
        } else {
            showToast(`A(z) "${term}" fogalom nem található.`, 'error');
            contentArea.innerHTML = `<div class="result-box"><h2>Hiba</h2><p>A keresett fogalom nem található.</p></div>`;
        }
    } catch (error) {
        console.error("Error during term search:", error);
        showToast('Hálózati hiba történt.', 'error');
    } finally {
        setLoading(false);
    }
};

const handleCategoryClick = async (category: string, detailsElement: HTMLDetailsElement) => {
    const contentDiv = detailsElement.querySelector('.category-content');
    if (!contentDiv) return;

    if (state.categoryCache.has(category)) {
        renderCategoryTerms(state.categoryCache.get(category)!, contentDiv);
        return;
    }

    contentDiv.innerHTML = `<div style="text-align: center; padding: 10px;">...</div>`;
    
    try {
        const terms = await getTermsForCategory(category);
        if (terms.length > 0) {
            state.categoryCache.set(category, terms);
            renderCategoryTerms(terms, contentDiv);
        } else {
            contentDiv.innerHTML = 'Nincsenek fogalmak.';
        }
    } catch (error) {
        console.error("Error fetching terms for category:", error);
        contentDiv.innerHTML = 'Hiba a betöltéskor.';
    }
};

const handleRandomTermClick = async () => {
    setLoading(true);
    const knownTerms = Array.from(state.glossary.keys());
    const randomTerm = await getRandomTerm(knownTerms);
    await searchAndDisplayTerm(randomTerm);
};

const handleExamGenClick = () => {
    const content = `
        <div class="modal-form-group">
            <label for="examTopicInput">Milyen témakörben generáljunk feladatokat?</label>
            <input type="text" id="examTopicInput" class="modal-input" placeholder="pl. Készletgazdálkodás, Adózás alapjai">
        </div>
        <div class="modal-actions">
            <button class="modal-button secondary" id="modalCancelBtn">Mégse</button>
            <button class="modal-button primary" id="modalSubmitBtn">Generálás</button>
        </div>
    `;
    showModal('Vizsgafeladat-generátor', content);

    document.getElementById('modalSubmitBtn')?.addEventListener('click', async () => {
        const topic = (document.getElementById('examTopicInput') as HTMLInputElement).value;
        if (topic) {
            hideModal();
            setLoading(true);
            const questions = await generateExamQuestions(topic);
            renderExamQuestions(questions, topic);
            setLoading(false);
        } else {
            showToast('Kérjük, adjon meg egy témakört!', 'warning');
        }
    });
};

const handleSuggestTermClick = () => {
    const content = `
        <div class="modal-form-group">
            <label for="suggestTermInput">Javasolt fogalom</label>
            <input type="text" id="suggestTermInput" class="modal-input" placeholder="pl. Halasztott bevétel">
        </div>
        <div class="modal-form-group">
            <label for="suggestDefInput">Definíció javaslat</label>
            <textarea id="suggestDefInput" class="modal-textarea" placeholder="Írja le a fogalom definícióját..."></textarea>
        </div>
        <div class="modal-actions">
            <button class="modal-button secondary" id="modalCancelBtn">Mégse</button>
            <button class="modal-button primary" id="modalSubmitBtn">Beküldés</button>
        </div>
    `;
    showModal('Új Fogalom Javaslata', content);
    
    document.getElementById('modalSubmitBtn')?.addEventListener('click', () => {
        const term = (document.getElementById('suggestTermInput') as HTMLInputElement).value;
        const definition = (document.getElementById('suggestDefInput') as HTMLTextAreaElement).value;
        if (term && definition) {
            state.suggestions.push({ term, definition });
            hideModal();
            showToast('Köszönjük a javaslatot!', 'success');
        } else {
            showToast('Minden mező kitöltése kötelező!', 'warning');
        }
    });
};

const handleStartQuizClick = async () => {
    setLoading(true);
    const knownTerms = Array.from(state.glossary.keys());
    const question = await getQuizQuestion(knownTerms);
    if(question) {
        renderQuiz(question);
    } else {
        showToast('Hiba a kvíz indításakor.', 'error');
        contentArea.innerHTML = '';
    }
    setLoading(false);
}

const loadCategories = async () => {
    const categories = await getCategoryList();
    renderCategories(categories);
}

// --- EVENT LISTENERS ---

const setupEventListeners = () => {
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            searchAndDisplayTerm(searchInput.value);
        }
    });

    randomTermBtn.addEventListener('click', handleRandomTermClick);
    glossaryLogBtn.addEventListener('click', renderGlossaryLog);
    examGenBtn.addEventListener('click', handleExamGenClick);
    suggestTermBtn.addEventListener('click', handleSuggestTermClick);
    viewSuggestionsBtn.addEventListener('click', () => renderSuggestions(state.suggestions));
    startQuizBtn.addEventListener('click', handleStartQuizClick);
    
    // Event delegation for dynamically added content
    contentArea.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        
        // Handle clickable terms in definitions/log
        if (target.classList.contains('clickable-term') && target.dataset.term) {
            searchAndDisplayTerm(target.dataset.term);
        }

        // Handle related terms list
        if (target.tagName === 'LI' && target.dataset.term) {
            searchAndDisplayTerm(target.dataset.term);
        }

        // Add to log button
        if (target.id === 'add-to-log-btn') {
            const term = (contentArea.querySelector('h2') as HTMLElement)?.innerText;
            if (term) {
                state.glossaryLog.add(term);
                target.setAttribute('disabled', 'true');
                target.innerText = 'Naplóban van';
                showToast('Fogalom a naplóhoz adva!', 'success');
            }
        }

        // Suggestion buttons
        if(target.classList.contains('btn-accept-suggestion') || target.classList.contains('btn-reject-suggestion')) {
            const index = parseInt(target.dataset.index || '-1');
            if (index > -1) {
                const term = state.suggestions[index].term;
                const wasAccepted = target.classList.contains('btn-accept-suggestion');
                state.suggestions.splice(index, 1);
                showToast(`A "${term}" javaslat ${wasAccepted ? 'elfogadva' : 'elutasítva'}.`, wasAccepted ? 'success' : 'info');
                renderSuggestions(state.suggestions); // Re-render the list
            }
        }
        
        // Quiz option buttons
        if (target.classList.contains('quiz-option')) {
            const container = target.closest('.quiz-container');
            if (container && !container.classList.contains('answered')) {
                container.classList.add('answered');
                const isCorrect = target.dataset.correct === 'true';
                const feedbackEl = container.querySelector('.quiz-feedback') as HTMLDivElement;
                
                target.classList.add(isCorrect ? 'correct' : 'incorrect');
                feedbackEl.textContent = isCorrect ? 'Helyes válasz!' : 'Helytelen válasz!';
                feedbackEl.className = `quiz-feedback ${isCorrect ? 'feedback-correct' : 'feedback-incorrect'}`;

                if (!isCorrect) {
                    const correctOption = container.querySelector('.quiz-option[data-correct="true"]');
                    correctOption?.classList.add('correct');
                }
                (container.querySelector('#nextQuestionBtn') as HTMLElement).style.display = 'block';
            }
        }

        // Quiz next button
        if(target.id === 'nextQuestionBtn') {
            handleStartQuizClick();
        }
    });
    
    contentArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const target = e.target as HTMLElement;
            if (target.classList.contains('clickable-term') && target.dataset.term) {
                searchAndDisplayTerm(target.dataset.term);
            }
        }
    });

    // Listen for click events on items inside the accordion
    categoryAccordion?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'LI' && target.dataset.term) {
            searchAndDisplayTerm(target.dataset.term);
        }
    });

    // Use capturing listener for 'toggle' event to reliably detect when DETAILS opens
    // 'toggle' event does not bubble, so we must use capture: true
    categoryAccordion?.addEventListener('toggle', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'DETAILS') {
            const detailsElement = target as HTMLDetailsElement;
            const category = detailsElement.dataset.category;
            if (detailsElement.open && category && !state.categoryCache.has(category)) {
                handleCategoryClick(category, detailsElement);
            }
        }
    }, true);
    
    categoryAccordion.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            const target = e.target as HTMLElement;
             if (target.tagName === 'LI' && target.dataset.term) {
                e.preventDefault();
                searchAndDisplayTerm(target.dataset.term);
            }
        }
    });

    modalOverlay.addEventListener('click', e => {
        if (e.target === modalOverlay || (e.target as HTMLElement).id === 'modalCancelBtn') {
            hideModal();
        }
    });
};

// --- INITIALIZATION ---
const initApp = () => {
    setupEventListeners();
    loadCategories();
};

initApp();