console.log("Glossari content script loaded!");

// Variable to keep track of the currently highlighted text node
let currentlySelectedTextNode = null;
let highlightSpan = null;

// Listener for messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "displayInfo") {
        showInfoDisplay(request.data); // This function can be reused from the previous version
    }
});


/**
 * Main click handler to find and select a sentence.
 * @param {MouseEvent} event
 */
async function handleTextClick(event) {
    // We don't want to interfere with clicks on links or buttons
    if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || event.target.isContentEditable) {
        return;
    }

    // Find the actual text that was clicked on
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const clickedNode = range.startContainer;

    // Ensure we are dealing with a text node
    if (clickedNode.nodeType !== Node.TEXT_NODE) return;

    const selectedWord = clickedNode.textContent.substring(range.startOffset, range.endOffset).trim();
    if (!selectedWord) { // Ignore clicks that don't select a word
        const clickedWord = getWordAtClick(clickedNode.textContent, range.startOffset);
        if (!clickedWord) return;
    }


    // --- Find the Block of Text ---
    let parentElement = clickedNode.parentElement;
    // Traverse up to find a sensible block-level element
    while (parentElement) {
        const tagName = parentElement.tagName;
        if (['P', 'DIV', 'LI', 'ARTICLE', 'SECTION', 'TD', 'H1', 'H2', 'H3'].includes(tagName)) {
            break; // Found a good block
        }
        if (parentElement.tagName === 'BODY') break; // Don't go past the body
        parentElement = parentElement.parentElement;
    }

    const blockText = parentElement.textContent || "";
    const clickPositionInBlock = getClickPositionInBlock(parentElement, clickedNode, range.startOffset);

    // --- Find the Sentence within the Block ---
    const sentence = findSentenceInText(blockText, clickPositionInBlock);

    if (sentence) {
        console.log("Selected Word:", getWordAtClick(clickedNode.textContent, range.startOffset));
        console.log("Found Sentence:", sentence);
        
        // Highlight the sentence (optional, but good for UX)
        highlightSentence(sentence);

        await chrome.storage.local.set({
            // Save the *entire sentence* as the main context
            selectedWordForAnki: getWordAtClick(clickedNode.textContent, range.startOffset),
            fullSentenceForAnki: sentence
        });

        chrome.runtime.sendMessage({
            action: "displayInfo",
            data: `Sentence selected. Open the popup to analyze.`
        });
    }
}

document.body.addEventListener('dblclick', handleTextClick);


// --- Helper Functions ---

/**
 * Finds the boundaries of a sentence in a block of text around a specific position.
 * @param {string} text - The full block of text.
 * @param {number} position - The index of the click within the text.
 * @returns {string} The extracted sentence.
 */
function findSentenceInText(text, position) {
    const endMarkers = /[.!?]/;
    let start = position;
    let end = position;

    // Search backwards for the start of the sentence
    while (start > 0 && !endMarkers.test(text[start - 1])) {
        start--;
    }
    // Search forwards for the end of the sentence
    while (end < text.length - 1 && !endMarkers.test(text[end])) {
        end++;
    }

    // Include the end punctuation if it exists
    if (end < text.length && endMarkers.test(text[end])) {
        end++;
    }

    return text.substring(start, end).trim();
}

/**
 * Gets the specific word that was clicked on.
 */
function getWordAtClick(text, position) {
    const words = text.split(/\s+/);
    let currentPos = 0;
    for (const word of words) {
        if (position >= currentPos && position <= currentPos + word.length) {
            return word.replace(/[.,!?]$/, ''); // Clean trailing punctuation
        }
        currentPos += word.length + 1;
    }
    return "";
}


/**
 * Calculates the absolute position of a click within a parent element's text content.
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
    return -1; // Should not happen
}

// You can keep your showInfoDisplay function here to show notifications.
// The highlightSentence function would be new and require more advanced DOM manipulation (Range API).
function highlightSentence(sentence) {
    // This is a complex task. For now, we can skip visual highlighting
    // or use a simpler method. A full implementation would use the Range API
    // to find the sentence in the DOM and wrap it in a custom tag.
}

function showInfoDisplay(infoMessage) {
    // Your existing function to show the bottom-right notification box
    // (No changes needed here from the previous version)
}