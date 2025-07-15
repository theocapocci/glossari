document.addEventListener('DOMContentLoaded', () => {

    // --- GENERIC SETTING HANDLER ---
    async function setupSetting(options) {
        const { saveBtnId, statusDivId, fields } = options;
        const saveBtn = document.getElementById(saveBtnId);
        const statusDiv = document.getElementById(statusDivId);

        // Populate inputs with stored values
        const storageKeys = Object.keys(fields);
        try {
            const result = await chrome.storage.local.get(storageKeys);
            storageKeys.forEach(key => {
                const field = fields[key];
                const inputElement = document.getElementById(field.inputId);
                if (inputElement) {
                    inputElement.value = result[key] ?? field.defaultValue;
                }
            });
        } catch (error) {
            console.error(`Error loading settings for ${storageKeys.join(', ')}:`, error);
            statusDiv.textContent = 'Error loading settings.';
            statusDiv.style.color = 'red';
        }

        // Add save listener
        saveBtn.addEventListener('click', async () => {
            try {
                const settingsToSave = {};
                let allValid = true;

                for (const key of storageKeys) {
                    const field = fields[key];
                    const inputElement = document.getElementById(field.inputId);
                    let value = inputElement.value.trim();

                    if (inputElement.type === 'number') {
                        value = parseInt(value, 10);
                        if (isNaN(value)) {
                           allValid = false;
                           break;
                        }
                    }
                    
                    if (!value && inputElement.required) {
                        allValid = false;
                        break;
                    }
                    settingsToSave[key] = value;
                }

                if (!allValid) {
                    statusDiv.textContent = 'Please fill out all required fields with valid values.';
                    statusDiv.style.color = 'red';
                    return;
                }

                await chrome.storage.local.set(settingsToSave);
                statusDiv.textContent = 'Settings saved successfully!';
                statusDiv.style.color = 'green';

            } catch (error) {
                console.error(`Error saving settings:`, error);
                statusDiv.textContent = 'Error saving settings.';
                statusDiv.style.color = 'red';
            }
        });
    }

    // --- Dark Mode Logic (remains separate as its interaction is different) ---
    const darkModeToggle = document.getElementById('darkModeToggle');
    const applyTheme = (isDarkMode) => {
        document.body.classList.toggle('dark-mode', isDarkMode);
    };

    const loadThemePreference = async () => {
        try {
            const { isDarkMode = false } = await chrome.storage.local.get('isDarkMode');
            darkModeToggle.checked = isDarkMode;
            applyTheme(isDarkMode);
        } catch (error) {
            console.error("Error loading theme preference:", error);
        }
    };

    darkModeToggle.addEventListener('change', async () => {
        const isDarkMode = darkModeToggle.checked;
        try {
            await chrome.storage.local.set({ isDarkMode });
            applyTheme(isDarkMode);
        } catch (error) {
            console.error("Error saving theme preference:", error);
        }
    });

    // --- INITIALIZATION ---
    loadThemePreference();

    setupSetting({
        saveBtnId: 'saveApiKeyBtn',
        statusDivId: 'apiKeyStatus',
        fields: {
            'geminiApiKey': { inputId: 'geminiApiKeyInput', defaultValue: '', required: true }
        }
    });

    setupSetting({
        saveBtnId: 'saveAnkiSettingsBtn',
        statusDivId: 'ankiSettingsStatus',
        fields: {
            'sentenceDeck': { inputId: 'sentenceDeckInput', defaultValue: 'Languages::French::n+1', required: true },
            'vocabDeck': { inputId: 'vocabDeckInput', defaultValue: 'Languages::French::n+1', required: true }
        }
    });

    setupSetting({
        saveBtnId: 'saveContextSettingsBtn',
        statusDivId: 'contextSettingsStatus',
        fields: {
            'contextSentences': { inputId: 'contextSentencesInput', defaultValue: 1, required: true }
        }
    });
});