// Limitations: no phonetic information with current API
// Currently sends log of AI prompt

// Log a message to the console to confirm the background script is loaded
console.log("Glossari background service worker loaded!");

// Helper function to convert simple Markdown to HTML
// This function handles bold (**text**), italics (*text*), and basic lists (- item, 1. item).
// It's a simplified parser and may not handle all complex Markdown syntax or nested structures.
function convertMarkdownToHtml(markdownText) {
    let htmlOutput = [];
    const lines = markdownText.split('\n'); // Split the input text into individual lines
    let inUnorderedList = false; // State to track if we are currently inside an unordered list
    let inOrderedList = false;    // State to track if we are currently inside an ordered list

    // Helper function to apply inline Markdown formatting (bold, italics) to a given text string.
    const processInlineMarkdown = (text) => {
        let processedText = text;
        // Convert bold: **text** to <strong>text</strong>
        processedText = processedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Convert italics: *text* to <em>text</em>
        // This regex uses negative lookbehind and lookahead to ensure it only matches single asterisks,
        // preventing interference with double asterisks used for bold.
        processedText = processedText.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
        return processedText;
    };

    lines.forEach(line => {
        const trimmedLine = line.trim(); // Remove leading/trailing whitespace for easier parsing

        // Check for unordered list item (starts with '-' or '*')
        if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
            // If we are not currently in an unordered list, start one
            if (!inUnorderedList) {
                // If we were in an ordered list, close it before starting a new unordered list
                if (inOrderedList) {
                    htmlOutput.push('</ol>');
                    inOrderedList = false;
                }
                htmlOutput.push('<ul>'); // Open a new unordered list tag
                inUnorderedList = true;
            }
            // Extract the content of the list item by removing the marker and trim
            const listItemContent = trimmedLine.substring(2).trim();
            // Process inline markdown within the list item content and add it to the HTML output
            htmlOutput.push(`<li>${processInlineMarkdown(listItemContent)}</li>`);
        }
        // Check for ordered list item (starts with a number followed by '. ')
        else if (trimmedLine.match(/^\d+\.\s/)) {
            // If we are not currently in an ordered list, start one
            if (!inOrderedList) {
                if (inUnorderedList) { // If currently in an unordered list, close it before starting a new ordered list
                    htmlOutput.push('</ul>');
                    inUnorderedList = false;
                }
                htmlOutput.push('<ol>'); // Open a new ordered list tag
                inOrderedList = true;
            }
            // Extract the content of the list item after the number and dot
            const listItemContent = trimmedLine.substring(trimmedLine.indexOf('.') + 1).trim();
            // Process inline markdown within the list item content and add it to the HTML output
            htmlOutput.push(`<li>${processInlineMarkdown(listItemContent)}</li>`);
        }
        // If the line is not a list item, treat it as a paragraph
        else {
            // Close any open lists before adding a new paragraph
            if (inUnorderedList) {
                htmlOutput.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                htmlOutput.push('</ol>');
                inOrderedList = false;
            }

            // If the line is not empty, process its inline markdown and wrap it in a paragraph tag
            if (trimmedLine) {
                 htmlOutput.push(`<p>${processInlineMarkdown(trimmedLine)}</p>`);
            }
        }
    });

    // After processing all lines, ensure any open lists are properly closed
    if (inUnorderedList) {
        htmlOutput.push('</ul>');
    }
    if (inOrderedList) {
        htmlOutput.push('</ol>');
    }

    // Join all the accumulated HTML parts into a single string
    return htmlOutput.join('\n');
}

// This function is designed to be executed within the content script's context
// via chrome.scripting.executeScript. It extracts the currently selected text,
// its relevant sentences, its containing block-level element, and broader environmental snippets.
function getSelectedTextAndContextForAI() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return { selectedText: '', relevantSentences: '', containingBlock: '', preEnvironText: '', postEnvironText: '' };
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (!selectedText) {
        return { selectedText: '', relevantSentences: '', containingBlock: '', preEnvironText: '', postEnvironText: '' };
    }

    let relevantSentences = '';
    let containingBlock = '';
    let preEnvironText = '';
    let postEnvironText = '';

    // --- 1. Extract Containing Block (prioritizing <p> and <li> tags) ---
    // Find the closest block-level ancestor for context.
    let blockAncestorNode = range.commonAncestorContainer;
    while (blockAncestorNode && blockAncestorNode.nodeType !== Node.ELEMENT_NODE ||
           (blockAncestorNode.nodeName !== 'P' && // Keep P here as it's a block type we consider
            blockAncestorNode.nodeName !== 'DIV' &&
            blockAncestorNode.nodeName !== 'LI' && // Keep LI here as it's a block type we consider
            blockAncestorNode.nodeName !== 'BODY' &&
            blockAncestorNode.nodeName !== 'ARTICLE' &&
            blockAncestorNode.nodeName !== 'SECTION')) {
        if (blockAncestorNode.nodeName === 'HTML') { // Reached top without finding
            blockAncestorNode = null;
            break;
        }
        blockAncestorNode = blockAncestorNode.parentNode;
    }
    
    // Now extract the text content from the determined blockAncestorNode
    if (blockAncestorNode && blockAncestorNode.nodeName !== 'HTML') {
        containingBlock = blockAncestorNode.textContent.trim();
    } else {
        // Fallback to document.body.innerText if no clear block-like element is found.
        containingBlock = document.body.innerText.trim();
    }


    // --- 2. Extract Relevant Sentences ---
    // This attempts to find the full sentence(s) containing the selected text within the DOM structure.
    const textIterator = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let startNode = range.startContainer;
    let endNode = range.endContainer;
    let preText = '';
    let postText = '';

    // Determine the boundary for sentence search (the containing block we just found, or document.body)
    const sentenceSearchBoundary = blockAncestorNode || document.body;

    // Collect text from nodes before the start of selection
    let currentNode = startNode;
    // Iterate backwards through text nodes and sibling elements until a sentence terminator or block boundary
    while (currentNode && currentNode !== sentenceSearchBoundary) { // Stop at calculated boundary
        if (currentNode.nodeType === Node.TEXT_NODE) {
            preText = currentNode.textContent + preText; // Prepend to build text backwards
            if (currentNode === startNode) {
                 preText = preText.substring(0, range.startOffset); // Only take text before selection start
            }
            // Check for sentence end markers (., !, ?, newline)
            if (preText.match(/[.!?\n]$/)) {
                break;
            }
        }
        // Move to previous sibling or up to parent then previous sibling
        let prevSibling = currentNode.previousSibling;
        if (!prevSibling && currentNode.parentNode && currentNode.parentNode !== sentenceSearchBoundary) {
            currentNode = currentNode.parentNode;
            prevSibling = currentNode.previousSibling; // Try sibling of parent
        }
        currentNode = prevSibling;

        if (preText.length > 500) break; // Limit backward search to prevent excessive processing
    }
    // Trim preText to the last sentence terminator if found
    const lastSentenceEndIndex = Math.max(preText.lastIndexOf('.'), preText.lastIndexOf('!'), preText.lastIndexOf('?'), preText.lastIndexOf('\n'));
    if (lastSentenceEndIndex !== -1 && lastSentenceEndIndex === preText.length -1) { // Only if terminator is at very end
        preText = preText.substring(lastSentenceEndIndex + 1); // Start after terminator
    }
    preText = preText.trim();


    // Collect text from nodes after the end of selection
    currentNode = endNode;
    // Iterate forwards through text nodes and sibling elements until a sentence terminator or block boundary
    while (currentNode && currentNode !== sentenceSearchBoundary) { // Stop at calculated boundary
        if (currentNode.nodeType === Node.TEXT_NODE) {
            postText += currentNode.textContent;
            if (currentNode === endNode) {
                postText = postText.substring(range.endOffset); // Only take text after selection end
            }
            // Check for sentence start markers (., !, ?, newline)
            if (postText.match(/^[.!?\n]/)) {
                break;
            }
        }
        // Move to next sibling or up to parent then next sibling
        let nextSibling = currentNode.nextSibling;
        if (!nextSibling && currentNode.parentNode && currentNode.parentNode !== sentenceSearchBoundary) {
            currentNode = currentNode.parentNode;
            nextSibling = currentNode.nextSibling; // Try sibling of parent
        }
        currentNode = nextSibling;

        if (postText.length > 500) break; // Limit forward search to prevent excessive processing
    }
    // Trim postText to the first sentence terminator if found
    const firstSentenceEndIndex = Math.min(
        postText.indexOf('.') === -1 ? Infinity : postText.indexOf('.'),
        postText.indexOf('!') === -1 ? Infinity : postText.indexOf('!'),
        postText.indexOf('?') === -1 ? Infinity : postText.indexOf('?'),
        postText.indexOf('\n') === -1 ? Infinity : postText.indexOf('\n')
    );
    if (firstSentenceEndIndex !== Infinity) {
        postText = postText.substring(0, firstSentenceEndIndex + 1); // Include the terminator
    }
    postText = postText.trim();

    relevantSentences = (preText + selectedText + postText).trim();

    // Fallback: If relevantSentences is still just the selectedText or very short, try to expand using containingBlock.
    // This handles cases where the DOM traversal might have been too restrictive.
    if (relevantSentences.length <= selectedText.length + 5 && containingBlock.includes(selectedText)) {
        const selectedIndexInBlock = containingBlock.indexOf(selectedText);
        if (selectedIndexInBlock !== -1) {
            // Find approximate start of relevant text in block
            let searchStartInBlock = Math.max(0, selectedIndexInBlock - 200); // Look back a bit
            // Find approximate end of relevant text in block
            let searchEndInBlock = Math.min(containingBlock.length, selectedIndexInBlock + selectedText.length + 200); // Look forward a bit

            // Attempt to expand to nearest sentence boundaries within this larger snippet
            let tempSnippet = containingBlock.substring(searchStartInBlock, searchEndInBlock);
            const tempSelectedIdx = tempSnippet.indexOf(selectedText);

            if (tempSelectedIdx !== -1) {
                let sStart = tempSelectedIdx;
                while (sStart > 0 && !['.', '!', '?', '\n'].includes(tempSnippet[sStart - 1])) {
                    sStart--;
                }
                let sEnd = tempSelectedIdx + selectedText.length;
                while (sEnd < tempSnippet.length && !['.', '!', '?', '\n'].includes(tempSnippet[sEnd])) {
                    sEnd++;
                }
                if (['.', '!', '?', '\n'].includes(tempSnippet[sEnd -1])) { // Check last char of captured snippet
                    sEnd++;
                }
                relevantSentences = tempSnippet.substring(sStart, sEnd).trim();
            }
        }
    }
    // Ensure selectedText is always within relevantSentences
    if (!relevantSentences.includes(selectedText)) {
        relevantSentences = selectedText; // Fallback to just selectedText
    }


    // --- 3. Extract Environ (broader surrounding text snippet, split into pre/post block) ---
    const MAX_ENVIRON_SIDE_LENGTH = 500; // Max characters for pre or post text
    const commonAncestorOfBlock = (blockAncestorNode && blockAncestorNode.parentNode) || document.body;
    let fullEnvironText = commonAncestorOfBlock.textContent || '';
    
    // Ensure selectedText is in fullEnvironText. If not, try innerText of body
    if (!fullEnvironText.includes(selectedText)) {
        fullEnvironText = document.body.innerText || '';
    }

    const containingBlockIndexInEnviron = fullEnvironText.indexOf(containingBlock);

    if (containingBlockIndexInEnviron !== -1) {
        // Text before the containing block
        let startOfPre = Math.max(0, containingBlockIndexInEnviron - MAX_ENVIRON_SIDE_LENGTH);
        preEnvironText = fullEnvironText.substring(startOfPre, containingBlockIndexInEnviron).trim();

        // Text after the containing block
        let startOfPost = containingBlockIndexInEnviron + containingBlock.length;
        let endOfPost = Math.min(fullEnvironText.length, startOfPost + MAX_ENVIRON_SIDE_LENGTH);
        postEnvironText = fullEnvironText.substring(startOfPost, endOfPost).trim();
    } else {
        // Fallback if containingBlock itself wasn't found within fullEnvironText (e.g., edge case)
        // In this case, environ reverts to simple pre/post around selectedText from the broader context
        const selectedTextIndexInEnviron = fullEnvironText.indexOf(selectedText);
        if (selectedTextIndexInEnviron !== -1) {
            preEnvironText = fullEnvironText.substring(Math.max(0, selectedTextIndexInEnviron - MAX_ENVIRON_SIDE_LENGTH), selectedTextIndexInEnviron).trim();
            postEnvironText = fullEnvironText.substring(selectedTextIndexInEnviron + selectedText.length, Math.min(fullEnvironText.length, selectedTextIndexInEnviron + selectedText.length + MAX_ENVIRON_SIDE_LENGTH)).trim();
        } else {
            // Ultimate fallback if selectedText is not found even in fullEnvironText
            preEnvironText = '';
            postEnvironText = fullEnvironText.substring(0, Math.min(fullEnvironText.length, MAX_ENVIRON_SIDE_LENGTH * 2)).trim();
        }
    }

    // Ensure selectedText is in at least one of the contexts. If environ is empty, add selectedText to preEnvironText.
    if (!relevantSentences.includes(selectedText) && !containingBlock.includes(selectedText) && !preEnvironText.includes(selectedText) && !postEnvironText.includes(selectedText)) {
        preEnvironText = selectedText; // As an absolute last resort, ensure the selected text is somewhere.
    }


    return {
        selectedText: selectedText,
        relevantSentences: relevantSentences,
        containingBlock: containingBlock,
        preEnvironText: preEnvironText, // Now two distinct properties
        postEnvironText: postEnvironText // Now two distinct properties
    };
}


// Add a listener that runs when the extension is first installed or updated
chrome.runtime.onInstalled.addListener(() => {
    // Create the parent context menu item for Glossari
    // This will appear when text is selected.
    chrome.contextMenus.create({
        id: "glossariParent",
        title: "Glossari",
        contexts: ["selection"]
    });
    console.log("Context menu item 'glossariParent' created.");

    // Create a child context menu item for defining words
    // This will appear under the "Glossari" parent menu.
    chrome.contextMenus.create({
        id: "defineWord",
        title: "Define '%s'", // '%s' will be replaced by the selected text
        parentId: "glossariParent", // Links this item to the 'glossariParent' menu
        contexts: ["selection"] // Contexts are technically inherited from parent, but good practice to specify
    });
    console.log("Context menu item 'defineWord' created as child.");

    // Create a new child context menu item for AI explanation
    // This will also appear under the "Glossari" parent menu.
    chrome.contextMenus.create({
        id: "explainWithAI",
        title: "Explain '%s' with AI", // '%s' will be replaced by the selected text
        parentId: "glossariParent", // Link to the same parent Glossari menu
        contexts: ["selection"]
    });
    console.log("Context menu item 'explainWithAI' created as child.");
});

// Add a listener for when any context menu item from this extension is clicked
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const initialSelectedText = info.selectionText.trim(); // Initial text from context menu info

    if (!initialSelectedText) {
        return; // Exit if no text is selected
    }

    // Handle the "Define" action
    if (info.menuItemId === "defineWord") {
        try {
            const langPair = 'fr|en';
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(initialSelectedText)}&langpair=${langPair}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.responseStatus !== 200) {
                throw new Error(data.responseDetails || "Translation API returned an error.");
            }

            const definition = data.responseData.translatedText;

            if (!definition || definition.toLowerCase() === initialSelectedText.toLowerCase()) {
                 throw new Error(`No distinct definition found for "${initialSelectedText}"`);
            }

            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [initialSelectedText, 'Translation', definition]
            });

        } catch (error) {
            console.error("Glossari Definition Error:", error.message);
            
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [initialSelectedText, 'Error', `Definition Failed: ${error.message}`]
            });
        }
    }
    // Handle the "Explain with AI" action
    else if (info.menuItemId === "explainWithAI") {
        try {
            // Retrieve the Gemini API Key from chrome.storage.local
            const storage = await chrome.storage.local.get('geminiApiKey');
            const GEMINI_API_KEY = storage.geminiApiKey;

            if (!GEMINI_API_KEY) {
                throw new Error("Gemini API Key is not set. Please set it in the extension popup.");
            }

            // --- Get selected text and its detailed context from the content script ---
            const queryResponse = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: getSelectedTextAndContextForAI // Execute this function in the content script context
            });

            // The result is an array, take the first result.
            const { selectedText, relevantSentences, containingBlock, preEnvironText, postEnvironText } = queryResponse[0].result;

            if (!selectedText) {
                throw new Error("No text selected for AI explanation or context retrieval failed.");
            }
            // --- END Context Retrieval ---

            const model = "gemini-2.0-flash"; // Using 'gemini-2.0-flash' for text generation
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

            // --- Build a more contextual prompt for the AI using the context properties and a persona ---
            let promptParts = [];
            
            // Add AI Persona/Identity
            promptParts.push("You are a highly knowledgeable language learning assistant, specialized in using contextual information to make inferences about the meaning of linguistic expressions. Your task is provide concise explanations of linguistic expressions that will be helpful for language learners.");
        
            // Start the main request directly
            promptParts.push(`For the linguistic item: "${selectedText}",`);
            
            // Add relevantSentences if it's distinct from selectedText and non-empty
            if (relevantSentences && relevantSentences !== selectedText) {
                promptParts.push(`Its immediate context (relevant sentence(s) or closest phrase unit) is: "${relevantSentences}"`);
            }
            // Add containingBlock if it's distinct from selectedText and relevantSentences
            if (containingBlock && containingBlock !== selectedText && containingBlock !== relevantSentences) {
                promptParts.push(`Its containing block (paragraph, list item, or similar) is: "${containingBlock}"`);
            }
            // Add preEnvironText if it exists and is distinct from other contexts
            if (preEnvironText && preEnvironText !== selectedText && preEnvironText !== relevantSentences && preEnvironText !== containingBlock) {
                promptParts.push(`Text preceding its containing block: "${preEnvironText}"`);
            }
            // Add postEnvironText if it exists and is distinct from other contexts
            if (postEnvironText && postEnvironText !== selectedText && postEnvironText !== relevantSentences && postEnvironText !== containingBlock) {
                promptParts.push(`Text following its containing block: "${postEnvironText}"`);
            }

            promptParts.push(`\nPlease provide a concise explanation of the *usage of this this item* in context.`);


            const prompt = promptParts.join('\n');

            // --- Log the prompt to the console for debugging ---
            console.log("AI Prompt sent:", prompt);
            // --- END Log ---

            // Make the API request to the Gemini API.
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            });

            const data = await response.json();

            // Check if the API response indicates an error.
            if (!response.ok) {
                let errorMessage = 'Unknown error from AI API.';
                if (data && data.error && data.error.message) {
                    errorMessage = data.error.message;
                }
                throw new Error(`AI Explanation Failed: ${errorMessage}`);
            }
            
            // Extract the AI-generated explanation text.
            const explanation = data.candidates[0].content.parts[0].text;

            // Check if a meaningful explanation was returned.
            if (!explanation) {
                throw new Error(`No explanation found for "${selectedText}"`);
            }

            // Convert Markdown explanation to HTML before displaying
            const formattedExplanation = convertMarkdownToHtml(explanation);

            // If successful, inject a script to display the AI explanation on the page.
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'AI Explanation', formattedExplanation] // 'AI Explanation' acts as a label
            });

        } catch (error) {
            // Log any errors that occur during the AI explanation process.
            console.error("Glossari AI Explanation Error:", error.message);
            
            // Display an error message on the page if the AI explanation fails.
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Error', error.message]
            });
        }
    }
});

// This function is designed to be injected into the active webpage by `chrome.scripting.executeScript`.
// It creates or updates a floating display box on the page to show the result.
function displayResultOnPage(word, label, text) {
    // Attempt to find an existing display box.
    let glossariDisplay = document.getElementById('glossari-display');

    // If a display box already exists, remove it to show the new result cleanly.
    if (glossariDisplay) {
        glossariDisplay.remove();
    }

    // Create a new div element for the display box.
    glossariDisplay = document.createElement('div');
    glossariDisplay.id = 'glossari-display'; // Assign a unique ID for styling and retrieval.

    // Populate the inner HTML of the display box with the selected word, its label, and the explanation/definition.
    // It includes a header with the word and label, and a close button.
    // The main body contains the explanation text.
    glossariDisplay.innerHTML = `
        <div class="glossari-header">
            <strong>${word}</strong>
            <span class="glossari-label">${label}</span> <button id="glossari-close-btn">&times;</button>
        </div>
        <div class="glossari-body">
            ${text}
        </div>
    `;
    
    // Append the newly created display box to the body of the webpage.
    document.body.appendChild(glossariDisplay);

    // Add an event listener to the close button to remove the display box when clicked.
    document.getElementById('glossari-close-btn').addEventListener('click', () => {
        glossariDisplay.remove();
    });
}
