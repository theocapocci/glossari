// background.js

import { convertMarkdownBoldToHtml, callGeminiAPI } from './utils.js';
import { createSentenceFlashcard, createVocabFlashcard } from './anki.js';

console.log("Glossari background service worker loaded!");

// =================================================================================
// SECTION 0: STATE MANAGEMENT & INITIALIZATION (No changes in this section)
// =================================================================================

async function updateIcon(isActive) {
    const iconPaths = isActive
        ? { "16": "icons/icon-active16.png", "48": "icons/icon-active48.png", "128": "icons/icon-active128.png" }
        : { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" };
    try {
        await chrome.action.setIcon({ path: iconPaths });
    } catch (error) {
        console.warn("Could not set active icon. Ensure all icon sizes exist in the 'icons' folder.", error);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isGlossariActive: false });
    updateIcon(false);
    // Context Menus
    chrome.contextMenus.create({ id: "defineWord", title: "Define '%s' (MyMemory)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "translateSentenceGemini", title: "Translate Sentence for '%s'", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "glossariSettings", title: "Glossari Settings", contexts: ["action"] });
    console.log("Context menus created successfully.");
});

// =================================================================================
// SECTION 1: CORE ACTION HANDLERS
// =================================================================================

async function handleCardCreation(cardCreator, cardData, tabId) {
    try {
        const { geminiApiKey, sentenceDeck, vocabDeck } = await chrome.storage.local.get(['geminiApiKey', 'sentenceDeck', 'vocabDeck']);
        if (!geminiApiKey) throw new Error("Gemini API Key is not set. Please set it in the Glossari settings.");

        // Always get the full, original sentence from the page for the best AI context.
        const fullSentence = await getFullSentenceForSelection(tabId, cardData.selectedWord);

        // Prepare a comprehensive data object. The card creator functions will pick what they need.
        const completeCardData = {
            selectedWord: cardData.selectedWord,
            fullSentence: fullSentence,
            // Pass along the trimmed content if it exists.
            frontContent: cardData.frontContent, // For sentence cards
            exampleSentence: cardData.sentence,      // For vocab cards (from the trimmer)
        };

        const deckSetting = cardCreator === createSentenceFlashcard ? sentenceDeck : vocabDeck;
        const result = await cardCreator(completeCardData, geminiApiKey, deckSetting);

        await sendStatusMessage('success', `Card for "<strong>${result.word}</strong>" created in deck "<strong>${result.deck}</strong>"!`);
    } catch (error) {
        console.error("Glossari Card Creation Error:", error.message);
        await sendStatusMessage('error', `Error: ${error.message}`);
    }
}


async function handleDefineMyMemory(selectedText, tabId) {
    try {
        const langPair = 'fr|en';
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedText)}&langpair=${langPair}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`MyMemory API request failed with status: ${response.status}`);
        const data = await response.json();

        if (data.responseStatus !== 200) {
            throw new Error(data.responseDetails || "MyMemory API error.");
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
        if (!geminiApiKey) throw new Error("Gemini API Key is not set. Please set it in the Glossari settings.");

        const translationPrompt = `Translate the following French sentence into English: "${fullSentence}". In the translated sentence, please make the English translation of "${selectedText}" bold using HTML <strong> tags. Provide only the translated sentence, without any additional text, quotes, or introductory phrases.`;
        let translatedSentence = await callGeminiAPI(translationPrompt, geminiApiKey);
        translatedSentence = convertMarkdownBoldToHtml(translatedSentence);

        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, "Translation", translatedSentence, isDarkMode]
        });
    } catch (error) {
        console.error("Glossari Sentence Translation Error:", error.message);
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'Error', `Translation Failed: ${error.message}`, isDarkMode]
        });
    }
}

// =================================================================================
// SECTION 2: LISTENERS (EVENTS) (No changes in this section)
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
        await sendStatusMessage('error', 'Glossari is currently off. Click the icon to turn it on.');
        return;
    }

    const selectedText = info.selectionText ? info.selectionText.trim() : "";
    if (!selectedText) {
        await sendStatusMessage('error', 'No text selected for context menu action.');
        return;
    }

    if (info.menuItemId === "defineWord") {
        await handleDefineMyMemory(selectedText, tab.id);
    } else if (info.menuItemId === "translateSentenceGemini") {
        const fullSentence = await getFullSentenceForSelection(tab.id, selectedText);
        await handleTranslateGemini(selectedText, fullSentence, tab.id);
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        "createSentenceFlashcard": (req) => handleCardCreation(createSentenceFlashcard, req, sender.tab.id),
        "createVocabFlashcard": (req) => handleCardCreation(createVocabFlashcard, req, sender.tab.id),
        "getInitialState": () => chrome.storage.local.get('isGlossariActive').then(sendResponse),
        // Add this new case to handle the request from the trim buttons
        "getFullSentence": (req) => {
            getFullSentenceForSelection(sender.tab.id, req.selectedWord)
                .then(sendResponse); // sendResponse is the callback that gets the sentence
        }
    };

    if (actions[request.action]) {
        actions[request.action](request);
        return true; // Indicates an asynchronous response is expected.
    }
    return false;
});
chrome.commands.onCommand.addListener(async (command) => {
    const { isGlossariActive, selectedWordForAnki } = await chrome.storage.local.get(['isGlossariActive', 'selectedWordForAnki']);
    if (!isGlossariActive) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        console.warn('No active tab found for command:', command);
        return;
    }

    if (!selectedWordForAnki) {
        await sendStatusMessage('error', 'No text selected. Please highlight a word or phrase first.');
        return;
    }
    
    const fullSentence = await getFullSentenceForSelection(tab.id, selectedWordForAnki);

    const commandActions = {
        "send-to-anki": () => chrome.tabs.sendMessage(tab.id, {
            action: "showAnkiTrimmer",
            selectedWord: selectedWordForAnki,
            fullSentence: fullSentence
        }),
        "define-selected-text": () => handleDefineMyMemory(selectedWordForAnki, tab.id),
        "translate-sentence": () => handleTranslateGemini(selectedWordForAnki, fullSentence, tab.id)
    };

    if (commandActions[command]) {
        commandActions[command]();
    }
});


// =================================================================================
// SECTION 3: UTILITY & SCRIPTING FUNCTIONS (No changes in this section)
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

/** This function is injected into the content script to display results. */
function displayResultOnPage(word, label, text, isDarkModeActive) {
    // This function's body is executed in the content script's context.
    // It cannot access any variables from the background script's scope.
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
    });
}

async function getFullSentenceForSelection(tabId, selectedText) {
    try {
        const [tabResult] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: (selectedText) => {
                // This function is executed in the content script's context.
                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                    return selectedText;
                }

                const range = selection.getRangeAt(0);
                let container = range.commonAncestorContainer;

                // 1. Find the nearest block-level parent element
                while (container && container.nodeType !== Node.ELEMENT_NODE) {
                    container = container.parentNode;
                }
                while (container && container !== document.body) {
                    const style = window.getComputedStyle(container);
                    if (['block', 'list-item', 'table-cell'].includes(style.display)) {
                        break; // Found a suitable block
                    }
                    container = container.parentNode;
                }
                container = container || document.body; // Fallback to body

                const blockText = container.innerText;
                if (!blockText) return selectedText;

                // 2. Find the position of the selected text within the block.
                const selectionIndex = blockText.indexOf(selectedText);
                if (selectionIndex === -1) {
                    return selectedText; // Fallback if selection isn't found (e.g., due to whitespace changes)
                }

                // 3. Find the start of the sentence by searching backwards.
                let sentenceStart = 0;
                for (let i = selectionIndex; i > 0; i--) {
                    if ('.!?'.includes(blockText[i])) {
                        sentenceStart = i + 1; // The sentence starts after the punctuation.
                        break;
                    }
                }

                // 4. Find the end of the sentence by searching forwards.
                let sentenceEnd = blockText.length;
                for (let i = selectionIndex + selectedText.length; i < blockText.length; i++) {
                    if ('.!?'.includes(blockText[i])) {
                        sentenceEnd = i + 1; // The sentence ends with the punctuation.
                        break;
                    }
                }
                
                // 5. Extract and clean up the sentence.
                const sentence = blockText.substring(sentenceStart, sentenceEnd).trim();

                return sentence.length > 0 ? sentence : selectedText;
            },
            args: [selectedText]
        });
        return tabResult?.result || selectedText;
    } catch (error) {
        console.error("Could not execute script to get full sentence:", error);
        return selectedText; // Fallback to the selected text itself
    }
}