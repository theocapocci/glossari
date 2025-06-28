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

        // Use chrome.scripting.executeScript to directly inject and run the display logic
        // This ensures the code runs in the tab's context when needed, avoiding connection errors.
        chrome.scripting.executeScript({
            target: { tabId: tab.id }, // Target the current tab
            function: (messageToDisplay) => {
                // This function contains the logic to display the message on the webpage.
                // It is self-contained and will run directly in the content script's environment.
                let GlossariDisplay = document.getElementById('glossari-display');
                if (!GlossariDisplay) {
                    GlossariDisplay = document.createElement('div');
                    GlossariDisplay.id = 'glossari-display';
                    Object.assign(GlossariDisplay.style, {
                        position: 'fixed',
                        bottom: '20px',
                        right: '20px',
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        border: '1px solid #ccc',
                        padding: '10px',
                        borderRadius: '8px',
                        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                        zIndex: '99999',
                        maxWidth: '300px',
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '14px',
                        color: '#333'
                    });
                    document.body.appendChild(GlossariDisplay);
                }
                
                GlossariDisplay.textContent = messageToDisplay;

                setTimeout(() => {
                    if (GlossariDisplay) {
                        GlossariDisplay.remove();
                    }
                }, 5000); // Remove after 5 seconds
            },
            args: [`Selected: "${selectedText}". Getting definition and preparing Anki card...`] // Pass the selected text as an argument to the injected function
        }, () => {
            // Callback to handle any errors during script execution
            if (chrome.runtime.lastError) {
                console.error("Error executing script in tab:", chrome.runtime.lastError.message);
            }
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

        // For now, we'll just send a success response back to the popup.
        // In a real scenario, you'd perform the Anki API call here
        // and send back success/failure based on that.
        sendResponse({ success: true, message: "Message received! Anki logic pending." });

        // IMPORTANT: Return true to indicate that you want to send a response asynchronously.
        // If you don't return true, the sendResponse callback will not work.
        return true;
    }
});