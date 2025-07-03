// background.js

// --- NEW: Import the utility function ---
import { convertMarkdownBoldToHtml } from './utils.js';

console.log("Glossari background service worker loaded with all features!");

// =================================================================================
// SECTION 0: STATE MANAGEMENT & TOGGLE
// =================================================================================

// Function to update the icon based on the current state
async function updateIcon(isActive) {
    const iconPaths = isActive
        ? {
            "16": "icons/icon-active16.png",
            "48": "icons/icon-active48.png",
            "128": "icons/icon-active128.png"
          }
        : {
            "16": "icons/icon16.png",
            "48": "icons/icon48.png",
            "128": "icons/icon128.png"
          };
          
    try {
        await chrome.action.setIcon({ path: iconPaths });
    } catch (error) {
        console.warn("Could not set active icon. Make sure all icon sizes exist in the 'icons' folder.");
    }
}

// When the extension is installed, initialize the state to 'off' and create menus
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isGlossariActive: false });
    updateIcon(false);
    
    // --- CONTEXT MENU CREATION (REFACTORED) ---
    
    // 1. Context menus for text selection on a webpage
    chrome.contextMenus.create({
        id: "defineWord",
        title: "Define '%s' (MyMemory)",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "sendSelectionToAnki",
        title: "Send '%s' to Anki",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "translateSentenceGemini",
        title: "Translate Sentence for '%s'",
        contexts: ["selection"]
    });

    // 2. Context menu for the extension's toolbar icon (action)
    chrome.contextMenus.create({
        id: "glossariSettings",
        title: "Glossari Settings",
        contexts: ["action"] // This attaches the menu to the icon right-click
    });
    console.log("Context menus created successfully.");
});

// Listener for the browser action (the icon click)
chrome.action.onClicked.addListener(async (tab) => {
    const { isGlossariActive } = await chrome.storage.local.get('isGlossariActive');
    const newState = !isGlossariActive;
    
    await chrome.storage.local.set({ isGlossariActive: newState });
    await updateIcon(newState);
    
    // Notify the content script in the active tab to update its state
    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "updateState", isActive: newState });
        
        // NEW: Send a message to the content script to show the activation/deactivation popup
        chrome.tabs.sendMessage(tab.id, { action: "showActivationPopup", isActive: newState });
    }
});


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
 * @param {object} cardData - Contains selectedWord, fullSentence (for AI context), 
 * and frontContent (for the card front).
 */
async function createAnkiFlashcard({ selectedWord, fullSentence, frontContent }) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");
        
        // Use the full sentence for the AI prompt to get the best context.
        const contextForAI = fullSentence;
        // Use the (potentially trimmed) frontContent for the Anki card. Default to full sentence if not provided.
        const ankiFront = frontContent || fullSentence;

        const model = "gemini-2.0-flash";
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const aiPrompt = `What is the meaning of the French phrase or word "${selectedWord}" as it is used in the sentence: "${contextForAI}"? Provide a concise, single-phrase English definition suitable for the back of an n+1 flashcard. Do not include any introductory phrases or additional context. Do not restate ${selectedWord}. Example: for 'maison', you would output 'house'. Example: for 'bonjour tout le monde', you would output 'hello everyone'`;

        const aiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: aiPrompt }] }] })
        });
        const aiData = await aiResponse.json();
        if (!aiResponse.ok || !aiData.candidates) throw new Error(aiData.error?.message || "AI API request failed.");

        let definition = aiData.candidates[0].content.parts[0].text.trim();
        definition = definition.toLowerCase();

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
            args: [selectedText, 'MyMemory', definition, isDarkMode] // NEW: Pass isDarkMode
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
            // ***FIXED***: Changed aiPrompt to the correct variable name, translationPrompt
            body: JSON.stringify({ contents: [{ parts: [{ text: translationPrompt }] }] })
        });
        const aiData = await aiResponse.json();
        if (!aiResponse.ok || !aiData.candidates) throw new Error(aiData.error?.message || "AI API request failed for translation.");

        let fullSentenceTranslatedAndBolded = aiData.candidates[0].content.parts[0].text.trim();

        // Convert any remaining Markdown bold (e.g., **text**) to HTML strong (<strong>text</strong>)
        // in case Gemini sometimes defaults to Markdown despite the prompt.
        fullSentenceTranslatedAndBolded = convertMarkdownBoldToHtml(fullSentenceTranslatedAndBolded);

        // NEW: Fetch dark mode preference
        const { isDarkMode } = await chrome.storage.local.get('isDarkMode');

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: displayResultOnPage,
            args: [selectedText, model, fullSentenceTranslatedAndBolded, isDarkMode] // NEW: Pass isDarkMode
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
 * Handles clicks on the context menu items.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Handle the settings menu item first, as it should always be available.
    if (info.menuItemId === "glossariSettings") {
        // This opens the popup.html file as a settings page in a new tab.
        chrome.tabs.create({ url: 'popup.html' });
        return;
    }
    
    // All other context menu items should only work if the extension is active
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
            
            // For context menu, there's no trimming, so frontContent is the same as fullSentence
            await createAnkiFlashcard({
                selectedWord: selectedText,
                fullSentence: fullSentence
                // frontContent is omitted, so it will default to fullSentence in the function
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
                        return getFullSentenceContext(range);
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
 * Listener for messages from the popup or content script.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // This now handles requests from the trimmer UI and the main popup
    if (request.action === "createAnkiFlashcard") {
        createAnkiFlashcard(request).then(() => {
            // Clean up storage after the card is created
            chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        });
        return true; // Indicates an asynchronous response
    }
    // New: Listen for content script asking for initial state
    else if (request.action === "getInitialState") {
        chrome.storage.local.get('isGlossariActive').then(data => {
            sendResponse({ isActive: data.isGlossariActive });
        });
        return true; // Required for async response
    }
});


/**
 * Listener for the keyboard shortcuts.
 */
chrome.commands.onCommand.addListener(async (command) => {
    // Commands should only work if the extension is active
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
        // Send a message to the content script to show the trimmer UI on the page.
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
