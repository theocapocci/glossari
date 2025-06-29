// Limitations: no phonetic information with current API

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
                // If we were in an unordered list, close it before starting a new ordered list
                if (inUnorderedList) {
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
    const selectedText = info.selectionText.trim();

    // If no text is selected, or the selected text is just whitespace,
    // we exit silently as there's nothing to define or explain.
    if (!selectedText) {
        return;
    }

    // Handle the "Define" action
    if (info.menuItemId === "defineWord") {
        try {
            // Define the language pair for the translation.
            // Current assumption is French to English. You can modify 'fr|en' as needed.
            const langPair = 'fr|en';

            // Construct the API URL for the MyMemory translation service.
            // The selected text is URL-encoded to ensure it's safe for a URL.
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedText)}&langpair=${langPair}`;

            // Make the API request to MyMemory.
            const response = await fetch(url);
            const data = await response.json();

            // Check the response status from the translation API.
            // A status other than 200 indicates an error.
            if (data.responseStatus !== 200) {
                throw new Error(data.responseDetails || "Translation API returned an error.");
            }

            // Extract the translated/defined text from the response.
            const definition = data.responseData.translatedText;

            // Check if a meaningful definition was returned.
            // If the definition is empty or identical to the input (case-insensitive),
            // it's likely that no distinct definition was found.
            if (!definition || definition.toLowerCase() === selectedText.toLowerCase()) {
                 throw new Error(`No distinct definition found for "${selectedText}"`);
            }

            // If successful, inject a script into the active tab to display the result.
            // The `displayResultOnPage` function (defined below) will handle the UI.
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Translation', definition] // 'Translation' acts as a label/category here
            });

        } catch (error) {
            // Log any errors that occur during the definition process.
            console.error("Glossari Definition Error:", error.message);
            
            // Display an error message on the page if the definition fails.
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Error', `Definition Failed: ${error.message}`]
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

            const model = "gemini-2.0-flash"; // Using 'gemini-2.0-flash' for text generation
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

            // Define the prompt for the AI.
            const prompt = `Explain the following text concisely and clearly: "${selectedText}"`;

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
            <span class="glossari-label">${label}</span> <!-- Uses the updated .glossari-label class -->
            <button id="glossari-close-btn">&times;</button>
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
