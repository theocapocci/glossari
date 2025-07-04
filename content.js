// content.js
console.log("Glossari content script loaded!");

let isGlossariActive = false; // By default, the script is dormant

// --- STATE MANAGEMENT ---
function setGlossariState(isActive) {
    if (isActive) {
        if (!isGlossariActive) {
            document.body.addEventListener('mouseup', handleTextSelection);
            isGlossariActive = true;
            console.log("Glossari activated on this page.");
        }
    } else {
        if (isGlossariActive) {
            document.body.removeEventListener('mouseup', handleTextSelection);
            isGlossariActive = false;
            console.log("Glossari deactivated on this page.");
        }
    }
}

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        "updateState": (req) => setGlossariState(req.isActive),
        "showStatus": (req) => showStatusDisplay(req.status, req.message),
        "showAnkiTrimmer": (req) => showAnkiTrimmer(req.selectedWord, req.fullSentence),
        "showActivationPopup": (req) => showActivationPopup(req.isActive)
    };

    if (actions[request.action]) {
        actions[request.action](request);
        sendResponse({ success: true });
    }
});

// --- INITIALIZATION ---
chrome.runtime.sendMessage({ action: "getInitialState" }, (response) => {
    if (chrome.runtime.lastError) {
        console.error("Could not get initial state:", chrome.runtime.lastError);
    } else if (response) {
        setGlossariState(response.isActive);
    }
});


/**
 * Displays a temporary notification that the extension has been turned on or off.
 * @param {boolean} isActive - The new state of the extension.
 */
function showActivationPopup(isActive) {
    let existingPopup = document.getElementById('glossari-activation-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.id = 'glossari-activation-popup';
    popup.innerHTML = `<span>Glossari is now <strong>${isActive ? 'ON' : 'OFF'}</strong></span><button class="close-btn" title="Dismiss">&times;</button>`;
    document.body.appendChild(popup);

    const closeBtn = popup.querySelector('.close-btn');
    const removalTimeout = setTimeout(() => popup.remove(), 4000);
    closeBtn.addEventListener('click', () => {
        clearTimeout(removalTimeout);
        popup.remove();
    });
}

function createDisplayBox(id, headerContent, bodyContent, footerContent) {
    const existingDisplay = document.getElementById(id);
    if (existingDisplay) existingDisplay.remove();

    const displayDiv = document.createElement('div');
    displayDiv.id = id;
    displayDiv.innerHTML = `
        <div class="glossari-header">${headerContent}</div>
        <div class="glossari-body">${bodyContent}</div>
        ${footerContent ? `<div class="glossari-footer">${footerContent}</div>` : ''}
    `;
    document.body.appendChild(displayDiv);
    return displayDiv;
}

/**
 * Displays an editable box for trimming the sentence for a sentence card.
 * @param {string} selectedWord
 * @param {string} fullSentence
 */
function showAnkiTrimmer(selectedWord, fullSentence) {
    const header = `<strong>Trim Sentence Card Front</strong><span class="glossari-label">${selectedWord}</span>`;
    const body = `<div contenteditable="true">${fullSentence}</div>`;
    const footer = `<button id="glossari-cancel-btn">Cancel</button><button id="glossari-confirm-btn">Confirm</button>`;
    const displayDiv = createDisplayBox('glossari-display', header, body, footer);

    displayDiv.querySelector('#glossari-confirm-btn').addEventListener('click', () => {
        const trimmedSentence = displayDiv.querySelector('.glossari-body').innerText.trim();
        if (trimmedSentence) {
            chrome.runtime.sendMessage({
                action: "createSentenceFlashcard",
                selectedWord: selectedWord,
                frontContent: trimmedSentence
            });
        }
        displayDiv.remove();
    });
    displayDiv.querySelector('#glossari-cancel-btn').addEventListener('click', () => displayDiv.remove());
}

/**
 * Displays an editor for trimming the sentence for a vocab card.
 * @param {string} selectedWord
 * @param {string} fullSentence
 */
function showVocabCardEditor(selectedWord, fullSentence) {
    const header = `<strong>Trim Vocab Card Sentence</strong><span class="glossari-label">${selectedWord}</span>`;
    const body = `<div contenteditable="true">${fullSentence}</div>`;
    const footer = `<button id="glossari-cancel-btn">Cancel</button><button id="glossari-confirm-btn">Create Vocab Card</button>`;
    const displayDiv = createDisplayBox('glossari-display', header, body, footer);

    displayDiv.querySelector('#glossari-confirm-btn').addEventListener('click', () => {
        const trimmedSentence = displayDiv.querySelector('.glossari-body').innerText.trim();
        if (trimmedSentence) {
            chrome.runtime.sendMessage({
                action: "createVocabFlashcard",
                selectedWord: selectedWord,
                sentence: trimmedSentence
            });
        }
        displayDiv.remove();
    });
    displayDiv.querySelector('#glossari-cancel-btn').addEventListener('click', () => displayDiv.remove());
}

/**
 * Displays a status notification box.
 * @param {string} status - 'success' or 'error'.
 * @param {string} message
 */
function showStatusDisplay(status, message) {
    const header = '<strong>Glossari</strong>';
    const displayDiv = createDisplayBox('glossari-display', header, message, null);
    displayDiv.style.border = `2px solid ${status === 'success' ? '#22c55e' : '#ef4444'}`;
    setTimeout(() => displayDiv.remove(), 7000);
}

/**
 * Shows the main action panel after text is selected.
 * @param {string} selectedWord
 */
function showSelectionActionPanel(selectedWord) {
    ['glossari-display', 'glossari-activation-popup', 'glossari-selection-panel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    const panel = document.createElement('div');
    panel.id = 'glossari-selection-panel';
    panel.innerHTML = `
        <div class="glossari-panel-header">
            <span>Selected: <strong></strong></span>
            <button id="glossari-panel-close-btn" title="Close">&times;</button>
        </div>
        <div class="glossari-panel-body">
            <div class="glossari-button-group">
                <button id="glossari-create-sentence-btn">Create Sentence Card</button>
                <button id="glossari-trim-sentence-btn" title="Trim sentence before creating">✂️</button>
            </div>
            <div class="glossari-button-group" style="margin-top: 8px;">
                <button id="glossari-create-vocab-btn">Create Vocab Card</button>
                <button id="glossari-trim-vocab-btn" title="Trim sentence before creating">✂️</button>
            </div>
        </div>`;
    panel.querySelector('.glossari-panel-header strong').textContent = selectedWord;
    document.body.appendChild(panel);

    // --- Event Listeners ---
    panel.querySelector('#glossari-create-sentence-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "createSentenceFlashcard", selectedWord: selectedWord });
        panel.remove();
    });

    panel.querySelector('#glossari-trim-sentence-btn').addEventListener('click', async () => {
        panel.remove();
        // Ask the background script for the sentence, then show trimmer
        chrome.runtime.sendMessage({ action: "getFullSentence", selectedWord: selectedWord }, (fullSentence) => {
            if (fullSentence) {
                showAnkiTrimmer(selectedWord, fullSentence);
            }
        });
    });

    panel.querySelector('#glossari-create-vocab-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "createVocabFlashcard", selectedWord: selectedWord });
        panel.remove();
    });

    panel.querySelector('#glossari-trim-vocab-btn').addEventListener('click', async () => {
        panel.remove();
        // Ask the background script for the sentence, then show editor
        chrome.runtime.sendMessage({ action: "getFullSentence", selectedWord: selectedWord }, (fullSentence) => {
            if (fullSentence) {
                showVocabCardEditor(selectedWord, fullSentence);
            }
        });
    });

    panel.querySelector('#glossari-panel-close-btn').addEventListener('click', () => panel.remove());
}

/**
 * Main handler to capture selected text.
 * @param {MouseEvent} event
 */
async function handleTextSelection(event) {
    if (event.target.closest('#glossari-display, #glossari-selection-panel')) return;
    if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.isContentEditable) {
        await chrome.storage.local.remove('selectedWordForAnki');
        return;
    }

    const selectedText = window.getSelection().toString().trim();

    if (selectedText.length > 0 && selectedText.length < 1000) {
        // Store the selected text for keyboard shortcuts to use
        await chrome.storage.local.set({ selectedWordForAnki: selectedText });
        showSelectionActionPanel(selectedText);
    } else {
        await chrome.storage.local.remove('selectedWordForAnki');
    }
}
