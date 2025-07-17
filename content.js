// content.js
console.log("Glossari content script loaded!");

let isGlossariActive = false;
let touchTimeout;
let touchStartX, touchStartY;
const LONG_PRESS_THRESHOLD = 500; // milliseconds
const MOVE_TOLERANCE = 10; // pixels
let waitingForLongPressSelection = false; // New state variable for touch selection

// --- STATE MANAGEMENT ---
function setGlossariState(isActive) {
    if (isActive) {
        if (!isGlossariActive) {
            document.body.addEventListener('mouseup', handleTextSelection);
            // Add touch event listeners for long press
            document.body.addEventListener('touchstart', handleTouchStart, { passive: true });
            document.body.addEventListener('touchend', handleTouchEnd);
            document.body.addEventListener('touchmove', handleTouchMove);
            document.addEventListener('selectionchange', handleSelectionChange); // Listen for native selection changes
            isGlossariActive = true;
        }
    } else {
        if (isGlossariActive) {
            document.body.removeEventListener('mouseup', handleTextSelection);
            // Remove touch event listeners
            document.body.removeEventListener('touchstart', handleTouchStart);
            document.body.removeEventListener('touchend', handleTouchEnd);
            document.body.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('selectionchange', handleSelectionChange);
            isGlossariActive = false;
            // Remove any visible Glossari UI elements when deactivated
            document.getElementById('glossari-selection-panel')?.remove();
            document.getElementById('glossari-display')?.remove();
        }
    }
}

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        "updateState": (req) => setGlossariState(req.isActive),
        "showStatus": (req) => showStatusDisplay(req.status, req.message),
        "showActivationPopup": (req) => showActivationPopup(req.isActive),
        "myMemoryDefinitionResponse": (req) => {
            const panel = document.getElementById('glossari-selection-panel');
            if (panel && panel.querySelector('.glossari-panel-header strong').textContent === req.selectedText) {
                const definitionDiv = panel.querySelector('.mymemory-definition');
                if (definitionDiv) {
                    if (req.error) {
                        // Graceful and smaller error message for when a definition isn't found.
                        definitionDiv.innerHTML = `<span style="font-size: 0.8em; color: var(--glossari-label-color);">No definition found.</span>`;
                    } else {
                        // Update with the definition if found.
                        definitionDiv.innerHTML = `≈ ${req.definition}`;
                    }
                }
            }
        }
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

function showCardEditor(selectedWord, fullSentence, selectionDetails) {
    const title = 'Trim Sentence for Flashcard';
    const buttonText = 'Create Flashcard';
    const action = 'createFlashcard'; // Unified action

    const header = `<strong>${title}</strong><span class="glossari-label">${selectedWord}</span>`;
    const body = `<div contenteditable="true">${fullSentence}</div>`;
    const footer = `<button id="glossari-cancel-btn">Cancel</button><button id="glossari-confirm-btn">${buttonText}</button>`;
    const displayDiv = createDisplayBox('glossari-display', header, body, footer);

    displayDiv.querySelector('#glossari-confirm-btn').addEventListener('click', () => {
        const trimmedSentence = displayDiv.querySelector('.glossari-body').innerText.trim();
        if (trimmedSentence) {
            chrome.runtime.sendMessage({
                action: action,
                selectedWord: selectedWord,
                trimmedSentence: trimmedSentence,
                selectionDetails: selectionDetails
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

// MODIFIED: Simplified to a single button group
function createButtonGroupHTML() {
    return `
        <div class="glossari-button-group";">
            <button id="glossari-create-card-btn">Create Flashcard</button>
            <button id="glossari-trim-card-btn" title="Trim sentence before creating">✂️</button>
        </div>
    `;
}

function showSelectionActionPanel(selectedWord, selectionDetails) {
    // Remove any existing panels
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
            ${createButtonGroupHTML()}
            <div class="mymemory-definition">
                <span style="opacity: 0.6;">loading...</span>
            </div>
        </div>`;

    panel.querySelector('.glossari-panel-header strong').textContent = selectedWord;
    document.body.appendChild(panel);

    chrome.runtime.sendMessage({
        action: "getMyMemoryDefinition",
        selectedText: selectedWord
    });

    const sendMessageAndRemove = (action) => {
        chrome.runtime.sendMessage({
            action: action,
            selectedWord: selectedWord,
            selectionDetails: selectionDetails,
        });
        panel.remove();
    };

    const handleTrimClick = () => { // Simplified handler
        chrome.runtime.sendMessage({
            action: "getFullSentence",
            selectedWord: selectedWord,
            selectionDetails: selectionDetails
        }, (fullSentence) => {
            panel.remove();
            if (fullSentence) {
                showCardEditor(selectedWord, fullSentence, selectionDetails); // No cardType needed
            }
        });
    };

    // Event listeners for the unified button
    panel.querySelector('#glossari-create-card-btn').addEventListener('click', () => sendMessageAndRemove("createFlashcard"));
    panel.querySelector('#glossari-trim-card-btn').addEventListener('click', handleTrimClick);

    panel.querySelector('#glossari-panel-close-btn').addEventListener('click', () => panel.remove());
}

// --- TOUCH EVENT HANDLERS ---
function handleTouchStart(event) {
    if (!isGlossariActive) return;
    // Clear any previous timeouts or states
    clearTimeout(touchTimeout);
    waitingForLongPressSelection = false; // Reset state

    if (event.touches.length === 1) {
        const touch = event.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchTimeout = setTimeout(() => {
            // Long press threshold met, now waiting for the browser to make a selection
            waitingForLongPressSelection = true;
        }, LONG_PRESS_THRESHOLD);
    }
}

function handleTouchMove(event) {
    if (touchTimeout) {
        const touch = event.touches[0];
        if (Math.abs(touch.clientX - touchStartX) > MOVE_TOLERANCE ||
            Math.abs(touch.clientY - touchStartY) > MOVE_TOLERANCE) {
            clearTimeout(touchTimeout);
            touchTimeout = null;
            waitingForLongPressSelection = false; // Movement cancels long press intent
        }
    }
}

function handleTouchEnd() {
    clearTimeout(touchTimeout);
    touchTimeout = null;
    waitingForLongPressSelection = false; // Reset on touchend
}

// --- SELECTION CHANGE HANDLER ---
function handleSelectionChange() {
    if (!isGlossariActive) return;

    // Only proceed if a long press was initiated AND there is a new selection
    if (waitingForLongPressSelection) {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length > 0 && !selection.isCollapsed) {
            // A long press resulted in a selection. Now act on it.
            // Call the main handler, which will check for UI element clicks.
            handleTextSelection(null); // Pass null for event, as it's from selectionchange
            waitingForLongPressSelection = false; // Consume the event
        }
    }
}


// --- MAIN TEXT SELECTION HANDLER (for mouseup and long press via selectionchange) ---
async function handleTextSelection(event) {
    if (!isGlossariActive) return;

    // For mouseup events, check if clicking inside Glossari UI
    if (event && event.target.closest('#glossari-display, #glossari-selection-panel, #glossari-activation-popup')) {
        return;
    }

    const selection = window.getSelection();
    // Crucial check: if selection is collapsed, or no range, don't show panel
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
    }

    const selectedText = selection.toString().trim();

    if (selectedText.length > 0 && selectedText.length < 1000) {
        // Clear any existing Glossari UI before showing new one, to prevent stale panels
        ['glossari-display', 'glossari-activation-popup', 'glossari-selection-panel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        showSelectionActionPanel(selectedText, {
            commonAncestorPath: getXPath(selection.getRangeAt(0).commonAncestorContainer)
        });
    } else {
         // If selection is empty or too long, ensure panels are removed.
         // This can happen if selection changes to empty after a long press, etc.
        ['glossari-display', 'glossari-activation-popup', 'glossari-selection-panel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }
}


function getXPath(node) {
    if (node && node.id) return `//*[@id="${node.id}"]`;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';

    let path = [];
    while (node) {
        let sibling = node;
        let count = 1;
        while (sibling.previousElementSibling) {
            sibling = sibling.previousElementSibling;
            if (sibling.tagName === node.tagName) {
                count++;
            }
        }
        const segment = node.tagName.toLowerCase() + (count > 1 ? `[${count}]` : '');
        path.unshift(segment);
        if (node.tagName.toLowerCase() === 'body') break;
        node = node.parentElement;
    }
    return '/' + path.join('/');
}