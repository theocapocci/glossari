// content.js
console.log("Glossari content script loaded!");

let isGlossariActive = false; // By default, the script is dormant

// --- STATE MANAGEMENT ---
function setGlossariState(isActive) {
    if (isActive) {
        // Add the listener if it's not already there
        if (!isGlossariActive) {
            document.body.addEventListener('mouseup', handleTextSelection);
            isGlossariActive = true;
            console.log("Glossari activated on this page.");
        }
    } else {
        // Remove the listener if it exists
        if (isGlossariActive) {
            document.body.removeEventListener('mouseup', handleTextSelection);
            isGlossariActive = false;
            console.log("Glossari deactivated on this page.");
        }
    }
}

// --- MESSAGE LISTENER ---
// Listens for messages from the background script.
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
// When the script first loads, ask the background script for the current state
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
    // Remove any previous popup to avoid duplicates
    let existingPopup = document.getElementById('glossari-activation-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const popup = document.createElement('div');
    popup.id = 'glossari-activation-popup';
    const message = `Glossari is now <strong>${isActive ? 'ON' : 'OFF'}</strong>`;

    popup.innerHTML = `
        <span>${message}</span>
        <button class="close-btn" title="Dismiss">&times;</button>
    `;

    document.body.appendChild(popup);

    const closeBtn = popup.querySelector('.close-btn');

    // Set a timer to remove the element from the DOM after the animation completes
    const removalTimeout = setTimeout(() => {
        if (popup.parentNode) {
            popup.remove();
        }
    }, 4000); // 4 seconds total duration

    // If the user clicks the 'x', remove it immediately and clear the timer
    closeBtn.addEventListener('click', () => {
        clearTimeout(removalTimeout);
        if (popup.parentNode) {
            popup.remove();
        }
    });
}

function createDisplayBox(id, headerContent, bodyContent, footerContent) {
    const existingDisplay = document.getElementById(id);
    if (existingDisplay) {
        existingDisplay.remove();
    }

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
 * Displays an editable box for trimming the sentence for the front of a sentence card.
 * @param {string} selectedWord - The word or phrase the user highlighted.
 * @param {string} fullSentence - The full sentence context.
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
                action: "createAnkiFlashcard",
                selectedWord: selectedWord,
                fullSentence: fullSentence,
                frontContent: trimmedSentence
            });
        }
        displayDiv.remove();
    });

    displayDiv.querySelector('#glossari-cancel-btn').addEventListener('click', () => {
        displayDiv.remove();
    });
}

/**
 * Displays an editor for the back of a vocab card.
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

    displayDiv.querySelector('#glossari-cancel-btn').addEventListener('click', () => {
        displayDiv.remove();
    });
}

/**
 * Displays a status notification box in the bottom-right corner of the page.
 * @param {string} status - 'success' or 'error'.
 * @param {string} message - The HTML message to display inside the box.
 */
function showStatusDisplay(status, message) {
    const header = '<strong>Glossari</strong>';
    const displayDiv = createDisplayBox('glossari-display', header, message, null);
    const borderColor = status === 'success' ? '#22c55e' : '#ef4444';
    displayDiv.style.border = `2px solid ${borderColor}`;

    setTimeout(() => {
        if (displayDiv.parentNode) {
            displayDiv.remove();
        }
    }, 7000);
}

/**
 * Shows an action panel after text is selected.
 * @param {string} selectedWord
 * @param {string} fullSentence
 */
function showSelectionActionPanel(selectedWord, fullSentence) {
    const elementsToRemove = ['glossari-display', 'glossari-activation-popup', 'glossari-selection-panel'];
    elementsToRemove.forEach(id => {
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
        </div>
    `;
    panel.querySelector('.glossari-panel-header strong').textContent = selectedWord;

    document.body.appendChild(panel);

    // --- Event Listeners ---
    document.getElementById('glossari-create-sentence-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({
            action: "createAnkiFlashcard",
            selectedWord: selectedWord,
            fullSentence: fullSentence
        });
        panel.remove();
    });

    document.getElementById('glossari-trim-sentence-btn').addEventListener('click', () => {
        panel.remove();
        showAnkiTrimmer(selectedWord, fullSentence);
    });

    document.getElementById('glossari-create-vocab-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({
            action: "createVocabFlashcard",
            selectedWord: selectedWord,
            sentence: fullSentence
        });
        panel.remove();
    });

    document.getElementById('glossari-trim-vocab-btn').addEventListener('click', () => {
        panel.remove();
        showVocabCardEditor(selectedWord, fullSentence);
    });

    document.getElementById('glossari-panel-close-btn').addEventListener('click', () => {
        panel.remove();
    });
}


/**
 * Main handler to capture selected text and its sentence context.
 * @param {MouseEvent} event
 */
async function handleTextSelection(event) {
    if (event.target.closest('#glossari-display, #glossari-selection-panel')) {
        return;
    }
    if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.isContentEditable) {
        await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        return;
    }

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length > 0 && selectedText.length < 1000) {
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        if (!range) return;

        let parentElement = range.startContainer.parentElement;
        while (parentElement) {
            const tagName = parentElement.tagName;
            if (['P', 'DIV', 'LI', 'ARTICLE', 'SECTION', 'TD', 'H1', 'H2', 'H3', 'BLOCKQUOTE'].includes(tagName)) {
                break;
            }
            if (parentElement.tagName === 'BODY') break;
            parentElement = parentElement.parentElement;
        }

        if (!parentElement) {
             parentElement = selection.getRangeAt(0).commonAncestorContainer;
             if (parentElement.nodeType !== Node.ELEMENT_NODE) {
                 parentElement = parentElement.parentElement;
             }
        }

        const fullSentence = parentElement ? parentElement.textContent || "" : selectedText;


        await chrome.storage.local.set({
            selectedWordForAnki: selectedText,
            fullSentenceForAnki: fullSentence
        });
        showSelectionActionPanel(selectedText, fullSentence);
    } else {
        await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
    }
}