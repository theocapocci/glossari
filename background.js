//Limitations: no phonetic information with current API

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
            return; // Exit silently if no text is selected
        }

        try {
            // Define the language pair for the translation (e.g., 'en|fr' for English to French)
            const langPair = 'fr|en';
            
            // Construct the API URL
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedText)}&langpair=${langPair}`;

            const response = await fetch(url);
            const data = await response.json();

            // Check if the API returned a successful translation
            if (data.responseStatus !== 200) {
                throw new Error(data.responseDetails);
            }

            // Extract the primary translation
            const definition = data.responseData.translatedText;

            if (!definition || definition.toLowerCase() === selectedText.toLowerCase()) {
                 throw new Error(`No definition found for "${selectedText}"`);
            }

            // Inject the successful result into the page.
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Translation', definition] // Using 'Translation' for the phonetic field
            });

        } catch (error) {
            console.error("Glossari Error:", error.message);
            
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Error', error.message]
            });
        }
    }
});

// This function is injected into the webpage to display the result.
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