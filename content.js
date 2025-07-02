// content.js
console.log("Glossari content script loaded!");

// --- MESSAGE LISTENER ---
// Listens for messages from the background script to show status notifications.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // This is the new part that listens for success/error messages
    if (request.action === "showStatus") {
        showStatusDisplay(request.status, request.message);
        sendResponse({ success: true }); // Acknowledge receipt
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
    header.innerHTML = `<strong>Glossari</strong>`;

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
    }, 7000);
}


/**
 * Main handler to capture selected text (word or phrase) and its sentence context.
 * This will be triggered on 'mouseup' for general selection.
 * For double-click, it will also trigger, but 'mouseup' covers both.
 * @param {MouseEvent} event
 */
async function handleTextSelection(event) {
    // We don't want to interfere with clicks on links or buttons, or editable content
    if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.isContentEditable) {
        // Clear selection data if we clicked on an interactive element
        await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
        return;
    }

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length > 0) {
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        if (!range) return;

        const clickedNode = range.startContainer;

        // Ensure we are selecting text, not just clicking whitespace
        if (clickedNode.nodeType !== Node.TEXT_NODE && selectedText.length > 0) {
            // If selection starts in a non-text node, try to find a text node within it
            let tempNode = clickedNode.firstChild;
            while(tempNode && tempNode.nodeType !== Node.TEXT_NODE) {
                tempNode = tempNode.nextSibling;
            }
            if (tempNode) {
                clickedNode = tempNode;
            } else {
                // If no text node found, or if selection is not directly from text,
                // we might not get a good sentence. Fallback or return.
                // For now, we'll try to proceed with the current clickedNode and hope for the best.
                // Or you could add a specific check:
                // await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
                // return;
            }
        } else if (clickedNode.nodeType !== Node.TEXT_NODE && selectedText.length === 0) {
            // No text selected and not a text node, clear and return
            await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
            return;
        }

        let parentElement = clickedNode.parentElement;
        while (parentElement) {
            const tagName = parentElement.tagName;
            if (['P', 'DIV', 'LI', 'ARTICLE', 'SECTION', 'TD', 'H1', 'H2', 'H3', 'BLOCKQUOTE'].includes(tagName)) {
                break; // Found a common block parent
            }
            if (parentElement.tagName === 'BODY') break; // Reached body, stop
            parentElement = parentElement.parentElement;
        }

        // Fallback if no specific block parent found, use the closest common ancestor of the selection
        if (!parentElement) {
             parentElement = selection.getRangeAt(0).commonAncestorContainer;
             if (parentElement.nodeType !== Node.ELEMENT_NODE) {
                 parentElement = parentElement.parentElement;
             }
        }


        // If no reasonable parentElement is found for full sentence extraction,
        // just use the selected text as the "sentence" (or define a custom fallback).
        const blockText = parentElement ? parentElement.textContent || "" : selectedText;
        const clickPositionInBlock = parentElement && clickedNode.nodeType === Node.TEXT_NODE
                                     ? getClickPositionInBlock(parentElement, clickedNode, range.startOffset)
                                     : 0; // Default to 0 if cannot precisely locate

        // Use the existing sentence detection logic
        const fullSentence = findSentenceInText(blockText, clickPositionInBlock);

        // Store both the selected text (word or phrase) and the full sentence
        await chrome.storage.local.set({
            selectedWordForAnki: selectedText, // This now stores the actual selected text (word or phrase)
            fullSentenceForAnki: fullSentence
        });

        // Give the user instant feedback that the selection is ready.
        // Use a more generic message as it's not always a single word from dblclick.
        showStatusDisplay('success', `"${selectedText}" selected. Ready for <b r>send-to-anki.`);
    } else {
        // If nothing is selected (e.g., user clicked away), clear stored data
        await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
    }
}

// Attach the new handler to 'mouseup' event
document.body.addEventListener('mouseup', handleTextSelection);

// Remove the old dblclick listener as mouseup covers it
// document.body.removeEventListener('dblclick', handleTextClick); // Uncomment if handleTextClick is no longer used


// --- Helper Functions (Minor Adjustments/No Changes Needed) ---

/**
 * Finds the sentence containing the given position in the text.
 * @param {string} text - The full block of text.
 * @param {number} position - The click position within the text.
 * @returns {string} The extracted sentence.
 */
function findSentenceInText(text, position) {
    // Improved sentence splitting to handle common cases, including multiple spaces and newlines
    const cleanedText = text.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, " ");

    // Regex to split by sentence-ending punctuation, keeping the punctuation with the sentence
    const sentences = cleanedText.split(/([.!?]\s*)/).filter(s => s.trim() !== '');

    let currentPosInCleanedText = 0;
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if (position >= currentPosInCleanedText && position < currentPosInCleanedText + sentence.length) {
            // Found the sentence containing the position
            return sentence.trim();
        }
        currentPosInCleanedText += sentence.length;
    }

    // Fallback: if no sentence found (e.g., text without punctuation), return the whole text trimmed
    return cleanedText.trim();
}

/**
 * Gets the word at a specific click position (useful if you still need single word on double click,
 * but for general selection, window.getSelection().toString() is better).
 * Keeping it here for potential future use or if it's used elsewhere.
 * @param {string} text - The text content of the node.
 * @param {number} position - The offset within the text node.
 * @returns {string} The word at the click position.
 */
function getWordAtClick(text, position) {
    const start = text.substring(0, position).search(/\b\w+$/);
    const end = text.substring(position).search(/\b/) + position;
    return text.substring(start, end).replace(/[.,!?]$/, '');
}


/**
 * Calculates the absolute position of a click (or selection start) within a given block element's text content.
 * This is crucial for accurately finding the containing sentence.
 * @param {HTMLElement} blockElement - The containing block element (e.g., P, DIV).
 * @param {Node} clickedNode - The exact text node that was clicked/selected.
 * @param {number} offsetInNode - The offset within the clickedNode.
 * @returns {number} The absolute character position within the blockElement's concatenated text.
 */
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
    return -1; // Should ideally not happen if clickedNode is within blockElement
}