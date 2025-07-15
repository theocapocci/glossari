// anki.js

import { callGeminiAPI } from './utils.js';

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

async function createFlashcard(options) {
    const { cardType, cardData, geminiApiKey, deckName } = options;
    const { selectedWord, contextualBlock, trimmedSentence, fullSentence } = cardData;

    await ensureDeckExists(deckName);

    if (!selectedWord || !(trimmedSentence || fullSentence)) {
        throw new Error("Cannot create flashcard because the word or sentence is empty.");
    }

    const sentenceForCard = trimmedSentence || fullSentence;

    // --- Single, Unified API Call ---
    // This prompt is robust enough for both card types.
    const aiPrompt = `
    You are an automated translation service for a flashcard application. Your task is to provide a concise English translation of a given French term based on its use in a sentence. 

    **French Term:** "${selectedWord}"
    **Sentence:** "${fullSentence}"

    **Instructions:**
    1.  Provide the most, context-appropriate English translation for the term.
    2.  Your entire response must consist ONLY of the translated text. Do not add any extra words, punctuation, or introductory phrases like "The translation is...".
    3.  Ensure your translation avoids capitalization, unless the term "${selectedWord}" is at the start "${fullSentence}", or otherwise ought to be capitalized.
    4.  Make use of the surrounding context to ensure the translation is context-appropriate.

    **Context:** "${contextualBlock}"  

    **Examples:**
    - French Term: 'maison', Sentence: 'La maison est grande!'
    - Output: house

    - French Term: 'Si vous avez', Sentence: 'Si vous avez un vélo, vous serez heureux.'
    - Output: If you have

    - French Term: 'vous serez heureux', Sentence: 'Si vous avez un vélo, vous serez heureux.'
    - Output: you will be happy

    - French Term: 'France', Sentence: 'J'habite en Angleterre.'
    - Output: England
    `;

    // We only call the API once, right at the beginning.
    const translation = await callGeminiAPI(aiPrompt, geminiApiKey);

    let modelName, fields, tags;

    // --- Logic for the 'Sentence (i+1)' Note Type ---
    if (cardType === 'sentence') {
        modelName = "1T (sentence)";
        fields = {
            "Sentence": sentenceForCard,
            "Target": selectedWord,
            "Translation": translation // Use the result from the single API call
        };
        tags = ["français", "glossari-sentence"];

    // --- Logic for the 'Vocabulary' Note Type ---
    } else if (cardType === 'vocab') {
        modelName = "1T (vocab)";
        fields = {
            "Target": selectedWord,
            "Translation": translation, // Use the result from the single API call
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

export async function createSentenceFlashcard(cardData, geminiApiKey, sentenceDeck) {
    return createFlashcard({
        cardType: 'sentence',
        cardData,
        geminiApiKey,
        deckName: sentenceDeck || 'Glossari Sentences'
    });
}

export async function createVocabFlashcard(cardData, geminiApiKey, vocabDeck) {
    return createFlashcard({
        cardType: 'vocab',
        cardData,
        geminiApiKey,
        deckName: vocabDeck || 'Glossari Vocab'
    });
}