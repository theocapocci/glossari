// Ensure the DOM is fully loaded before trying to access elements
document.addEventListener('DOMContentLoaded', () => {
    // Get references to the Anki button and its status display area
    const ankiBtn = document.getElementById('ankiBtn');
    const statusDiv = document.getElementById('status'); // This div is now for general status messages

    // Get references for the Gemini API key input and save button
    const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const apiKeyStatusDiv = document.getElementById('apiKeyStatus');

    // Variables to hold the currently selected word and sentence for Anki
    let currentSelectedWord = null;
    let currentFullSentence = null;

    // --- Anki Button Logic (Modified) ---
    ankiBtn.addEventListener('click', async () => {
        // Check if a word and sentence are currently selected for Anki
        if (currentSelectedWord && currentFullSentence) {
            statusDiv.textContent = 'Sending to Anki...';
            statusDiv.style.color = 'blue';

            try {
                // Send message to background script to create an Anki flashcard
                // The background script will handle the API calls (MyMemory, Gemini)
                await chrome.runtime.sendMessage({
                    action: "createAnkiFlashcard",
                    selectedWord: currentSelectedWord,
                    fullSentence: currentFullSentence
                });
                
                // Update status upon successful processing
                statusDiv.textContent = `Flashcard for "${currentSelectedWord}" processed!`;
                statusDiv.style.color = 'green';
                
                // Clear the stored data from local storage after successful processing
                // This ensures the button resets and prevents sending the same card twice
                await chrome.storage.local.remove(['selectedWordForAnki', 'fullSentenceForAnki']);
                currentSelectedWord = null;
                currentFullSentence = null;
                // Update the button state to reflect that no word is currently selected
                updateAnkiButtonState(); 

            } catch (error) {
                console.error("Anki Send Error:", error);
                statusDiv.textContent = `Failed to send to Anki: ${error.message}`;
                statusDiv.style.color = 'red';
            }
        } else {
            // If no word is selected, inform the user
            statusDiv.textContent = 'No word selected for Anki.';
            statusDiv.style.color = 'orange';
        }
    });

    // --- Gemini API Key Storage Logic (Existing) ---

    // Function to load the API key from storage and display it in the input field
    const loadApiKey = async () => {
        try {
            const result = await chrome.storage.local.get('geminiApiKey');
            if (result.geminiApiKey) {
                geminiApiKeyInput.value = result.geminiApiKey;
                apiKeyStatusDiv.textContent = 'API Key loaded.';
                apiKeyStatusDiv.style.color = 'green';
            } else {
                apiKeyStatusDiv.textContent = 'No API Key found. Please enter and save.';
                apiKeyStatusDiv.style.color = 'orange';
            }
        } catch (error) {
            console.error("Error loading API Key:", error);
            apiKeyStatusDiv.textContent = 'Error loading API Key.';
            apiKeyStatusDiv.style.color = 'red';
        }
    };

    // Load API key when the popup is opened
    loadApiKey();

    // Event listener for saving the API key when the "Save API Key" button is clicked
    saveApiKeyBtn.addEventListener('click', async () => {
        const apiKey = geminiApiKeyInput.value.trim();

        if (apiKey) {
            try {
                // Store the API key in Chrome's local storage
                await chrome.storage.local.set({ geminiApiKey: apiKey });
                apiKeyStatusDiv.textContent = 'API Key saved successfully!';
                apiKeyStatusDiv.style.color = 'green';
            } catch (error) {
                console.error("Error saving API Key:", error);
                apiKeyStatusDiv.textContent = 'Error saving API Key.';
                apiKeyStatusDiv.style.color = 'red';
            }
        } else {
            // If the input field is empty, prompt the user
            apiKeyStatusDiv.textContent = 'Please enter an API Key.';
            apiKeyStatusDiv.style.color = 'red';
        }
    });

    // --- NEW: Anki Button State Logic ---
    // Function to update the text and enabled/disabled state of the Anki button
    const updateAnkiButtonState = () => {
        if (currentSelectedWord && currentFullSentence) {
            // If a word is selected, enable the button and show the word
            ankiBtn.textContent = `Send "${currentSelectedWord}" to Anki`;
            ankiBtn.disabled = false;
            statusDiv.textContent = `Ready to create flashcard for: "${currentSelectedWord}" in context "${currentFullSentence}"`;
            statusDiv.style.color = 'green';
        } else {
            // If no word is selected, disable the button and show a generic message
            ankiBtn.textContent = 'Send to Anki (No word selected)';
            ankiBtn.disabled = true;
            statusDiv.textContent = 'Click a word in a transcript to prepare a flashcard.';
            statusDiv.style.color = 'gray';
        }
    };

    // Function to load the selected word and sentence from storage when the popup opens
    const loadAnkiDataForPopup = async () => {
        try {
            const result = await chrome.storage.local.get(['selectedWordForAnki', 'fullSentenceForAnki']);
            currentSelectedWord = result.selectedWordForAnki || null;
            currentFullSentence = result.fullSentenceForAnki || null;
            // After loading, update the button state accordingly
            updateAnkiButtonState();
        } catch (error) {
            console.error("Error loading Anki data from storage:", error);
            statusDiv.textContent = 'Error loading Anki data.';
            statusDiv.style.color = 'red';
            ankiBtn.disabled = true; // Disable button if there's an error
        }
    };

    // Load Anki data and update the button state when the popup is first opened
    loadAnkiDataForPopup();
});
