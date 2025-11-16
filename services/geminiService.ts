import { GoogleGenAI, Type } from "@google/genai";
import { type GlossaryEntry, type QuizQuestion } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const model = "gemini-2.5-flash";

const systemInstruction = `
Te egy mesterséges intelligencia asszisztens vagy, akinek a feladata egy dinamikusan bővülő magyar nyelvű szakszótár létrehozása és kezelése. A célközönség gazdálkodás és menedzsment ágazatban tanuló középiskolások, akik pénzügyi–számviteli ügyintéző szakmát tanulnak.

**Elsődleges Forrásaid:**
1. „Pénzügyi-számviteli ügyintéző Programtanterv (2020.06.22.)”
2. „Pénzügyi-számviteli ügyintéző Képzési és Kimeneti Követelmények (2023.11.21.)”
Ha egy fogalom a dokumentumokban nem szerepel, akkor is a szakmának megfelelő, hivatalos, de közérthető definíciót adj.

**Stílus:**
Minden válaszod legyen formális, precíz, szakmailag hiteles, de a célközönség számára érthető. A definíciók maximum 3-4 mondatból álljanak.

**Kimeneti Formátum:**
Szigorúan tartsd be a kért kimeneti formátumot. A válaszod SOHA ne tartalmazzon semmilyen extra szöveget, magyarázatot, csak a kért JSON objektumot, JSON tömböt vagy szöveget.
`;

const glossaryEntrySchema = {
    type: Type.OBJECT,
    properties: {
        term: { type: Type.STRING },
        definition: { type: Type.STRING, description: "Max. 3-4 mondatos, középiskolai szinten érthető, de szakmailag pontos magyarázat." },
        relatedTerms: { type: Type.ARRAY, items: { type: Type.STRING }, description: "5-10 olyan kifejezés, amely logikailag vagy tematikusan összefügg vele." },
        category: { type: Type.STRING, description: "Besorolás a 11 kategória egyikébe." },
        examRole: { type: Type.STRING, description: "pl. 'fogalom-meghatározás', 'számítási példa', 'esettanulmány'." },
    },
    required: ["term", "definition", "relatedTerms", "category", "examRole"]
};

const quizQuestionSchema = {
    type: Type.OBJECT,
    properties: {
        term: { type: Type.STRING, description: "A központi pénzügyi fogalom, amire rákérdezünk." },
        options: {
            type: Type.ARRAY,
            description: "Négy lehetséges definíció.",
            items: {
                type: Type.OBJECT,
                properties: {
                    definition: { type: Type.STRING, description: "Egy definíció." },
                    isCorrect: { type: Type.BOOLEAN, description: "Igaz, ha ez a helyes definíció a megadott fogalomhoz." }
                },
                required: ["definition", "isCorrect"]
            }
        }
    },
    required: ["term", "options"]
};

export const getTermDetails = async (term: string): Promise<GlossaryEntry | null> => {
    const prompt = `Definiáld a következő pénzügyi-számviteli fogalmat a megadott JSON struktúra szerint: "${term}". A fogalmat sorold be a következő kategóriák egyikébe: gazdasági alapfogalmak és vállalkozási ismeretek; pénzügy és pénzkezelés; számvitel és bizonylatkezelés; adózás és elektronikus ügyintézés; banki és pénzügyi műveletek; pénzügyi piacok és befektetések; statisztika és gazdasági számítások; vállalkozások gazdálkodása; digitális alkalmazások és irodai szoftverek; leltár, készletgazdálkodás, eszközök; munkavállalói és munkajogi fogalmak.`;
    try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: glossaryEntrySchema,
                temperature: 0.2,
            },
        });
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as GlossaryEntry;
    } catch (error) {
        console.error(`Hiba a(z) "${term}" fogalom lekérésekor:`, error);
        return null;
    }
};

export const getTermsForCategory = async (category: string): Promise<string[]> => {
    const prompt = `Sorolj fel 10-15 kulcsfontosságú fogalmat a következő pénzügyi-számviteli kategóriából: "${category}". A válaszod egy JSON tömb legyen, amely csak a fogalmak neveit tartalmazza stringként. Pl: ["Eszköz", "Forrás", "Mérleg"].`;
    try {
         const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                },
                temperature: 0.5,
            },
        });
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as string[];
    } catch (error) {
        console.error(`Hiba a(z) "${category}" kategória fogalmainak lekérésekor:`, error);
        return [];
    }
};

export const generateExamQuestions = async (topic: string): Promise<string> => {
    const prompt = `Generálj 5-10, a magyar pénzügyi-számviteli ügyintéző szakmai vizsga szintjének megfelelő feladatot a következő témakörhöz kapcsolódóan: "${topic}". A feladatok legyenek változatosak (fogalommagyarázat, egyszerű számítási példák, rövid esettanulmány-kérdések). A válaszod legyen egy egyszerű, formázott szöveg.`;
     try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                systemInstruction,
                temperature: 0.7,
            },
        });
        return response.text;
    } catch (error) {
        console.error(`Hiba a(z) "${topic}" témakörhöz kapcsolódó vizsgafeladat generálásakor:`, error);
        return "Hiba történt a feladatok generálása közben.";
    }
};

export const getRandomTerm = async (existingTerms: string[]): Promise<string> => {
    let prompt = `Adj egy fontos, de nem túl alapvető pénzügyi-számviteli fogalmat a magyar szakképzés kontextusában. A válaszod csak a fogalom neve legyen.`;
    if (existingTerms.length > 0) {
        prompt += ` Lehetőleg ne a következők közül válassz: ${existingTerms.slice(0, 10).join(', ')}.`;
    }
     try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                systemInstruction,
                temperature: 1.0,
            },
        });
        return response.text.trim();
    } catch (error) {
        console.error(`Hiba a véletlen fogalom generálásakor:`, error);
        // Fallback
        const fallbackTerms = ["Mérleg", "Eredménykimutatás", "ÁFA", "SZJA", "Leltár"];
        return fallbackTerms[Math.floor(Math.random() * fallbackTerms.length)];
    }
};

export const getQuizQuestion = async (existingTerms: string[]): Promise<QuizQuestion | null> => {
    let prompt = `Generálj egy feleletválasztós kvízkérdést egy magyar pénzügyi-számviteli fogalomról. Adj meg egy fogalmat, a hozzá tartozó helyes definíciót, és három másik, hihető, de helytelen definíciót (amelyek más pénzügyi fogalmakhoz tartozhatnak). A négy definíciót keverd össze. A kimenet a megadott JSON séma szerint legyen.`;
    if (existingTerms.length > 0) {
        prompt += ` A fő fogalom ne legyen a következők közül: ${existingTerms.slice(0, 10).join(', ')}.`;
    }
    try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: quizQuestionSchema,
                temperature: 0.8,
            },
        });
        const jsonText = response.text.trim();
        const question = JSON.parse(jsonText) as QuizQuestion;

        if (question.options.length !== 4 || question.options.filter(o => o.isCorrect).length !== 1) {
             throw new Error("Invalid quiz data generated by AI.");
        }
        
        // Shuffle the options array to ensure randomness
        for (let i = question.options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [question.options[i], question.options[j]] = [question.options[j], question.options[i]];
        }

        return question;

    } catch (error) {
        console.error(`Hiba a kvízkérdés generálásakor:`, error);
        return null;
    }
};