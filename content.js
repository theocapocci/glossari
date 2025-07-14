// content.js
console.log("Glossari content script loaded!");

let isGlossariActive = false;

// --- STATE MANAGEMENT ---
function setGlossariState(isActive) {
    if (isActive) {
        if (!isGlossariActive) {
            document.body.addEventListener('mouseup', handleTextSelection);
            isGlossariActive = true;
        }
    } else {
        if (isGlossariActive) {
            document.body.removeEventListener('mouseup', handleTextSelection);
            isGlossariActive = false;
        }
    }
}

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        "updateState": (req) => setGlossariState(req.isActive),
        "showStatus": (req) => showStatusDisplay(req.status, req.message),
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
        console.error("Could not get initial state:", chrome.runtime.lastError.message);
    } else if (response) {
        setGlossariState(response.isActive);
    }
});

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

function showSentenceCardEditor(selectedWord, fullSentence) {
    const header = `<strong>Trim Selection</strong><span class="glossari-label">${selectedWord}</span>`;
    const body = `<div contenteditable="true">${fullSentence}</div>`;
    const footer = `<button id="glossari-cancel-btn">Cancel</button><button id="glossari-confirm-btn">Confirm</button>`;
    const displayDiv = createDisplayBox('glossari-display', header, body, footer);

    displayDiv.querySelector('#glossari-confirm-btn').addEventListener('click', () => {
        const trimmedSentence = displayDiv.querySelector('.glossari-body').innerText.trim();
        if (trimmedSentence) {
            chrome.runtime.sendMessage({
                action: "createSentenceFlashcard",
                selectedWord: selectedWord,
                trimmedSentence: trimmedSentence
            });
        }
        displayDiv.remove();
    });
    displayDiv.querySelector('#glossari-cancel-btn').addEventListener('click', () => displayDiv.remove());
}

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
                trimmedSentence: trimmedSentence
            });
        }
        displayDiv.remove();
    });
    displayDiv.querySelector('#glossari-cancel-btn').addEventListener('click', () => displayDiv.remove());
}

function showStatusDisplay(status, message) {
    const header = '<strong>Glossari</strong>';
    const displayDiv = createDisplayBox('glossari-display', header, message, null);
    displayDiv.style.border = `2px solid ${status === 'success' ? '#22c55e' : '#ef4444'}`;
    setTimeout(() => displayDiv.remove(), 7000);
}

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

    panel.querySelector('#glossari-create-sentence-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "createSentenceFlashcard", selectedWord: selectedWord });
        panel.remove();
    });

    panel.querySelector('#glossari-trim-sentence-btn').addEventListener('click', () => {
        panel.remove();
        chrome.runtime.sendMessage({ action: "getFullSentence", selectedWord: selectedWord }, (fullSentence) => {
            if (fullSentence) showSentenceCardEditor(selectedWord, fullSentence);
        });
    });

    panel.querySelector('#glossari-create-vocab-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "createVocabFlashcard", selectedWord: selectedWord });
        panel.remove();
    });

    panel.querySelector('#glossari-trim-vocab-btn').addEventListener('click', () => {
        panel.remove();
        chrome.runtime.sendMessage({ action: "getFullSentence", selectedWord: selectedWord }, (fullSentence) => {
            if (fullSentence) showVocabCardEditor(selectedWord, fullSentence);
        });
    });

    panel.querySelector('#glossari-panel-close-btn').addEventListener('click', () => panel.remove());
}

async function handleTextSelection(event) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (selectedText.length > 0 && selectedText.length < 1000) {
        // Pass more detailed selection info to background.js
        showSelectionActionPanel(selectedText, {
            startContainerPath: getXPath(range.startContainer), // A helper function to get a unique path to the node
            startOffset: range.startOffset,
            endContainerPath: getXPath(range.endContainer),
            endOffset: range.endOffset,
            // You might also want to send the outerHTML of a common ancestor for more robust context extraction
            commonAncestorHTML: range.commonAncestorContainer.outerHTML,
            commonAncestorPath: getXPath(range.commonAncestorContainer)
        });
    }
}


// Helper function to get an XPath (or similar unique identifier) for a DOM node.
// This is a complex problem in itself, a simpler approach might be to send
// the innerText of a common parent node and then find the selected text's
// start/end index within that text.
function getXPath(node) {
    // This is a simplified example; a real XPath generator would be more robust.
    // For now, let's just return the node's text content and its parent's tag name,
    // or you might iterate up to find a unique ID.
    if (node.id) return `//*[@id="${node.id}"]`;
    if (node.nodeType === Node.TEXT_NODE) return node.parentNode.tagName + ':text';
    return node.tagName;
}