// Ensure the DOM is fully loaded before trying to access elements
document.addEventListener('DOMContentLoaded', () => {
    // Get references to the Anki button and its status display area
    const ankiBtn = document.getElementById('ankiBtn');
    const statusDiv = document.getElementById('status');

    // Get references for the Gemini API key input and save button
    const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const apiKeyStatusDiv = document.getElementById('apiKeyStatus');

    // --- Anki Button Logic (Existing) ---
    ankiBtn.addEventListener('click', async () => {
        statusDiv.textContent = 'Button clicked! (Logic for sending to Anki will go here later)';
    });

    // --- Gemini API Key Storage Logic (New) ---

    // Function to load the API key from storage and display it
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

    // Event listener for saving the API key
    saveApiKeyBtn.addEventListener('click', async () => {
        const apiKey = geminiApiKeyInput.value.trim();

        if (apiKey) {
            try {
                await chrome.storage.local.set({ geminiApiKey: apiKey });
                apiKeyStatusDiv.textContent = 'API Key saved successfully!';
                apiKeyStatusDiv.style.color = 'green';
            } catch (error) {
                console.error("Error saving API Key:", error);
                apiKeyStatusDiv.textContent = 'Error saving API Key.';
                apiKeyStatusDiv.style.color = 'red';
            }
        } else {
            apiKeyStatusDiv.textContent = 'Please enter an API Key.';
            apiKeyStatusDiv.style.color = 'red';
        }
    });
});
