//Limitations: no phonetic information with current API

// Log a message to the console to confirm the background script is loaded
console.log("Glossari background service worker loaded!");

// Add a listener that runs when the extension is first installed or updated
chrome.runtime.onInstalled.addListener(() => {
    // Create the parent context menu item for Glossari
    chrome.contextMenus.create({
        id: "glossariParent",
        title: "Glossari",
        contexts: ["selection"] // The parent menu appears when text is selected
    });
    console.log("Context menu item 'glossariParent' created.");

    // Create a child context menu item for defining words
    chrome.contextMenus.create({
        id: "defineWord",
        title: "Define '%s'", // Shorter title as it's under Glossari
        parentId: "glossariParent", // Link to the parent Glossari menu
        contexts: ["selection"] // This context is technically inherited from parent but good to specify
    });
    console.log("Context menu item 'defineWord' created as child.");
});


// Add a listener for when a context menu item is clicked
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const selectedText = info.selectionText.trim();

    if (!selectedText) {
        return; // Exit silently if no text is selected
    }

    // This block handles the "Define" action
    if (info.menuItemId === "defineWord") {
        try {
            // Define the language pair for the translation (e.g., 'en|fr' for English to French)
            const langPair = 'fr|en'; // This assumes the selected text is French and needs English translation

            // Construct the API URL for MyMemory Translation
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
            console.error("Glossari Definition Error:", error.message);
            
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: displayResultOnPage,
                args: [selectedText, 'Error', `Definition Failed: ${error.message}`]
            });
        }
    }
    // The "explainWithAI" logic is removed from here for now
});



// This function is injected into the webpage to display the result.
function displayResultOnPage(word, label, text) {
    let glossariDisplay = document.getElementById('glossari-display');
    if (glossariDisplay) {
        glossariDisplay.remove();
    }

    glossariDisplay = document.createElement('div');
    glossariDisplay.id = 'glossari-display';
    glossariDisplay.innerHTML = `
        <div class="glossari-header">
            <strong>${word}</strong>
            <span class="glossari-label">${label}</span>
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