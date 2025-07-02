console.log("Glossari content script loaded!");

// --- MESSAGE LISTENER ---
// Listens for messages from the background script to show status notifications.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // This is the new part that listens for success/error messages
    if (request.action === "showStatus") {
        showStatusDisplay(request.status, request.message);
    }
});

/**
 * Displays a status notification box in the bottom-right corner of the page.
 * This function creates the visual element for the user.
 * @param {string} status - 'success' or 'error'.
 * @param {string} message - The HTML message to display inside the box.
 */
function showStatusDisplay(status, message) {
    // Remove any old notification box first
    const existingDisplay = document.getElementById('glossari-display');
    if (existingDisplay) {
        existingDisplay.remove();
    }

    // Create the main container div
    const displayDiv = document.createElement('div');
    displayDiv.id = 'glossari-display'; // Use the ID your CSS already targets

    // Style the border color based on the status
    const borderColor = status === 'success' ? '#22c55e' : '#ef4444'; // Green for success, Red for error
    displayDiv.style.border = `2px solid ${borderColor}`;

    // Create the header and body for the notification
    const header = document.createElement('div');
    header.className = 'glossari-header';
    header.innerHTML = `<strong>Glossari Status</strong>`;

    const body = document.createElement('div');
    body.className = 'glossari-body';
    body.innerHTML = message; // The message from background.js

    // Assemble the notification box
    displayDiv.appendChild(header);
    displayDiv.appendChild(body);

    // Add the box to the webpage
    document.body.appendChild(displayDiv);

    // Automatically remove the notification after 4 seconds
    setTimeout(() => {
        if (displayDiv) {
            displayDiv.remove();
        }
    }, 4000);
}


/**
 * Main click handler to find and select a sentence.
 * @param {MouseEvent} event
 */
async function handleTextClick(event) {
    // We don't want to interfere with clicks on links or buttons
    if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.isContentEditable) {
        return;
    }

    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const clickedNode = range.startContainer;

    if (clickedNode.nodeType !== Node.TEXT_NODE) return;

    const selectedWord = getWordAtClick(clickedNode.textContent, range.startOffset);
    if (!selectedWord) return;

    let parentElement = clickedNode.parentElement;
    while (parentElement) {
        const tagName = parentElement.tagName;
        if (['P', 'DIV', 'LI', 'ARTICLE', 'SECTION', 'TD', 'H1', 'H2', 'H3'].includes(tagName)) {
            break;
        }
        if (parentElement.tagName === 'BODY') break;
        parentElement = parentElement.parentElement;
    }

    const blockText = parentElement.textContent || "";
    const clickPositionInBlock = getClickPositionInBlock(parentElement, clickedNode, range.startOffset);
    const sentence = findSentenceInText(blockText, clickPositionInBlock);

    if (sentence) {
        await chrome.storage.local.set({
            selectedWordForAnki: selectedWord,
            fullSentenceForAnki: sentence
        });

        // --- CHANGE ---
        // Give the user instant feedback that the word has been selected and is ready.
        showStatusDisplay('success', `Selected: "<strong>${selectedWord}</strong>".<br>Ready for Anki shortcut.`);
    }
}

document.body.addEventListener('dblclick', handleTextClick);


// --- Helper Functions (No Changes Needed Here) ---

function findSentenceInText(text, position) {
    const endMarkers = /[.!?]/;
    let start = position,
        end = position;
    while (start > 0 && !endMarkers.test(text[start - 1])) start--;
    while (end < text.length - 1 && !endMarkers.test(text[end])) end++;
    if (end < text.length && endMarkers.test(text[end])) end++;
    return text.substring(start, end).trim();
}

function getWordAtClick(text, position) {
    const words = text.split(/\s+/);
    let currentPos = 0;
    for (const word of words) {
        if (position >= currentPos && position <= currentPos + word.length) {
            return word.replace(/[.,!?]$/, '');
        }
        currentPos += word.length + 1;
    }
    return "";
}

function getClickPositionInBlock(blockElement, clickedNode, offsetInNode) {
    let position = 0;
    const treeWalker = document.createTreeWalker(blockElement, NodeFilter.SHOW_TEXT, null, false);
    while (treeWalker.nextNode()) {
        const currentNode = treeWalker.currentNode;
        if (currentNode === clickedNode) return position + offsetInNode;
        position += currentNode.textContent.length;
    }
    return -1;
}