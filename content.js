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
    if (request.action === "updateState") {
        setGlossariState(request.isActive);
    }
    else if (request.action === "showStatus") {
        showStatusDisplay(request.status, request.message);
        sendResponse({ success: true });
    } 
    else if (request.action === "showAnkiTrimmer") {
        showAnkiTrimmer(request.selectedWord, request.fullSentence);
        sendResponse({ success: true });
    }
});

// --- INITIALIZATION ---
// When the script first loads, ask the background script for the current state
chrome.runtime.sendMessage({ action: "getInitialState" }, (response) => {
    if (chrome.runtime.lastError) {
        console.error("Could not get initial state:", chrome.runtime.lastError);
    } else {
        setGlossariState(response.isActive);
    }
});


/**
 * NEW: Displays an editable box for trimming the sentence before sending to Anki.
 * @param {string} selectedWord - The word or phrase the user highlighted.
 * @param {string} fullSentence - The full sentence context.
 */
function showAnkiTrimmer(selectedWord, fullSentence) {
    // Remove any existing display box
    const existingDisplay = document.getElementById('glossari-display');
    if (existingDisplay) {
        existingDisplay.remove();
    }

    const displayDiv = document.createElement('div');
    displayDiv.id = 'glossari-display';

    // The inner HTML now includes an editable body and action buttons
    displayDiv.innerHTML = `
        <div class="glossari-header">
            <strong>Trim for Anki</strong>
            <span class="glossari-label">${selectedWord}</span>
        </div>
        <div class="glossari-body" contenteditable="true">
            ${fullSentence}
        </div>
        <div class="glossari-footer">
            <button id="glossari-cancel-btn">Cancel</button>
            <button id="glossari-confirm-btn">Confirm</button>
        </div>
    `;

    document.body.appendChild(displayDiv);

    // Event listener for the Confirm button
    document.getElementById('glossari-confirm-btn').addEventListener('click', () => {
        const trimmedSentence = displayDiv.querySelector('.glossari-body').innerText.trim();
        
        if (trimmedSentence) {
            // Send the final data to the background script to create the card
            chrome.runtime.sendMessage({
                action: "createAnkiFlashcard",
                selectedWord: selectedWord,
                fullSentence: fullSentence, // The original, full sentence for AI context
                frontContent: trimmedSentence // The new, trimmed sentence for the card front
            });
        }
        displayDiv.remove(); // Close the display box
    });

    // Event listener for the Cancel button
    document.getElementById('glossari-cancel-btn').addEventListener('click', () => {
        displayDiv.remove(); // Just close the display box
    });
}


/**
 * Displays a status notification box in the bottom-right corner of the page.
 * @param {string} status - 'success' or 'error'.
 * @param {string} message - The HTML message to display inside the box.
 */
function showStatusDisplay(status, message) {
    const existingDisplay = document.getElementById('glossari-display');
    if (existingDisplay) {
        existingDisplay.remove();
    }

    const displayDiv = document.createElement('div');
    displayDiv.id = 'glossari-display';
    const borderColor = status === 'success' ? '#22c55e' : '#ef4444';
    displayDiv.style.border = `2px solid ${borderColor}`;

    displayDiv.innerHTML = `
        <div class="glossari-header"><strong>Glossari</strong></div>
        <div class="glossari-body">${message}</div>
    `;
    
    document.body.appendChild(displayDiv);

    setTimeout(() => {
        if (displayDiv) {
            displayDiv.remove();
        }
    }, 7000);
}


/**
 * Main handler to capture selected text and its sentence context.
 * @param {MouseEvent} event
 */
async function handleTextSelection(event) {
    if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.isContentEditable) {
        await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        return;
    }

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length > 0) {
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        if (!range) return;

        const clickedNode = range.startContainer;
        if (clickedNode.nodeType !== Node.TEXT_NODE && selectedText.length === 0) {
            await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
            return;
        }

        let parentElement = clickedNode.parentElement;
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
        
        const blockText = parentElement ? parentElement.textContent || "" : selectedText;
        const clickPositionInBlock = parentElement && clickedNode.nodeType === Node.TEXT_NODE
                                     ? getClickPositionInBlock(parentElement, clickedNode, range.startOffset)
                                     : 0;

        const fullSentence = findSentenceInText(blockText, clickPositionInBlock);
        
        await chrome.storage.local.set({
            selectedWordForAnki: selectedText,
            fullSentenceForAnki: fullSentence
        });

        showStatusDisplay('success', `"${selectedText}" selected. Ready for action.`);
    } else {
        await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
    }
}

// --- Helper Functions ---
function findSentenceInText(text, position) {
    const cleanedText = text.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, " ");
    const sentences = cleanedText.split(/([.!?]\s*)/).filter(s => s.trim() !== '');
    let currentPosInCleanedText = 0;
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if (position >= currentPosInCleanedText && position < currentPosInCleanedText + sentence.length) {
            return sentence.trim();
        }
        currentPosInCleanedText += sentence.length;
    }
    return cleanedText.trim();
}

function getClickPositionInBlock(blockElement, clickedNode, offsetInNode) {
    let position = 0;
    const treeWalker = document.createTreeWalker(blockElement, NodeFilter.SHOW_TEXT, null, false);
    while (treeWalker.nextNode()) {
        const currentNode = treeWalker.currentNode;
        if (currentNode === clickedNode) {
            return position + offsetInNode;
        }
        position += currentNode.textContent.length;
    }
    return -1;
}