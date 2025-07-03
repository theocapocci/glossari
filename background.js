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
    chrome.contextMenus.create({ id: "sendSelectionToAnki", title: "Send '%s' to Anki", contexts: ["selection"] });
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

/**
 * Creates a standard sentence flashcard.
 * @param {object} cardData
 */
async function createAnkiFlashcard({ selectedWord, fullSentence, frontContent }) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");

        const contextForAI = fullSentence;
        const ankiFront = frontContent || fullSentence;
        const model = "gemini-2.0-flash";
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const aiPrompt = `What is the meaning of the French phrase or word "${selectedWord}" as it is used in the sentence: "${contextForAI}"? Provide a concise, single-phrase English definition suitable for the back of an n+1 flashcard. Do not include any introductory phrases or additional context. Do not restate ${selectedWord}. Example: for 'maison', you would output 'house'.`;

        const aiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: aiPrompt }] }] })
        });
        const aiData = await aiResponse.json();
        if (!aiResponse.ok || !aiData.candidates) throw new Error(aiData.error?.message || "AI API request failed.");

        let definition = aiData.candidates[0].content.parts[0].text.trim().toLowerCase();
        const ankiBack = `<strong>${selectedWord}</strong> = ${definition}`;
        const ankiPayload = {
            action: "addNote", version: 6,
            params: { note: { deckName: "Glossari", modelName: "Obsidian-basic", fields: { "Front": ankiFront, "Back": ankiBack }, tags: ["français"] } }
        };

        const ankiResultResponse = await fetch("http://127.0.0.1:8765", {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ankiPayload)
        });
        const ankiResult = await ankiResultResponse.json();
        if (ankiResult.error) throw new Error(`AnkiConnect: ${ankiResult.error}`);
        console.log("Anki card added successfully:", ankiResult.result);
        await sendStatusMessage('success', `Sentence card for "<strong>${selectedWord}</strong>" created!`);
    } catch (error) {
        console.error("Glossari Flashcard Creation Error:", error.message);
        await sendStatusMessage('error', `Error: ${error.message}`);
    }
}

async function createVocabFlashcard({ selectedWord, sentence }) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");

        // --- Step 1: Get Contextual Meaning from Gemini ---
        const model = "gemini-2.0-flash";
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const contextualPrompt = `Analyze the French word "${selectedWord}" in the context of the sentence: "${sentence}". Provide a concise English definition for the word as it's used in that specific sentence. Return only the definition of "${selectedWord}", with no introductory phrases.`;

        const geminiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: contextualPrompt }] }] })
        });
        const geminiData = await geminiResponse.json();
        if (!geminiResponse.ok || !geminiData.candidates) {
            throw new Error(geminiData.error?.message || "Gemini API request failed.");
        }
        
        // Get the definition and remove any trailing full stop.
        let contextualMeaning = geminiData.candidates[0].content.parts[0].text.trim();
        contextualMeaning = contextualMeaning.replace(/\.$/, "");


        // --- Step 2: Get Other Meanings from MyMemory ---
        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedWord)}&langpair=fr|en`;
        const myMemoryResponse = await fetch(myMemoryUrl);
        const myMemoryData = await myMemoryResponse.json();

        let otherMeanings = [];
        if (myMemoryData.responseStatus === 200 && myMemoryData.matches) {
            const uniqueTranslations = new Set();
            myMemoryData.matches.forEach(match => {
                const translation = match.translation;
                // Keep comparisons case-insensitive to effectively filter duplicates.
                if (translation.toLowerCase() !== contextualMeaning.toLowerCase() && translation.toLowerCase() !== selectedWord.toLowerCase()) {
                    uniqueTranslations.add(translation);
                }
            });
            otherMeanings = Array.from(uniqueTranslations).slice(0, 3);
        }

        // --- Step 3: Format the Anki card content ---
        const ankiFront = selectedWord;

        // Helper function to escape special characters for use in a regular expression.
        const escapeRegExp = (string) => {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
        };
        const regex = new RegExp(`\\b(${escapeRegExp(selectedWord)})\\b`, 'gi');
        const formattedSentence = sentence.replace(regex, '<b>$1</b>');

        let ankiBack = `<div><em>${formattedSentence}</em></div>`;

        // Add a horizontal rule to separate sections.
        ankiBack += `<hr>`; 

        // Add the definition in its own block.
        ankiBack += `<div><b>${selectedWord}</b> = ${contextualMeaning}</div>`;

        // Add other meanings, with space above and its own block.
        if (otherMeanings.length > 0) {
            ankiBack += `<br><div><b>MyMemory:</b></div><ul>`;
            otherMeanings.forEach(meaning => {
                ankiBack += `<li>${meaning}</li>`;
            });
            ankiBack += '</ul>';
        }


        // --- Step 4: Send the formatted note to Anki ---
        const ankiPayload = {
            action: "addNote",
            version: 6,
            params: {
                note: {
                    deckName: "Glossari",
                    modelName: "Obsidian-basic",
                    fields: { "Front": ankiFront, "Back": ankiBack },
                    tags: ["français", "vocab"]
                }
            }
        };

        const ankiResultResponse = await fetch("http://127.0.0.1:8765", {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ankiPayload)
        });

        const ankiResult = await ankiResultResponse.json();
        if (ankiResult.error) throw new Error(`AnkiConnect: ${ankiResult.error}`);

        await sendStatusMessage('success', `Vocab card for "<strong>${selectedWord}</strong>" created!`);

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

        const model = "gemini-2.0-flash";
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

        const translationPrompt = `Translate the following French sentence into English: "${fullSentence}". In the translated sentence, please make the English translation of "${selectedText}" bold using HTML <strong> tags. Provide only the translated sentence, without any additional text, quotes, or introductory phrases.`;

        const aiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: translationPrompt }] }] })
        });
        const aiData = await aiResponse.json();
        if (!aiResponse.ok || !aiData.candidates) throw new Error(aiData.error?.message || "AI API request failed for translation.");

        let fullSentenceTranslatedAndBolded = aiData.candidates[0].content.parts[0].text.trim();
        fullSentenceTranslatedAndBolded = convertMarkdownBoldToHtml(fullSentenceTranslatedAndBolded);

        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, model, fullSentenceTranslatedAndBolded, isDarkMode]
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
    } else if (info.menuItemId === "sendSelectionToAnki") {
        try {
            const { fullSentenceForAnki } = await chrome.storage.local.get('fullSentenceForAnki');
            let fullSentence = fullSentenceForAnki;

            if (!fullSentence) {
                const [tabResult] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
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
                fullSentence = tabResult?.result || selectedText;
            }
            
            await createAnkiFlashcard({
                selectedWord: selectedText,
                fullSentence: fullSentence
            });
            await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);

        } catch (error) {
            console.error("Error sending context menu selection to Anki:", error);
            await sendStatusMessage('error', `Failed to send to Anki: ${error.message}`);
        }
    } else if (info.menuItemId === "translateSentenceGemini") {
        const { fullSentenceForAnki } = await chrome.storage.local.get('fullSentenceForAnki');
        let fullSentence = fullSentenceForAnki;

        if (!fullSentence) {
             const [tabResult] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
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
            fullSentence = tabResult?.result || selectedText;
        }

        if (!fullSentence || fullSentence.length < selectedText.length) {
            fullSentence = selectedText;
            await sendStatusMessage('error', 'Could not determine full sentence context for translation. Translating selected text only.');
        }

        await handleTranslateGemini(selectedText, fullSentence, tab.id);
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "createAnkiFlashcard") {
        createAnkiFlashcard(request).then(() => {
            chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        });
        return true;
    }
    else if (request.action === "createVocabFlashcard") {
        createVocabFlashcard(request).then(() => {
            chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        });
        return true;
    }
    else if (request.action === "getInitialState") {
        chrome.storage.local.get('isGlossariActive').then(data => {
            sendResponse({ isActive: data.isGlossariActive });
        });
        return true;
    }
    return true;
});


chrome.commands.onCommand.addListener(async (command) => {
    const { isGlossariActive } = await chrome.storage.local.get('isGlossariActive');
    if (!isGlossariActive) return;
    
    const { selectedWordForAnki, fullSentenceForAnki } = await chrome.storage.local.get(['selectedWordForAnki', 'fullSentenceForAnki']);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
        console.warn('No active tab found for command:', command);
        return;
    }

    if (!selectedWordForAnki || !fullSentenceForAnki) {
        await sendStatusMessage('error', 'No text selected. Please highlight a word or phrase first.');
        return;
    }

    if (command === "send-to-anki") {
        chrome.tabs.sendMessage(tab.id, {
            action: "showAnkiTrimmer",
            selectedWord: selectedWordForAnki,
            fullSentence: fullSentenceForAnki
        });

    } else if (command === "define-selected-text") {
        await handleDefineMyMemory(selectedWordForAnki, tab.id);
    } else if (command === "translate-sentence") {
        await handleTranslateGemini(selectedWordForAnki, fullSentenceForAnki, tab.id);
    }
});
