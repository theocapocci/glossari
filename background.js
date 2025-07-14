// background.js

import { convertMarkdownBoldToHtml, callGeminiAPI } from './utils.js';
import { createSentenceFlashcard, createVocabFlashcard } from './anki.js';

console.log("Glossari background service worker loaded!");

// =================================================================================
// SECTION 0: STATE MANAGEMENT & INITIALIZATION
// =================================================================================

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

async function handleCardCreation(cardCreator, cardData, tabId) {
    try {
        const { geminiApiKey, sentenceDeck, vocabDeck, contextSentences = 1 } = await chrome.storage.local.get(['geminiApiKey', 'sentenceDeck', 'vocabDeck', 'contextSentences']);
        if (!geminiApiKey) throw new Error("Gemini API Key is not set. Please set it in the Glossari settings.");

        const { fullSentence, contextualBlock } = await getTextFromPageForSelection(tabId, cardData.selectedWord, contextSentences);

        // --- DEBUGGING LOGS ---
        console.log("--- Glossari Debug: Data from Page ---");
        console.log("Selected Word:", cardData.selectedWord);
        console.log("Full Sentence:", fullSentence);
        console.log("Contextual Block:", contextualBlock);
        // --- END DEBUGGING LOGS ---

        // FIX: Pass 'fullSentence' with the correct name.
        const completeCardData = {
            selectedWord: cardData.selectedWord,
            contextualBlock: contextualBlock,
            fullSentence: fullSentence, // This is the single sentence.
            trimmedSentence: cardData.trimmedSentence,
            sentence: cardData.sentence,
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
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedText)}&langpair=fr|en`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`MyMemory API request failed: ${response.status}`);
        const data = await response.json();
        if (data.responseStatus !== 200) throw new Error(data.responseDetails || "MyMemory API error.");
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
        await sendStatusMessage('error', `Definition Failed: ${error.message}`);
    }
}

async function handleTranslateGemini(selectedText, sentenceToTranslate, tabId) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");
        const translationPrompt = `Translate the following French sentence into English: "${sentenceToTranslate}". Provide only the translated sentence.`;
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
    // Make sure this command name matches the one in your manifest.json
    if (command === "translate-sentence") {
        try {
            // We need to get the selected text from the page
            const [injectionResult] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.getSelection().toString(),
            });

            const selectedText = injectionResult.result ? injectionResult.result.trim() : "";
            
            if (!selectedText) {
                await sendStatusMessage('error', 'Please select text to translate.');
                return;
            }

            // Use the existing function to get the full sentence
            const { fullSentence } = await getTextFromPageForSelection(tab.id, selectedText, 0);
            
            if (fullSentence) {
                // Call the existing translation handler
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
            getTextFromPageForSelection(sender.tab.id, req.selectedWord, 0)
                .then(result => sendResponse(result.fullSentence));
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

async function getTextFromPageForSelection(tabId, selectedText, contextSentences = 0, selectionDetails = null) {
    try {
        const [tabResult] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (selectedText, contextSentences, details) => {
                const selection = window.getSelection();
                let fullSentence = selectedText;
                let contextualBlock = selectedText;

                if (details && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);

                    // Reconstruct the full text from the common ancestor, or the whole body
                    const commonAncestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
                    const allText = commonAncestor.innerText; // or document.body.innerText if commonAncestor is too small

                    // Find the precise start and end index of the *current selection*
                    const preSelectionRange = range.cloneRange();
                    preSelectionRange.selectNodeContents(commonAncestor);
                    preSelectionRange.setEnd(range.startContainer, range.startOffset);
                    const startIndex = preSelectionRange.toString().length;
                    const endIndex = startIndex + selectedText.length;

                    // Now, use these indices to find the correct sentence/context
                    const sentences = allText.match(/[^.!?]+[.!?]+/g) || [allText];
                    let targetSentenceIndex = -1;
                    let charCount = 0;

                    for(let i=0; i<sentences.length; i++) {
                        if(startIndex >= charCount && startIndex < charCount + sentences[i].length) {
                            targetSentenceIndex = i;
                            break;
                        }
                        charCount += sentences[i].length;
                    }

                    if (targetSentenceIndex !== -1) {
                        fullSentence = sentences[targetSentenceIndex].trim();
                        const start = Math.max(0, targetSentenceIndex - contextSentences);
                        const end = Math.min(sentences.length, targetSentenceIndex + contextSentences + 1);
                        contextualBlock = sentences.slice(start, end).join(' ').trim();
                    }
                } else {
                    // Fallback to original logic if selectionDetails are not provided or invalid
                    const allText = document.body.innerText;
                    const selectionIndex = allText.indexOf(selectedText); // This is the problematic part for duplicates
                    if (selectionIndex !== -1) {
                         const sentences = allText.match(/[^.!?]+[.!?]+/g) || [allText];
                        let targetSentenceIndex = -1;
                        let charCount = 0;
                        for(let i=0; i<sentences.length; i++) {
                            if(selectionIndex >= charCount && selectionIndex < charCount + sentences[i].length) {
                                targetSentenceIndex = i;
                                break;
                            }
                            charCount += sentences[i].length;
                        }
                        if (targetSentenceIndex !== -1) {
                            fullSentence = sentences[targetSentenceIndex].trim();
                            const start = Math.max(0, targetSentenceIndex - contextSentences);
                            const end = Math.min(sentences.length, targetSentenceIndex + contextSentences + 1);
                            contextualBlock = sentences.slice(start, end).join(' ').trim();
                        }
                    }
                }
                return { fullSentence, contextualBlock };
            },
            args: [selectedText, contextSentences, selectionDetails] // Pass the details here
        });
        return tabResult?.result || { fullSentence: selectedText, contextualBlock: selectedText };
    } catch (error) {
        console.error("Could not execute script to get text from page:", error);
        return { fullSentence: selectedText, contextualBlock: selectedText };
    }
}