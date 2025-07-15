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

    let modelName, fields, tags;

    if (cardType === 'sentence') {
        const sentenceForCard = trimmedSentence || fullSentence;
        const aiPrompt = `
        You are an automated translation service for a flashcard application. Your task is to provide a concise English translation of a given French term based on its use in the sentence it belongs to.

        **French Term:** "${selectedWord}"
        **Sentence:** "${fullSentence}"
        **Context:** "${contextualBlock}"

        **Instructions:**
        1.  Provide the most context-appropriate English translation for the term.
        2.  Your entire response must consist ONLY of the translated text. Do not add any extra words, punctuation, or introductory phrases like "The translation is...".
        3.  Ensure your translation avoids capitalization, unless the term "${selectedWord}" is at the start "${fullSentence}", or otherwise ought to be capitalized.`;

        const translation = await callGeminiAPI(aiPrompt, geminiApiKey);

        modelName = "i+1";
        fields = {
            "sentence": sentenceForCard,
            "target word": selectedWord,
            "translation": translation
        };
        tags = ["français"];

    } else if (cardType === 'vocab') {
        const contextualPrompt = `Analyze the French word "${selectedWord}" in the context of the following text: "${contextualBlock}". Provide a concise English definition for the word as it's used in that specific context. Return only the definition of "${selectedWord}", with no introductory phrases.`;
        let contextualMeaning = await callGeminiAPI(contextualPrompt, geminiApiKey);
        contextualMeaning = contextualMeaning.replace(/\.$/, "");

        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedWord)}&langpair=fr|en`;
        const myMemoryResponse = await fetch(myMemoryUrl);
        const myMemoryData = await myMemoryResponse.json();

        let otherMeanings = [];
        if (myMemoryData.responseStatus === 200 && myMemoryData.matches) {
            const uniqueTranslations = new Set();
            myMemoryData.matches.forEach(match => {
                const translation = match.translation.toLowerCase();
                if (translation !== contextualMeaning.toLowerCase() && translation !== selectedWord.toLowerCase()) {
                    uniqueTranslations.add(match.translation);
                }
            });
            otherMeanings = Array.from(uniqueTranslations).slice(0, 3);
        }

        const ankiFront = selectedWord;
        const sentenceForBack = trimmedSentence || fullSentence;
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b(${escapeRegExp(selectedWord)})\\b`, 'gi');
        const formattedSentence = sentenceForBack.replace(regex, '<b>$1</b>');

        let ankiBack = `<div><em>${formattedSentence}</em></div><hr><div><b>${selectedWord}</b> = ${contextualMeaning}</div>`;
        if (otherMeanings.length > 0) {
            ankiBack += `<br><div><b>Other Meanings:</b></div><ul>${otherMeanings.map(m => `<li>${m}</li>`).join('')}</ul>`;
        }
        
        modelName = "Basic";
        fields = { "Front": ankiFront, "Back": ankiBack };
        tags = ["français", "vocab-card"];

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