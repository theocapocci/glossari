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
async function createFlashcard(cardType, deckName, cardData) {
    // Destructure cardData directly
    const { selectedWord, translation, trimmedSentence, fullSentence } = cardData;

    await ensureDeckExists(deckName);

    if (!selectedWord || !translation || !(trimmedSentence || fullSentence)) {
        throw new Error("Missing required data (word, translation, or sentence) for flashcard creation.");
    }

    const sentenceForCard = trimmedSentence || fullSentence;
    let modelName, fields, tags;

    // --- Logic for the 'Sentence (i+1)' Note Type ---
    if (cardType === 'sentence') {
        modelName = "1T (sentence)";
        fields = {
            "Sentence": sentenceForCard,
            "Target": selectedWord,
            "Translation": translation
        };
        tags = ["français", "glossari-sentence"];

    // --- Logic for the 'Vocabulary' Note Type ---
    } else if (cardType === 'vocab') {
        modelName = "1T (vocab)";
        fields = {
            "Target": selectedWord,
            "Translation": translation,
            "Sentence": sentenceForCard
        };
        tags = ["français", "glossari-vocab"];

    } else {
        throw new Error(`Invalid card type: ${cardType}`);
    }

    await addAnkiNote(deckName, modelName, fields, tags);
    return { deck: deckName, word: selectedWord };
}

// =================================================================================
// EXPORTED FLASHCARD CREATION FUNCTIONS
// =================================================================================

export async function createSentenceFlashcard(cardData, sentenceDeck) {
    // Pass arguments directly, not in an options object
    return createFlashcard('sentence', sentenceDeck || 'Languages::French::n+1', cardData);
}

export async function createVocabFlashcard(cardData, vocabDeck) {
    // Pass arguments directly, not in an options object
    return createFlashcard('vocab', vocabDeck || 'Languages::French::n+1', cardData);
}