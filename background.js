// background.js

import { convertMarkdownBoldToHtml } from './utils.js';

console.log("Glossari background service worker loaded with all features!");

// =================================================================================
// SECTION 0: STATE MANAGEMENT & TOGGLE
// =================================================================================

async function updateIcon(isActive) {
    const iconPaths = isActive
        ? { "16": "icons/icon-active16.png", "48": "icons/icon-active48.png", "128": "icons/icon-active128.png" }
        : { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" };
    try {
        await chrome.action.setIcon({ path: iconPaths });
    } catch (error) {
        console.warn("Could not set active icon. Make sure all icon sizes exist in the 'icons' folder.");
    }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isGlossariActive: false });
    updateIcon(false);
    chrome.contextMenus.create({ id: "defineWord", title: "Define '%s' (MyMemory)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "translateSentenceGemini", title: "Translate Sentence for '%s'", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "glossariSettings", title: "Glossari Settings", contexts: ["action"] });
    console.log("Context menus created successfully.");
});

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


// =================================================================================
// SECTION 1: HELPER FUNCTIONS
// =================================================================================

async function sendStatusMessage(status, message) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "showStatus", status: status, message: message });
        }
    } catch (error) {
        console.error("Failed to send status message to content script:", error);
    }
}

function displayResultOnPage(word, label, text, isDarkModeActive) {
    let glossariDisplay = document.getElementById('glossari-display');
    if (glossariDisplay) {
        glossariDisplay.remove();
    }
    glossariDisplay = document.createElement('div');
    glossariDisplay.id = 'glossari-display';
    if (isDarkModeActive) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    glossariDisplay.innerHTML = `
        <div class="glossari-header">
            <strong>${word}</strong>
            <span class="glossari-label">${label}</span>
            <button id="glossari-close-btn">&times;</button>
        </div>
        <div class="glossari-body">${text}</div>`;
    document.body.appendChild(glossariDisplay);
    document.getElementById('glossari-close-btn').addEventListener('click', () => {
        glossariDisplay.remove();
        if (!document.querySelector('#glossari-display')) {
            document.body.classList.remove('dark-mode');
        }
    });
}

async function ankiConnectRequest(action, params = {}) {
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
}


async function ensureDeckExists(deckName) {
    try {
        const deckNames = await ankiConnectRequest("deckNames");
        if (!deckNames.includes(deckName)) {
            await ankiConnectRequest("createDeck", { deck: deckName });
            console.log(`Deck "${deckName}" was created successfully.`);
        }
    } catch (error) {
        throw new Error(`Failed to ensure deck "${deckName}" exists. Is Anki running? Error: ${error.message}`);
    }
}


async function callGeminiAPI(prompt, apiKey) {
    const model = "gemini-1.5-flash-latest";
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(geminiApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    if (!response.ok || !data.candidates) {
        throw new Error(data.error?.message || "AI API request failed.");
    }
    return data.candidates[0].content.parts[0].text.trim();
}

async function addAnkiNote(deckName, front, back, tags = []) {
    const note = {
        deckName: deckName,
        modelName: "Basic",
        fields: { Front: front, Back: back },
        tags: tags
    };
    return ankiConnectRequest("addNote", { note });
}

async function createAnkiFlashcard({ selectedWord, fullSentence, frontContent }) {
    try {
        const { geminiApiKey, sentenceDeck } = await chrome.storage.local.get(['geminiApiKey', 'sentenceDeck']);
        const targetDeck = sentenceDeck || 'Glossari Sentences';

        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");
        await ensureDeckExists(targetDeck);

        const ankiFront = frontContent || fullSentence;
        const aiPrompt = `What is the meaning of the French phrase or word "${selectedWord}" as it is used in the sentence: "${fullSentence}"? Provide a concise, single-phrase English definition suitable for the back of an n+1 flashcard. Do not include any introductory phrases or additional context. Do not restate ${selectedWord}. Example: for 'maison', you would output 'house'.`;

        const definition = await callGeminiAPI(aiPrompt, geminiApiKey);
        const ankiBack = `<strong>${selectedWord}</strong> = ${definition.toLowerCase()}`;

        await addAnkiNote(targetDeck, ankiFront, ankiBack, ["français"]);
        await sendStatusMessage('success', `Sentence card for "<strong>${selectedWord}</strong>" created in deck "<strong>${targetDeck}</strong>"!`);
    } catch (error) {
        console.error("Glossari Flashcard Creation Error:", error.message);
        await sendStatusMessage('error', `Error: ${error.message}`);
    }
}

async function createVocabFlashcard({ selectedWord, sentence }) {
    try {
        const { geminiApiKey, vocabDeck } = await chrome.storage.local.get(['geminiApiKey', 'vocabDeck']);
        const targetDeck = vocabDeck || 'Glossari Vocab';

        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");
        await ensureDeckExists(targetDeck);

        const contextualPrompt = `Analyze the French word "${selectedWord}" in the context of the sentence: "${sentence}". Provide a concise English definition for the word as it's used in that specific sentence. Return only the definition of "${selectedWord}", with no introductory phrases.`;
        let contextualMeaning = await callGeminiAPI(contextualPrompt, geminiApiKey);
        contextualMeaning = contextualMeaning.replace(/\.$/, "");

        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedWord)}&langpair=fr|en`;
        const myMemoryResponse = await fetch(myMemoryUrl);
        const myMemoryData = await myMemoryResponse.json();
        let otherMeanings = [];
        if (myMemoryData.responseStatus === 200 && myMemoryData.matches) {
            const uniqueTranslations = new Set();
            myMemoryData.matches.forEach(match => {
                const translation = match.translation;
                if (translation.toLowerCase() !== contextualMeaning.toLowerCase() && translation.toLowerCase() !== selectedWord.toLowerCase()) {
                    uniqueTranslations.add(translation);
                }
            });
            otherMeanings = Array.from(uniqueTranslations).slice(0, 3);
        }

        const ankiFront = selectedWord;
        const regex = new RegExp(`\\b(${selectedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
        const formattedSentence = sentence.replace(regex, '<b>$1</b>');

        let ankiBack = `<div><em>${formattedSentence}</em></div><hr><div><b>${selectedWord}</b> = ${contextualMeaning}</div>`;
        if (otherMeanings.length > 0) {
            ankiBack += `<br><div><b>MyMemory:</b></div><ul>${otherMeanings.map(m => `<li>${m}</li>`).join('')}</ul>`;
        }

        await addAnkiNote(targetDeck, ankiFront, ankiBack, ["français", "vocab"]);
        await sendStatusMessage('success', `Vocab card for "<strong>${selectedWord}</strong>" created in deck "<strong>${targetDeck}</strong>"!`);
    } catch (error) {
        console.error("Glossari Vocab Card Creation Error:", error.message);
        await sendStatusMessage('error', `Vocab Card Error: ${error.message}`);
    }
}

async function handleDefineMyMemory(selectedText, tabId) {
    try {
        const langPair = 'fr|en';
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedText)}&langpair=${langPair}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus !== 200) {
            throw new Error(data.responseDetails || "Translation API error.");
        }

        const definition = data.responseData.translatedText;
        if (!definition || definition.toLowerCase() === selectedText.toLowerCase()) {
            throw new Error(`No distinct definition found for "${selectedText}".`);
        }

        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'MyMemory', definition, isDarkMode]
        });
    } catch (error) {
        console.error("Glossari Definition Error (MyMemory):", error.message);
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'Error', `Definition Failed: ${error.message}`, isDarkMode]
        });
    }
}

async function handleTranslateGemini(selectedText, fullSentence, tabId) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");

        const translationPrompt = `Translate the following French sentence into English: "${fullSentence}". In the translated sentence, please make the English translation of "${selectedText}" bold using HTML <strong> tags. Provide only the translated sentence, without any additional text, quotes, or introductory phrases.`;
        let translatedSentence = await callGeminiAPI(translationPrompt, geminiApiKey);
        translatedSentence = convertMarkdownBoldToHtml(translatedSentence);

        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, "gemini-1.5-flash-latest", translatedSentence, isDarkMode]
        });
    } catch (error) {
        console.error("Glossari Sentence Translation Error:", error.message);
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'Error', `Sentence Translation Failed: ${error.message}`, isDarkMode]
        });
    }
}


// =================================================================================
// SECTION 2: LISTENERS
// =================================================================================

async function getFullSentenceForSelection(tabId, selectedText) {
    const [tabResult] = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => {
            const selection = window.getSelection();
            if (selection.rangeCount === 0) return null;
            const range = selection.getRangeAt(0);
            let container = range.startContainer;
            while (container && container.nodeType !== Node.ELEMENT_NODE) {
                container = container.parentNode;
            }
            if (!container) return range.toString();
            let parent = container;
            while (parent && parent !== document.body) {
                const tagName = parent.tagName.toLowerCase();
                if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'blockquote', 'td', 'th', 'article', 'section'].includes(tagName)) {
                    return parent.innerText.replace(/\s+/g, ' ').trim();
                }
                parent = parent.parentNode;
            }
            return range.toString();
        }
    });
    return tabResult?.result || selectedText;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "glossariSettings") {
        chrome.tabs.create({ url: 'popup.html' });
        return;
    }

    const { isGlossariActive } = await chrome.storage.local.get('isGlossariActive');
    if (!isGlossariActive) {
        await sendStatusMessage('error', 'Glossari is currently off. Click the icon to turn it on.');
        return;
    }

    const selectedText = info.selectionText.trim();
    if (!selectedText) {
        await sendStatusMessage('error', 'No text selected for context menu action.');
        return;
    }

    if (info.menuItemId === "defineWord") {
        await handleDefineMyMemory(selectedText, tab.id);
    } else if (info.menuItemId === "translateSentenceGemini") {
        const fullSentence = await getFullSentenceForSelection(tab.id, selectedText);
        if (fullSentence.length < selectedText.length) {
            await sendStatusMessage('error', 'Could not determine full sentence context for translation. Translating selected text only.');
        }
        await handleTranslateGemini(selectedText, fullSentence, tab.id);
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        "createAnkiFlashcard": createAnkiFlashcard,
        "createVocabFlashcard": createVocabFlashcard
    };

    if (actions[request.action]) {
        actions[request.action](request).then(() => {
            chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        });
        return true; // Indicates an asynchronous response.
    } else if (request.action === "getInitialState") {
        chrome.storage.local.get('isGlossariActive').then(data => {
            sendResponse({ isActive: data.isGlossariActive });
        });
        return true;
    }
    return false;
});

chrome.commands.onCommand.addListener(async (command) => {
    const { isGlossariActive, selectedWordForAnki, fullSentenceForAnki } = await chrome.storage.local.get(['isGlossariActive', 'selectedWordForAnki', 'fullSentenceForAnki']);
    if (!isGlossariActive) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        console.warn('No active tab found for command:', command);
        return;
    }

    if (!selectedWordForAnki || !fullSentenceForAnki) {
        await sendStatusMessage('error', 'No text selected. Please highlight a word or phrase first.');
        return;
    }

    const commandActions = {
        "send-to-anki": () => chrome.tabs.sendMessage(tab.id, {
            action: "showAnkiTrimmer",
            selectedWord: selectedWordForAnki,
            fullSentence: fullSentenceForAnki
        }),
        "define-selected-text": () => handleDefineMyMemory(selectedWordForAnki, tab.id),
        "translate-sentence": () => handleTranslateGemini(selectedWordForAnki, fullSentenceForAnki, tab.id)
    };

    if (commandActions[command]) {
        commandActions[command]();
    }
});