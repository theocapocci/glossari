// anki.js

import { callGeminiAPI } from './utils.js';

// =================================================================================
// ANKI CONNECT HELPERS
// =================================================================================

/**
 * A generic wrapper for making requests to the AnkiConnect API.
 * @param {string} action
 * @param {object} params
 * @returns {Promise<any>}
 */
async function ankiConnectRequest(action, params = {}) {
    try {
        const response = await fetch("http://127.0.0.1:8765", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, version: 6, params })
        });
        const result = await response.json();
        if (result.error) {
            throw new Error(`AnkiConnect Error: ${result.error}`);
        }
        return result.result;
    } catch (error) {
        // More specific error for network failure
        if (error instanceof TypeError) {
            throw new Error("Could not connect to Anki. Is Anki running with AnkiConnect installed?");
        }
        throw error; // Re-throw other errors
    }
}

/**
 * A helper for creating a new note in Anki.
 * @param {string} deckName
 * @param {string} front
 * @param {string} back
 * @param {string[]} tags
 * @returns {Promise<any>}
 */
async function addAnkiNote(deckName, front, back, tags = []) {
    const note = {
        deckName: deckName,
        modelName: "Basic", // Assuming 'Basic' model, which is standard
        fields: { Front: front, Back: back },
        tags: tags
    };
    return ankiConnectRequest("addNote", { note });
}

/**
 * Checks if an Anki deck exists and creates it if it doesn't.
 * @param {string} deckName - The name of the deck to ensure exists.
 * @returns {Promise<void>}
 */
async function ensureDeckExists(deckName) {
    try {
        const deckNames = await ankiConnectRequest("deckNames");
        if (!deckNames.includes(deckName)) {
            await ankiConnectRequest("createDeck", { deck: deckName });
            console.log(`Deck "${deckName}" was created successfully.`);
        }
    } catch (error) {
        // Don't re-throw here, as the higher-level function will catch the initial ankiConnectRequest error
        throw new Error(`Failed to ensure deck "${deckName}" exists. ${error.message}`);
    }
}


// =================================================================================
// FLASHCARD CREATION LOGIC
// =================================================================================


/**
 * Creates a standard sentence flashcard.
 * @param {object} cardData - { selectedWord, fullSentence, frontContent }
 * @param {string} geminiApiKey
 * @param {string} sentenceDeck - The target deck name.
 * @returns {Promise<{deck: string, word: string}>}
 */
export async function createAnkiFlashcard({ selectedWord, fullSentence, frontContent }, geminiApiKey, sentenceDeck) {
    const targetDeck = sentenceDeck || 'Glossari Sentences';
    await ensureDeckExists(targetDeck);

    const ankiFront = frontContent || fullSentence;
    const aiPrompt = `What is the meaning of the French phrase or word "${selectedWord}" as it is used in the sentence: "${fullSentence}"? Provide a concise, single-phrase English definition suitable for the back of an n+1 flashcard. Do not include any introductory phrases or additional context. Do not restate ${selectedWord}. Example: for 'maison', you would output 'house'.`;

    const definition = await callGeminiAPI(aiPrompt, geminiApiKey);
    const ankiBack = `<strong>${selectedWord}</strong> = ${definition.toLowerCase()}`;

    await addAnkiNote(targetDeck, ankiFront, ankiBack, ["français", "sentence-card"]);
    return { deck: targetDeck, word: selectedWord };
}

/**
 * Creates a vocabulary flashcard.
 * @param {object} cardData - { selectedWord, sentence }
 * @param {string} geminiApiKey
 * @param {string} vocabDeck - The target deck name.
 * @returns {Promise<{deck: string, word: string}>}
 */
export async function createVocabFlashcard({ selectedWord, sentence }, geminiApiKey, vocabDeck) {
    const targetDeck = vocabDeck || 'Glossari Vocab';
    await ensureDeckExists(targetDeck);

    // --- Step 1: Get Contextual Meaning from Gemini ---
    const contextualPrompt = `Analyze the French word "${selectedWord}" in the context of the sentence: "${sentence}". Provide a concise English definition for the word as it's used in that specific sentence. Return only the definition of "${selectedWord}", with no introductory phrases.`;
    let contextualMeaning = await callGeminiAPI(contextualPrompt, geminiApiKey);
    contextualMeaning = contextualMeaning.replace(/\.$/, ""); // Remove trailing period if any

    // --- Step 2: Get Other Meanings from MyMemory ---
    const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedWord)}&langpair=fr|en`;
    const myMemoryResponse = await fetch(myMemoryUrl);
    const myMemoryData = await myMemoryResponse.json();

    let otherMeanings = [];
    if (myMemoryData.responseStatus === 200 && myMemoryData.matches) {
        const uniqueTranslations = new Set();
        myMemoryData.matches.forEach(match => {
            const translation = match.translation.toLowerCase();
            // Ensure the fetched translation is not the same as the word itself or the contextual meaning
            if (translation !== contextualMeaning.toLowerCase() && translation !== selectedWord.toLowerCase()) {
                uniqueTranslations.add(match.translation);
            }
        });
        otherMeanings = Array.from(uniqueTranslations).slice(0, 3); // Get up to 3 unique meanings
    }

    // --- Step 3: Format the Anki card content ---
    const ankiFront = selectedWord;
    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(${escapeRegExp(selectedWord)})\\b`, 'gi');
    const formattedSentence = sentence.replace(regex, '<b>$1</b>');

    let ankiBack = `<div><em>${formattedSentence}</em></div><hr><div><b>${selectedWord}</b> = ${contextualMeaning}</div>`;
    if (otherMeanings.length > 0) {
        ankiBack += `<br><div><b>Other Meanings:</b></div><ul>${otherMeanings.map(m => `<li>${m}</li>`).join('')}</ul>`;
    }

    // --- Step 4: Send the formatted note to Anki ---
    await addAnkiNote(targetDeck, ankiFront, ankiBack, ["français", "vocab-card"]);
    return { deck: targetDeck, word: selectedWord };
}
