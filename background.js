// background.js

// --- NEW: Import the utility function ---
import { convertMarkdownBoldToHtml } from './utils.js';

console.log("Glossari background service worker loaded with all features!");

// =================================================================================
// SECTION 1: HELPER FUNCTIONS
// =================================================================================

/**
 * Sends a temporary status message (success/error notification) to the content script.
 * @param {string} status - 'success' or 'error'
 * @param {string} message - The HTML message to display.
 */
async function sendStatusMessage(status, message) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            // Message the content script to show the status display
            chrome.tabs.sendMessage(tab.id, {
                action: "showStatus",
                status: status,
                message: message
            });
        }
    } catch (error) {
        console.error("Failed to send status message to content script:", error);
    }
}

/**
 * Creates a persistent display box on the page for definitions or AI explanations.
 * This function is injected into the content script via scripting.executeScript.
 * @param {string} word - The selected word/phrase (will be the highlighted text).
 * @param {string} label - The label for the box (e.g., 'Translation', 'AI Explanation').
 * @param {string} text - The main content (definition or explanation / translated sentence, now potentially with bold HTML).
 * @param {boolean} isDarkModeActive - NEW: Indicates if dark mode is active.
 */
function displayResultOnPage(word, label, text, isDarkModeActive) { // NEW: Added isDarkModeActive parameter
    let glossariDisplay = document.getElementById('glossari-display');
    if (glossariDisplay) {
        glossariDisplay.remove();
    }

    glossariDisplay = document.createElement('div');
    glossariDisplay.id = 'glossari-display';

    // NEW: Apply dark mode class if active
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
        <div class="glossari-body">
            ${text}
        </div>
    `;
    document.body.appendChild(glossariDisplay);

    document.getElementById('glossari-close-btn').addEventListener('click', () => {
        glossariDisplay.remove();
        // NEW: Clean up dark mode class from body when display box is closed
        if (!document.querySelector('#glossari-display')) { // Only remove if no other display is active
            document.body.classList.remove('dark-mode');
        }
    });
}

/**
 * The core logic for creating an Anki flashcard.
 * @param {object} cardData - Contains selectedWord (now selected text/phrase) and fullSentence.
 */
async function createAnkiFlashcard({ selectedWord, fullSentence }) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");

        const model = "gemini-2.0-flash";
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const aiPrompt = `What is the meaning of the French phrase or word "${selectedWord}" as it is used in the sentence: "${fullSentence}"? Provide a concise, single-phrase English definition suitable for the back of an n+1 flashcard. Do not include any introductory phrases or additional context. Do not restate ${selectedWord}. Example: for 'maison', you would output 'house'. Example: for 'bonjour tout le monde', you would output 'hello everyone'`;

        const aiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: aiPrompt }] }] })
        });
        const aiData = await aiResponse.json();
        if (!aiResponse.ok || !aiData.candidates) throw new Error(aiData.error?.message || "AI API request failed.");

        let definition = aiData.candidates[0].content.parts[0].text.trim();
        definition = definition.toLowerCase();

        const ankiFront = fullSentence;
        const ankiBack = `<strong>${selectedWord}</strong> = ${definition}`;
        const ankiPayload = {
            action: "addNote",
            version: 6,
            params: {
                note: {
                    deckName: "Glossari",
                    modelName: "Obsidian-basic",
                    fields: { "Front": ankiFront, "Back": ankiBack },
                    tags: ["français"]
                }
            }
        };

        const ankiResultResponse = await fetch("http://127.0.0.1:8765", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ankiPayload)
        });
        const ankiResult = await ankiResultResponse.json();

        if (ankiResult.error) throw new Error(`AnkiConnect: ${ankiResult.error}`);

        console.log("Anki card added successfully:", ankiResult.result);
        await sendStatusMessage('success', `Anki card for "<strong>${selectedWord}</strong>" created!`);

    } catch (error) {
        console.error("Glossari Flashcard Creation Error:", error.message);
        await sendStatusMessage('error', `Error: ${error.message}`);
    }
}

/**
 * Handles the MyMemory definition logic.
 * This is factored out so it can be called from both context menu and shortcut.
 * @param {string} selectedText - The text to define.
 * @param {number} tabId - The ID of the active tab.
 */
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

        // NEW: Fetch dark mode preference
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'Translation', definition, isDarkMode] // NEW: Pass isDarkMode
        });

    } catch (error) {
        console.error("Glossari Definition Error (MyMemory):", error.message);
        // NEW: Fetch dark mode preference for error display
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'Error', `Definition Failed: ${error.message}`, isDarkMode] // NEW: Pass isDarkMode
        });
    }
}

/**
 * Handles the Gemini sentence translation logic.
 * This is factored out so it can be called from both context menu and shortcut.
 * @param {string} selectedText - The text selected by the user.
 * @param {string} fullSentence - The full sentence context.
 * @param {number} tabId - The ID of the active tab.
 */
async function handleTranslateGemini(selectedText, fullSentence, tabId) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");

        const model = "gemini-2.0-flash";
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

        // The prompt asks Gemini to directly include HTML <strong> tags.
        const translationPrompt = `Translate the following French sentence into English: "${fullSentence}". In the translated sentence, please make the English translation of "${selectedText}" bold using HTML <strong> tags. Provide only the translated sentence, without any additional text, quotes, or introductory phrases.`;

        const aiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: translationPrompt }] }] })
        });
        const aiData = await aiResponse.json();

        if (!aiResponse.ok || !aiData.candidates) throw new Error(aiData.error?.message || "Gemini API request failed for translation.");

        let fullSentenceTranslatedAndBolded = aiData.candidates[0].content.parts[0].text.trim();

        // Convert any remaining Markdown bold (e.g., **text**) to HTML strong (<strong>text</strong>)
        // in case Gemini sometimes defaults to Markdown despite the prompt.
        fullSentenceTranslatedAndBolded = convertMarkdownBoldToHtml(fullSentenceTranslatedAndBolded);

        // NEW: Fetch dark mode preference
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'Translation', fullSentenceTranslatedAndBolded, isDarkMode] // NEW: Pass isDarkMode
        });

    } catch (error) {
        console.error("Glossari Sentence Translation Error:", error.message);
        // NEW: Fetch dark mode preference for error display
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, 'Error', `Sentence Translation Failed: ${error.message}`, isDarkMode] // NEW: Pass isDarkMode
        });
    }
}

// =================================================================================
// SECTION 2: LISTENERS
// =================================================================================

/**
 * Fires when the extension is installed or updated.
 * Creates the right-click context menus.
 */
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "glossariParent",
        title: "Glossari",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "defineWord",
        title: "Define '%s' (MyMemory)",
        parentId: "glossariParent",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "sendSelectionToAnki",
        title: "Send '%s' to Anki",
        parentId: "glossariParent",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "translateSentenceGemini",
        title: "Translate Sentence (Gemini)",
        parentId: "glossariParent",
        contexts: ["selection"]
    });
    console.log("Context menus created successfully.");
});

/**
 * Handles clicks on the context menu items.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
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

            // This fallback logic to get the full sentence is important if the user
            // right-clicks immediately without a 'mouseup' event firing in content.js first.
            if (!fullSentence) {
                const [tabResult] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: () => {
                        const selection = window.getSelection();
                        if (selection.rangeCount === 0) return null;
                        const range = selection.getRangeAt(0);

                        // Re-define getFullSentenceContext locally for the injected script
                        function getFullSentenceContext(selRange) {
                            let container = selRange.startContainer;
                            while (container && container.nodeType !== Node.ELEMENT_NODE) {
                                container = container.parentNode;
                            }
                            if (!container) return selRange.toString();

                            let parent = container;
                            while (parent && parent !== document.body) {
                                const tagName = parent.tagName.toLowerCase();
                                if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'blockquote', 'td', 'th', 'article', 'section'].includes(tagName)) {
                                    return parent.innerText.replace(/\s+/g, ' ').trim();
                                }
                                parent = parent.parentNode;
                            }
                            return selRange.toString();
                        }
                        return getFullSentenceContext(range);
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

        // Fallback if fullSentenceForAnki wasn't set (duplicate but necessary for context menu)
        if (!fullSentence) {
            const [tabResult] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: () => {
                    const selection = window.getSelection();
                    if (selection.rangeCount === 0) return null;
                    const range = selection.getRangeAt(0);

                    // Re-define getFullSentenceContext locally for the injected script
                    function getFullSentenceContext(selRange) {
                        let container = selRange.startContainer;
                        while (container && container.nodeType !== Node.ELEMENT_NODE) {
                            container = container.parentNode;
                        }
                        if (!container) return selRange.toString();

                        let parent = container;
                        while (parent && parent !== document.body) {
                            const tagName = parent.tagName.toLowerCase();
                            if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'blockquote', 'td', 'th', 'article', 'section'].includes(tagName)) {
                                return parent.innerText.replace(/\s+/g, ' ').trim();
                            }
                            parent = parent.parentNode;
                        }
                        return selRange.toString();
                    }
                    return getFullSentenceContext(range);
                }
            });
            fullSentence = tabResult?.result || selectedText;
        }

        // Add a check to ensure fullSentence isn't empty or just selectedText if it shouldn't be
        if (!fullSentence || fullSentence.length < selectedText.length) {
            fullSentence = selectedText; // Fallback to just selected text for translation
            await sendStatusMessage('error', 'Could not determine full sentence context for translation. Translating selected text only.');
        }

        // Pass selectedText and potentially resolved fullSentence to the handler
        await handleTranslateGemini(selectedText, fullSentence, tab.id);
    }
});

/**
 * Listener for messages from the popup button.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "createAnkiFlashcard") {
        createAnkiFlashcard(request);
        return true; // Indicates an asynchronous response
    }
});

/**
 * Listener for the keyboard shortcuts.
 */
chrome.commands.onCommand.addListener(async (command) => {
    const { selectedWordForAnki, fullSentenceForAnki } = await chrome.storage.local.get(['selectedWordForAnki', 'fullSentenceForAnki']);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Ensure we have a valid tab before proceeding, as tab could be null/undefined in rare cases.
    if (!tab || !tab.id) {
        console.warn('No active tab found for command:', command);
        return;
    }

    // A single, comprehensive check for selection existence for all commands
    if (!selectedWordForAnki || !fullSentenceForAnki) {
        await sendStatusMessage('error', 'No text selected. Please highlight a word or phrase first.');
        return;
    }

    // Now, execute command-specific logic
    if (command === "send-to-anki") {
        await createAnkiFlashcard({
            selectedWord: selectedWordForAnki,
            fullSentence: fullSentenceForAnki
        });
        // Clear storage only after the Anki card is created successfully, as it's the "final" action
        await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
    } else if (command === "define-selected-text") {
        await handleDefineMyMemory(selectedWordForAnki, tab.id);
        // Do NOT clear storage here, as the user might want to use the same selection for another action.
    } else if (command === "translate-sentence") {
        await handleTranslateGemini(selectedWordForAnki, fullSentenceForAnki, tab.id);
        // Do NOT clear storage here, as the user might want to use the same selection for another action.
    }
});