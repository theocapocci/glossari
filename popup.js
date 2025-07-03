document.addEventListener('DOMContentLoaded', () => {
    // Get references for the Gemini API key input and save button
    const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const apiKeyStatusDiv = document.getElementById('apiKeyStatus');

    // Get reference to the dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');

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

    loadApiKey();

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

    loadThemePreference();
});
