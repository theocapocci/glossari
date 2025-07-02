// background.js

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
        if (tab) {
            chrome.tabs.sendMessage(tab.id, {
                action: "showStatus",
                status: status,
                message: message
            });
        }
    } catch (error) {
        console.error("Failed to send status message:", error);
    }
}

/**
 * Creates a persistent display box on the page for definitions or AI explanations.
 * This function is injected into the content script via scripting.executeScript.
 * @param {string} word - The selected word.
 * @param {string} label - The label for the box (e.g., 'Translation', 'AI Explanation').
 * @param {string} text - The main content (definition or explanation).
 */
function displayResultOnPage(word, label, text) {
    let glossariDisplay = document.getElementById('glossari-display');
    if (glossariDisplay) {
        glossariDisplay.remove();
    }

    glossariDisplay = document.createElement('div');
    glossariDisplay.id = 'glossari-display';
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
    });
}

/**
 * The core logic for creating an Anki flashcard.
 * @param {object} cardData - Contains selectedWord and fullSentence.
 */
async function createAnkiFlashcard({ selectedWord, fullSentence }) {
    try {
        const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
        if (!geminiApiKey) throw new Error("Gemini API Key is not set.");

        const model = "gemini-2.0-flash";
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const aiPrompt = `What is the meaning of the French word "${selectedWord}" as it is used in the sentence: "${fullSentence}"? Provide a concise, single-phrase English definition suitable for the back of an n+1 flashcard. Do not include any introductory phrases or additional context. Do not restate ${selectedWord}. Example: for 'maison', you would output 'house'`;

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
    console.log("Context menus created successfully.");
});

/**
 * Handles clicks on the context menu items.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "defineWord") {
        const selectedText = info.selectionText.trim();
        if (!selectedText) return;

        try {
            const langPair = 'fr|en'; // Assuming French to English, change if needed
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

            // Inject the function to display the result on the page
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Translation', definition]
            });

        } catch (error) {
            console.error("Glossari Definition Error:", error.message);
            // Display an error message on the page
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Error', `Definition Failed: ${error.message}`]
            });
        }
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
 * Listener for the keyboard shortcut.
 */
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "send-to-anki") {
        const { selectedWordForAnki, fullSentenceForAnki } = await chrome.storage.local.get(['selectedWordForAnki', 'fullSentenceForAnki']);
        if (selectedWordForAnki && fullSentenceForAnki) {
            await createAnkiFlashcard({
                selectedWord: selectedWordForAnki,
                fullSentence: fullSentenceForAnki
            });
            await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        } else {
            await sendStatusMessage('error', 'No word selected. Double-click a word first.');
        }
    }
});