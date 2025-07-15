// anki.js

// =================================================================================
// ANKI CONNECT HELPERS
// =================================================================================

async function ankiConnectRequest(action, params = {}) {
    try {
        const response = await fetch("http://127.0.0.1:8765", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, version: 6, params })
        });
        const result = await response.json();
        if (result.error) throw new Error(`AnkiConnect: ${result.error}`);
        return result.result;
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error("Could not connect to Anki. Is Anki running with AnkiConnect installed?");
        }
        throw error;
    }
}

async function addAnkiNote(deckName, modelName, fields, tags = []) {
    const note = { deckName, modelName, fields, tags };
    return ankiConnectRequest("addNote", { note });
}

async function ensureDeckExists(deckName) {
    try {
        const deckNames = await ankiConnectRequest("deckNames");
        if (!deckNames.includes(deckName)) {
            await ankiConnectRequest("createDeck", { deck: deckName });
        }
    } catch (error) {
        throw new Error(`Failed to ensure deck "${deckName}" exists. ${error.message}`);
    }
}

// =================================================================================
// GENERIC FLASHCARD CREATION LOGIC
// =================================================================================
export async function createFlashcard(cardData, deckName) {
    // Destructure cardData directly
    const { selectedWord, translation, trimmedSentence, fullSentence } = cardData;

    await ensureDeckExists(deckName);

    if (!selectedWord || !translation || !(trimmedSentence || fullSentence)) {
        throw new Error("Missing required data (word, translation, or sentence) for flashcard creation.");
    }

    const sentenceForCard = trimmedSentence || fullSentence;
    const modelName = "1T";
    const fields = {
            "Sentence": sentenceForCard,
            "Target": selectedWord,
            "Translation": translation
    };
    const tags = ["français"];

    await addAnkiNote(deckName, modelName, fields, tags);
    return { deck: deckName, word: selectedWord };
}

// =================================================================================
// EXPORTED FLASHCARD CREATION FUNCTIONS
// =================================================================================

