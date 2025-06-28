// Log a message to the console to confirm the background script is loaded
console.log("Glossari background service worker loaded!");

// Add a listener that runs when the extension is first installed or updated
chrome.runtime.onInstalled.addListener(() => {
    // Create a context menu item that appears when text is selected
    chrome.contextMenus.create({
        id: "defineWord",
        title: "Define '%s' with Glossari",
        contexts: ["selection"]
    });
    console.log("Context menu item 'defineWord' created.");
});

// Add a listener for when a context menu item is clicked
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "defineWord") {
        const selectedText = info.selectionText.trim();
        
        if (!selectedText) {
            return; // Exit if no text is selected
        }

        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${selectedText}`);
            // IMPORTANT: Always parse the JSON body first. It contains the real error message.
            const data = await response.json();

            // Now, check if the HTTP request was successful.
            if (!response.ok) {
                // If the API gave us a specific error title (like "No Definitions Found"), use that.
                const errorMessage = data.title || `API Error: ${response.status}`;
                throw new Error(errorMessage);
            }

            const definition = data[0]?.meanings[0]?.definitions[0]?.definition;
            const phonetic = data[0]?.phonetic || '';

            if (!definition) {
                throw new Error("Could not find a valid definition in the API response.");
            }

            // Inject the successful result into the page.
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, phonetic, definition]
            });

        } catch (error) {
            // This will now catch the correct, user-friendly error message.
            console.error("Glossari Error:", error.message);
            
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Error', error.message]
            });
        }
    }
});

// Rename the injected function for clarity
function displayResultOnPage(word, phonetic, text) {
    let glossariDisplay = document.getElementById('glossari-display');
    if (glossariDisplay) {
        glossariDisplay.remove();
    }

    glossariDisplay = document.createElement('div');
    glossariDisplay.id = 'glossari-display';
    glossariDisplay.innerHTML = `
        <div class="glossari-header">
            <strong>${word}</strong>
            <span class="glossari-phonetic">${phonetic}</span>
            <button id="glossari-close-btn">&times;</button>
        </div>
        <div class="glossari-body">
            ${text}
        </div>
    `;
    document.body.appendChild(glossariDisplay);

    document.getElementById('glossari-close-btn').addEventListener('click', () => {
        glossariDisplay.remove();
    });
}