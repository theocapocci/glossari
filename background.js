// background.js

import { convertMarkdownBoldToHtml, callGeminiAPI } from './utils.js';
import { createSentenceFlashcard, createVocabFlashcard } from './anki.js';

console.log("Glossari background service worker loaded!");

// =================================================================================
// SECTION 0: STATE MANAGEMENT & INITIALIZATION
// =================================================================================

// --- Simple Cache to Store the Last Translation ---
let lastTranslationCache = {
    word: null,
    translation: null
};

async function updateIcon(isActive) {
    const iconPaths = isActive
        ? { "16": "icons/icon-active16.png", "48": "icons/icon-active48.png", "128": "icons/icon-active128.png" }
        : { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" };
    try {
        await chrome.action.setIcon({ path: iconPaths });
    } catch (error) {
        console.warn("Could not set active icon.", error);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isGlossariActive: false });
    updateIcon(false);
    chrome.contextMenus.create({ id: "defineWord", title: "Define '%s' (MyMemory)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "translateSentenceGemini", title: "Translate Sentence for '%s'", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "glossariSettings", title: "Glossari Settings", contexts: ["action"] });
});

// =================================================================================
// SECTION 1: CORE ACTION HANDLERS
// =================================================================================

// REFACTORED: Generic function to display results on the page
async function showResultInPage(tabId, word, label, text) {
    const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: displayResultOnPage, // This function is defined in SECTION 3
        args: [word, label, text, isDarkMode]
    });
}

async function handleCardCreation(cardCreator, cardData, tabId) {
    try {
        const { geminiApiKey, sentenceDeck, vocabDeck, contextSentences = 1 } = await chrome.storage.local.get(['geminiApiKey', 'sentenceDeck', 'vocabDeck', 'contextSentences']);
        if (!geminiApiKey) throw new Error("Gemini API Key is not set. Please set it in the Glossari settings.");

        const { fullSentence, contextualBlock } = await getTextFromPageForSelection(tabId, cardData.selectedWord, contextSentences, cardData.selectionDetails);

        let translation;
        // Check cache first
        if (lastTranslationCache.word === cardData.selectedWord && lastTranslationCache.translation) {
            translation = lastTranslationCache.translation;
            console.log("Using cached translation for:", cardData.selectedWord);
        } else {
            console.log("Cache stale or empty. Fetching new translation for:", cardData.selectedWord);
            const aiPrompt = `
            You are an automated translation service for a flashcard application. Your task is to provide a concise English translation of a given French term based on its use in a sentence. 

            **French Term:** "${cardData.selectedWord}"
            **Sentence:** "${fullSentence}"

            **Instructions:**
            1.  Provide the most context-appropriate English translation for the term.
            2.  Your entire response must consist ONLY of the translated text. Do not add any extra words, punctuation, or introductory phrases like "The translation is...".
            3.  Ensure your translation avoids capitalization, unless the term "${cardData.selectedWord}" is at the start "${fullSentence}", or otherwise ought to be capitalized.

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

            translation = await callGeminiAPI(aiPrompt, geminiApiKey);
            // Update the cache with the new word and its translation
            lastTranslationCache = { word: cardData.selectedWord, translation: translation };
        }

        const completeCardData = {
            ...cardData,
            fullSentence,
            contextualBlock,
            translation // Add the translation here
        };

        const deckSetting = cardCreator === createSentenceFlashcard ? sentenceDeck : vocabDeck;
        // The API key is no longer passed to the creator functions
        const result = await cardCreator(completeCardData, deckSetting);

        await sendStatusMessage('success', `Card for "<strong>${result.word}</strong>" created in deck "<strong>${result.deck}</strong>"!`);
    } catch (error) {
        console.error("Glossari Card Creation Error:", error.message);
        lastTranslationCache = { word: null, translation: null }; // Clear cache on error
        await sendStatusMessage('error', `Error: ${error.message}`);
    }
}

async function handleDefineMyMemory(selectedText, tabId) {
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedText)}&langpair=fr|en`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`MyMemory API request failed: ${response.status}`);
        const data = await response.json();
        if (data.responseStatus !== 200) throw new Error(data.responseDetails || "MyMemory API error.");
        const definition = data.responseData.translatedText;
        if (!definition || definition.toLowerCase() === selectedText.toLowerCase()) {
            chrome.tabs.sendMessage(tabId, {
                action: "myMemoryDefinitionResponse",
                error: `No distinct definition found for "${selectedText}".`,
                selectedText: selectedText,
            });
            return;
        }
        chrome.tabs.sendMessage(tabId, {
            action: "myMemoryDefinitionResponse",
            definition: definition,
            selectedText: selectedText,
        });
    } catch (error) {
        console.error("Glossari Definition Error (MyMemory):", error.message);
        chrome.tabs.sendMessage(tabId, {
            action: "myMemoryDefinitionResponse",
            error: `Definition Failed: ${error.message}`,
            selectedText: selectedText
        });
    }
}

async function handleTranslateGemini(selectedText, sentenceToTranslate, tabId) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");
        const translationPrompt = `Translate the following French sentence into English: "${sentenceToTranslate}". Provide only the translated sentence.`;
        let translatedSentence = await callGeminiAPI(translationPrompt, geminiApiKey);
        translatedSentence = convertMarkdownBoldToHtml(translatedSentence);
        await showResultInPage(tabId, selectedText, "Translation", translatedSentence); // Use helper
    } catch (error) {
        console.error("Glossari Sentence Translation Error:", error.message);
        await sendStatusMessage('error', `Translation Failed: ${error.message}`);
    }
}


// =================================================================================
// SECTION 2: LISTENERS (EVENTS)
// =================================================================================

chrome.action.onClicked.addListener(async (tab) => {
    const { isGlossariActive } = await chrome.storage.local.get('isGlossariActive');
    const newState = !isGlossariActive;
    await chrome.storage.local.set({ isGlossariActive: newState });
    await updateIcon(newState);
    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "updateState", isActive: newState });
        chrome.tabs.sendMessage(tab.id, { action: "showActivationPopup", isActive: newState });
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "glossariSettings") {
        chrome.tabs.create({ url: 'popup.html' });
        return;
    }
    const { isGlossariActive } = await chrome.storage.local.get('isGlossariActive');
    if (!isGlossariActive) {
        await sendStatusMessage('error', 'Glossari is off. Click the icon to turn it on.');
        return;
    }
    const selectedText = info.selectionText ? info.selectionText.trim() : "";
    if (!selectedText) return;

    if (info.menuItemId === "defineWord") {
        await handleDefineMyMemory(selectedText, tab.id);
    } else if (info.menuItemId === "translateSentenceGemini") {
        const { fullSentence } = await getTextFromPageForSelection(tab.id, selectedText, 0);
        await handleTranslateGemini(selectedText, fullSentence, tab.id);
    }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command === "translate-sentence") {
        try {
            const [injectionResult] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.getSelection().toString(),
            });

            const selectedText = injectionResult.result ? injectionResult.result.trim() : "";
            
            if (!selectedText) {
                await sendStatusMessage('error', 'Please select text to translate.');
                return;
            }
            const { fullSentence } = await getTextFromPageForSelection(tab.id, selectedText, 0);
            
            if (fullSentence) {
                await handleTranslateGemini(selectedText, fullSentence, tab.id);
            } else {
                 await sendStatusMessage('error', 'Could not find sentence for selection.');
            }

        } catch (error) {
            console.error("Glossari Shortcut Error:", error);
            await sendStatusMessage('error', `Shortcut Failed: ${error.message}`);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        "createSentenceFlashcard": (req) => handleCardCreation(createSentenceFlashcard, req, sender.tab.id),
        "createVocabFlashcard": (req) => handleCardCreation(createVocabFlashcard, req, sender.tab.id),
        "getInitialState": () => chrome.storage.local.get('isGlossariActive').then(sendResponse),
        "getFullSentence": (req) => {
            getTextFromPageForSelection(sender.tab.id, req.selectedWord, 0, req.selectionDetails)
                .then(result => sendResponse(result.fullSentence));
            return true;
        },
        "getMyMemoryDefinition": (req) => {
            handleDefineMyMemory(req.selectedText, sender.tab.id);
            return true;
        }
    };

    if (actions[request.action]) {
        actions[request.action](request);
        return true;
    }
    return false;
});

// =================================================================================
// SECTION 3: UTILITY & SCRIPTING FUNCTIONS
// =================================================================================

async function getTextFromPageForSelection(tabId, selectedText, contextSentences = 0, selectionDetails = null) {
    try {
        const [tabResult] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (selectedText, contextSentences) => {
                let fullSentence = selectedText;
                let contextualBlock = selectedText;

                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                    return { fullSentence, contextualBlock };
                }
                const BLOCK_TAGS = ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'ARTICLE', 'SECTION', 'TD', 'PRE'];
                const range = selection.getRangeAt(0);
                let anchorElement = range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer;

                while (
                    anchorElement &&
                    anchorElement.tagName?.toLowerCase() !== 'body' &&
                    !BLOCK_TAGS.includes(anchorElement.tagName)
                ) {
                    anchorElement = anchorElement.parentNode;
                }
                
                if (!anchorElement || !anchorElement.innerText) {
                    return { fullSentence, contextualBlock };
                }
                
                fullSentence = anchorElement.innerText.trim();

                const precedingSentences = [];
                let currentElement = anchorElement.previousElementSibling;
                for (let i = 0; i < contextSentences && currentElement; i++) {
                    precedingSentences.unshift(currentElement.innerText.trim());
                    currentElement = currentElement.previousElementSibling;
                }

                const subsequentSentences = [];
                currentElement = anchorElement.nextElementSibling;
                for (let i = 0; i < contextSentences && currentElement; i++) {
                    subsequentSentences.push(currentElement.innerText.trim());
                    currentElement = currentElement.nextElementSibling;
                }

                contextualBlock = [
                    ...precedingSentences,
                    fullSentence,
                    ...subsequentSentences
                ].join(' ').trim();
                
                return { fullSentence, contextualBlock };
            },
            args: [selectedText, contextSentences]
        });

        return tabResult?.result || { fullSentence: selectedText, contextualBlock: selectedText };

    } catch (error) {
        console.error("Could not execute script to get text from page:", error);
        return { fullSentence: selectedText, contextualBlock: selectedText };
    }
}

async function sendStatusMessage(status, message) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "showStatus", status: status, message: message });
        }
    } catch (error) {
        console.error("Failed to send status message:", error);
    }
}

function displayResultOnPage(word, label, text, isDarkModeActive) {
    let glossariDisplay = document.getElementById('glossari-display');
    if (glossariDisplay) glossariDisplay.remove();
    glossariDisplay = document.createElement('div');
    glossariDisplay.id = 'glossari-display';
    if (isDarkModeActive) document.body.classList.add('dark-mode');
    glossariDisplay.innerHTML = `
        <div class="glossari-header">
            <strong>${word}</strong>
            <span class="glossari-label">${label}</span>
            <button id="glossari-close-btn">&times;</button>
        </div>
        <div class="glossari-body">${text}</div>`;
    document.body.appendChild(glossariDisplay);
    document.getElementById('glossari-close-btn').addEventListener('click', () => glossariDisplay.remove());
}