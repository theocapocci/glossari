document.addEventListener('DOMContentLoaded', () => {
    // Get references for the Gemini API key input and save button
    const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const apiKeyStatusDiv = document.getElementById('apiKeyStatus');

    // Get reference to the dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');

    // Get references for Anki settings
    const sentenceDeckInput = document.getElementById('sentenceDeckInput');
    const vocabDeckInput = document.getElementById('vocabDeckInput');
    const saveAnkiSettingsBtn = document.getElementById('saveAnkiSettingsBtn');
    const ankiSettingsStatusDiv = document.getElementById('ankiSettingsStatus');

    // --- Gemini API Key Storage Logic ---

    const loadApiKey = async () => {
        try {
            const result = await chrome.storage.local.get('geminiApiKey');
            if (result.geminiApiKey) {
                geminiApiKeyInput.value = result.geminiApiKey;
                apiKeyStatusDiv.textContent = 'API Key is loaded.';
                apiKeyStatusDiv.style.color = 'green';
            } else {
                apiKeyStatusDiv.textContent = 'No API Key found. Please enter one to use Glossari features.';
                apiKeyStatusDiv.style.color = 'orange';
            }
        } catch (error) {
            console.error("Error loading API Key:", error);
            apiKeyStatusDiv.textContent = 'Error loading API Key.';
            apiKeyStatusDiv.style.color = 'red';
        }
    };

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

    // --- Dark Mode Logic ---
    const applyTheme = (isDarkMode) => {
        if (isDarkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    };

    const loadThemePreference = async () => {
        try {
            const result = await chrome.storage.local.get('isDarkMode');
            const isDarkMode = result.isDarkMode || false;
            darkModeToggle.checked = isDarkMode;
            applyTheme(isDarkMode);
        } catch (error) {
            console.error("Error loading theme preference:", error);
        }
    };

    darkModeToggle.addEventListener('change', async () => {
        const isDarkMode = darkModeToggle.checked;
        try {
            await chrome.storage.local.set({ isDarkMode: isDarkMode });
            applyTheme(isDarkMode);
        } catch (error) {
            console.error("Error saving theme preference:", error);
        }
    });

    // --- Anki Deck Settings Logic ---
    const loadAnkiSettings = async () => {
        try {
            // Get the saved deck names from local storage.
            const result = await chrome.storage.local.get(['sentenceDeck', 'vocabDeck']);
            // Set the input values, providing default names if none are found.
            sentenceDeckInput.value = result.sentenceDeck || 'Glossari Sentences';
            vocabDeckInput.value = result.vocabDeck || 'Glossari Vocab';
        } catch (error) {
            console.error("Error loading Anki settings:", error);
            ankiSettingsStatusDiv.textContent = 'Error loading deck settings.';
            ankiSettingsStatusDiv.style.color = 'red';
        }
    };

    saveAnkiSettingsBtn.addEventListener('click', async () => {
        const sentenceDeck = sentenceDeckInput.value.trim();
        const vocabDeck = vocabDeckInput.value.trim();

        // Ensure both fields have values before saving.
        if (sentenceDeck && vocabDeck) {
            try {
                await chrome.storage.local.set({ sentenceDeck: sentenceDeck, vocabDeck: vocabDeck });
                ankiSettingsStatusDiv.textContent = 'Anki settings saved successfully!';
                ankiSettingsStatusDiv.style.color = 'green';
            } catch (error) {
                console.error("Error saving Anki settings:", error);
                ankiSettingsStatusDiv.textContent = 'Error saving deck settings.';
                ankiSettingsStatusDiv.style.color = 'red';
            }
        } else {
            ankiSettingsStatusDiv.textContent = 'Please enter names for both decks.';
            ankiSettingsStatusDiv.style.color = 'red';
        }
    });


    // --- Initial Loading ---
    // Load all settings when the popup opens.
    loadApiKey();
    loadThemePreference();
    loadAnkiSettings();
});
