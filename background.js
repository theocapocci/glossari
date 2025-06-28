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

// Add a listener for messages from other parts of the extension (e.g., popup.js)
// This listener handles messages sent *to* the background script.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Check if the message is specifically for sending selected text to Anki
    if (request.action === "sendSelectedTextToAnki") {
        console.log("Message received from popup: sendSelectedTextToAnki");

        // Here you would implement the actual logic for Anki integration:
        // 1. Potentially get the selected text from the active tab if it wasn't
        //    already passed in the message from the popup (e.g., if the popup
        //    needs to trigger processing of *currently* selected text on the page).
        //    For example:
        //    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        //        const activeTab = tabs[0];
        //        chrome.tabs.sendMessage(activeTab.id, { action: "getSelectedText" }, (response) => {
        //            if (response && response.selectedText) {
        //                console.log("Selected text from tab:", response.selectedText);
        //                // Now you can use response.selectedText for Anki
        //                // For now, let's just use a placeholder
        //                // sendToAnkiLogic(response.selectedText);
        //            }
        //        });
        //    });

        // For now, we'll just send a success response back to the popup.
        // In a real scenario, you'd perform the Anki API call here
        // and send back success/failure based on that.
        sendResponse({ success: true, message: "Message received! Anki logic pending." });

        // IMPORTANT: Return true to indicate that you want to send a response asynchronously.
        // If you don't return true, the sendResponse callback will not work.
        return true;
    }
});
