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
chrome.contextMenus.onClicked.addListener((info, tab) => {
    // Check if the clicked item is our "createAnkiCard" item
    if (info.menuItemId === "createAnkiCard") {
        const selectedText = info.selectionText; // Get the text that was selected

        console.log("Context menu clicked! Selected text:", selectedText);

        // Send a message to the active tab's content script
        // This content script will then display a message on the webpage
        chrome.tabs.sendMessage(tab.id, {
            action: "displayInfo",
            data: `Selected: "${selectedText}". Getting definition and preparing Anki card...`
        });

        // In the next steps, this is where you would:
        // 1. Fetch the definition and context using an external API.
        // 2. Send that data to your local Python server (which then calls AnkiConnect).
    }
});
