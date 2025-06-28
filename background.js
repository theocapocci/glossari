// Log a message to the console to confirm the background script is loaded
console.log("Glossari background service worker loaded!");

// Add a listener that runs when the extension is first installed or updated
chrome.runtime.onInstalled.addListener(() => {
    // Create a context menu item that appears when text is selected
    chrome.contextMenus.create({
        id: "createAnkiCard", // Unique ID for this menu item
        title: "Create Anki Card for '%s'", // '%s' is a placeholder for the selected text
        contexts: ["selection"] // This makes the menu item appear only when text is selected
    });
    console.log("Context menu item 'createAnkiCard' created.");
});

// Add a listener for when a context menu item is clicked
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Check if the clicked item is our "createAnkiCard" item
    if (info.menuItemId === "createAnkiCard") {
        const selectedText = info.selectionText; // Get the text that was initially selected

        console.log("Context menu clicked! Initial selected text:", selectedText);

        // First, send a message to the content script to get the full context sentence
        // We use await because sendMessage returns a Promise in Manifest V3
        let response;
        try {
            response = await chrome.tabs.sendMessage(tab.id, { action: "getWordAndContext" });
        } catch (error) {
            console.error("Error sending message to content script:", error);
            chrome.tabs.sendMessage(tab.id, {
                action: "displayInfo",
                data: `Error getting context. Please try again.`
            });
            return; // Stop execution if content script communication fails
        }
        
        const wordToDefine = response.selectedText;
        const contextSentence = response.contextSentence;

        console.log("Received from content script - Word:", wordToDefine);
        console.log("Received from content script - Context:", contextSentence);

        // Display a temporary message on the page while processing
        chrome.tabs.sendMessage(tab.id, {
            action: "displayInfo",
            data: `Selected: "${wordToDefine}". Fetching definition...`
        });

        // --- Next Step: Integrate Dictionary API here ---
        // For now, we'll just log a placeholder
        const definition = `Definition of "${wordToDefine}" (API call will go here)`;
        const translatedContext = `Translation of "${contextSentence}" (API call will go here)`;

        console.log("Placeholder Definition:", definition);
        console.log("Placeholder Translated Context:", translatedContext);
        
        // --- Next Step: Send to Anki (via Python backend) here ---
        // For now, just a final message
        chrome.tabs.sendMessage(tab.id, {
            action: "displayInfo",
            data: `Processed: "${wordToDefine}". Ready for Anki!`
        });
    }
});
